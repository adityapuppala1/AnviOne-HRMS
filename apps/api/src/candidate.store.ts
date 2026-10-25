import { randomUUID, randomInt } from "node:crypto";
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { makePool, transaction, type PoolClient } from "@anvi/database";
import {
  candidatePortalSchema,
  candidateDraftSchema,
  type CandidateDraft,
} from "@anvi/contracts";
import { hash, opaque } from "./platform.store";
import { otpHash, seal, previewKey } from "./onboarding.crypto";
import type { Config } from "./config";
export type CandidateActor = {
  id: string;
  csrfToken: string;
  tokenHash: string;
};
export class CandidateStore {
  readonly pool;
  private readonly key;
  constructor(config: Config) {
    this.key = previewKey(config);
    if (!config.CANDIDATE_DATABASE_URL)
      throw new Error("A dedicated candidate database connection is required");
    this.pool = makePool(config.CANDIDATE_DATABASE_URL);
    this.pool.on("error", () =>
      console.error(
        JSON.stringify({ event: "candidate.database_unavailable" }),
      ),
    );
  }
  async verifyRole() {
    const { rows } = await this.pool.query(
      "SELECT current_user AS role,rolsuper OR rolbypassrls AS unsafe FROM pg_roles WHERE rolname=current_user",
    );
    if (rows[0]?.role !== "anvione_candidate" || rows[0].unsafe)
      throw new Error("The restricted candidate database role is required");
  }
  async challenge(token: string) {
    const challengeId = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await this.pool.query("SELECT candidate_begin($1,$2,$3,$4)", [
      hash(token),
      challengeId,
      otpHash(this.key, challengeId, code),
      seal(this.key, { code }),
    ]);
    // Unknown, expired and throttled invitations have the same public response.
    return { challengeId };
  }
  async exchange(token: string, challengeId: string, code: string) {
    const session = opaque(),
      csrf = opaque();
    const { rows } = await this.pool.query<{ ok: boolean }>(
      "SELECT candidate_exchange($1,$2,$3,$4,$5) AS ok",
      [
        hash(token),
        challengeId,
        otpHash(this.key, challengeId, code),
        hash(session),
        csrf,
      ],
    );
    if (!rows[0]?.ok)
      throw new UnauthorizedException(
        "This verification could not be completed. Reopen your latest invitation or contact HR.",
      );
    return session;
  }
  async session(token: unknown): Promise<CandidateActor> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Reopen your invitation to continue.");
    const { rows } = await this.pool.query<{ actor: CandidateActor | null }>(
      "SELECT resolve_candidate_session($1) AS actor",
      [hash(token)],
    );
    if (!rows[0]?.actor)
      throw new UnauthorizedException(
        "Your candidate session ended. Contact HR for a fresh invitation.",
      );
    return { ...rows[0].actor, tokenHash: hash(token) };
  }
  private scoped<T>(
    actor: CandidateActor,
    work: (client: PoolClient) => Promise<T>,
  ) {
    return transaction(this.pool, async (client) => {
      const check = await client.query(
        "SELECT resolve_candidate_session($1) AS actor",
        [actor.tokenHash],
      );
      if (!check.rows[0]?.actor)
        throw new UnauthorizedException(
          "Your candidate session ended. Reopen your latest invitation.",
        );
      await client.query("SELECT set_config('candidate.id',$1,true)", [
        actor.id,
      ]);
      return work(client);
    });
  }
  private async record(client: PoolClient, actor: CandidateActor) {
    const { rows } = await client.query(
      `SELECT id,name,title,joined_on::text AS "joinedOn",state,version,review_note AS "reviewNote",draft FROM candidate_case WHERE id=$1`,
      [actor.id],
    );
    if (!rows[0])
      throw new UnauthorizedException("Your candidate record is unavailable.");
    return candidatePortalSchema.parse({
      candidate: rows[0],
      csrfToken: actor.csrfToken,
    });
  }
  async me(actor: CandidateActor) {
    return this.scoped(actor, (client) => this.record(client, actor));
  }
  async save(actor: CandidateActor, version: number, draft: CandidateDraft) {
    return this.scoped(actor, async (client) => {
      const result = await client.query(
        "UPDATE candidate_case SET draft=$3,version=version+1,state='in_progress' WHERE id=$1 AND version=$2 AND state IN ('invited','in_progress','changes_requested') RETURNING id",
        [actor.id, version, JSON.stringify(draft)],
      );
      if (!result.rows[0])
        throw new ConflictException(
          "This form changed or is already submitted. Reload before continuing.",
        );
      return this.record(client, actor);
    });
  }
  async submit(actor: CandidateActor, version: number, requestId: string) {
    return this.scoped(actor, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM candidate_case WHERE id=$1 FOR UPDATE",
        [actor.id],
      );
      const current = rows[0];
      if (
        !current ||
        current.version !== version ||
        !["invited", "in_progress", "changes_requested"].includes(current.state)
      )
        throw new ConflictException(
          "This form changed or is already submitted. Reload before continuing.",
        );
      const draft = candidateDraftSchema.parse(current.draft);
      if (
        draft.preferredName.length < 2 ||
        draft.introduction.length < 20 ||
        !draft.acknowledged
      )
        throw new BadRequestException(
          "Add your preferred name, an introduction of at least 20 characters and acknowledge the preview notice.",
        );
      await client.query(
        "INSERT INTO candidate_submission(candidate_id,version,payload) VALUES($1,$2,$3)",
        [actor.id, version, JSON.stringify(draft)],
      );
      await client.query(
        "UPDATE candidate_case SET state='submitted',version=version+1 WHERE id=$1",
        [actor.id],
      );
      await client.query(
        "INSERT INTO audit_event(id,tenant_id,entity_id,actor_id,actor_label,role,action,target,request_id) VALUES($1,$2,$3,$4,'Candidate','candidate','candidate.submitted',$6,$5)",
        [
          randomUUID(),
          current.tenant_id,
          current.entity_id,
          actor.id,
          requestId,
          actor.id,
        ],
      );
      await client.query(
        "INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES($1,$2,$3,'candidate.submitted.v1',$4,$5)",
        [
          randomUUID(),
          current.tenant_id,
          current.entity_id,
          actor.id,
          version + 1,
        ],
      );
      return this.record(client, actor);
    });
  }
  async logout(token: string) {
    await this.pool.query("SELECT end_candidate_session($1)", [hash(token)]);
  }
}
