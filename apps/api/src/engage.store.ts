import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import { scopeFor, type Principal } from "@anvi/authz";
import {
  ENG_DAILY_KUDOS_LIMIT,
  engColleagueListSchema,
  engKudosDetailSchema,
  engKudosListSchema,
  engReactionCodeSchema,
  engSurveyDetailSchema,
  engSurveyListSchema,
  engSurveyResultsSchema,
  engSurveyStatusSchema,
  engValueListSchema,
  engValueSchema,
  type EngColleagueList,
  type EngKudos,
  type EngKudosDetail,
  type EngKudosList,
  type EngSurvey,
  type EngSurveyDetail,
  type EngSurveyList,
  type EngSurveyResults,
  type EngValueList,
  type engColleagueQuerySchema,
  type engKudosCreateSchema,
  type engKudosQuerySchema,
  type engModerateSchema,
  type engQuestionInputSchema,
  type engReactionSetSchema,
  type engResponseCreateSchema,
  type engSurveyActionSchema,
  type engSurveyCreateSchema,
  type engSurveyQuerySchema,
  type engSurveyUpdateSchema,
  type engValueCreateSchema,
  type engValueUpdateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const ruleErrors: Record<string, (message: string) => Error> = {
  EG003: (m) => new BadRequestException(m),
  EG004: (m) => new ConflictException(m),
  EG005: (m) => new ForbiddenException(m),
};
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  eng_value_name_key: "A value with this name already exists.",
  eng_reaction_once_key:
    "You have already reacted to this recognition. Remove your reaction to choose another.",
  eng_survey_question_position_key: retry,
  eng_survey_participation_pkey: "You have already answered this survey.",
};
const REACTIONS = engReactionCodeSchema.options;
const SURVEY_STATUSES = engSurveyStatusSchema.options;
const kudosUnavailable = "This recognition is unavailable.";
const surveyUnavailable = "This survey is unavailable.";

// $1 is always the caller's employee id.
const kudosColumns = `k.id, k.giver_employee_id AS "giverEmployeeId", k.giver_name AS "giverName",
  k.recipient_employee_id AS "recipientEmployeeId", k.recipient_name AS "recipientName", k.value_id AS "valueId",
  (SELECT v.name FROM eng_value v WHERE v.id=k.value_id) AS "valueName", k.message,
  to_char(k.given_on,'YYYY-MM-DD') AS "givenOn", ${stamp("k.created_at")} AS "createdAt", k.hidden,
  ${stamp("k.hidden_at")} AS "hiddenAt",
  coalesce((SELECT jsonb_object_agg(r.code,r.n) FROM (SELECT x.code, count(*)::int AS n FROM eng_reaction x
    WHERE x.kudos_id=k.id GROUP BY x.code) r),'{}'::jsonb) AS reactions,
  (SELECT x.code FROM eng_reaction x WHERE x.kudos_id=k.id AND x.employee_id=$1) AS "myReaction",
  (k.giver_employee_id=$1) AS "givenByMe", (k.recipient_employee_id=$1) AS "toMe", k.version`;
// $1 caller's employee id, $2 whether the caller manages (HR sees counts, never who answered).
const surveyColumns = `s.id, s.title, ${stamp("s.opens_at")} AS "opensAt", ${stamp("s.closes_at")} AS "closesAt",
  s.status, (s.status='published' AND now()>=s.opens_at AND now()<s.closes_at) AS "acceptingAnswers",
  ${stamp("s.published_at")} AS "publishedAt", ${stamp("s.closed_at")} AS "closedAt",
  (SELECT count(*)::int FROM eng_survey_question q WHERE q.survey_id=s.id) AS "questionCount",
  EXISTS(SELECT 1 FROM eng_survey_participation p WHERE p.survey_id=s.id AND p.employee_id=$1) AS responded,
  EXISTS(SELECT 1 FROM eng_survey_eligible g WHERE g.survey_id=s.id AND g.employee_id=$1) AS eligible,
  CASE WHEN $2 THEN s.response_count END AS "responseCount",
  CASE WHEN $2 THEN (SELECT count(*)::int FROM eng_survey_eligible g WHERE g.survey_id=s.id) END AS "eligibleCount",
  (s.closes_at>now()) AS "closesInFuture", s.version, s.updated_by_label AS "updatedBy",
  ${stamp("s.updated_at")} AS "updatedAt"`;
const valueColumns = `v.id, v.name, v.active, v.sort, v.version, v.updated_by_label AS "updatedBy",
  ${stamp("v.updated_at")} AS "updatedAt"`;

type KudosRow = Omit<EngKudos, "reactions" | "canReact" | "canModerate"> & {
  reactions: Record<string, number>;
};
type SurveyRow = Omit<
  EngSurvey,
  "canRespond" | "canEdit" | "canPublish" | "canClose"
> & { eligible: boolean; closesInFuture: boolean };
type Locked = { version: number; [key: string]: unknown };
const surveySteps = {
  publish: { to: "published", event: "engage.survey_published" },
  close: { to: "closed", event: "engage.survey_closed" },
} as const;
export type SurveyStep = keyof typeof surveySteps;

// Who may do what, the daily cap, self-recognition, reaction uniqueness, moderation, the survey
// lifecycle and survey anonymity all live in the database guards, policies and functions (062).
// The store shapes replies, takes the same advisory locks first, and writes audit and outbox rows
// with ids, statuses, codes and counts only: never messages, reasons, titles, questions or answers.
export class EngageStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal) {
    if (scopeFor(actor, "engage.manage")) return "manage" as const;
    if (scopeFor(actor, "engage.self")) return "self" as const;
    return undefined;
  }
  private see(actor: Principal) {
    const scope = this.scope(actor);
    if (!scope)
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
    return scope;
  }
  private manage(actor: Principal) {
    if (this.see(actor) !== "manage")
      throw new ForbiddenException("Only HR manages recognition and surveys.");
  }

  // ---- Values ----
  async values(actor: Principal): Promise<EngValueList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT ${valueColumns} FROM eng_value v WHERE ($1 OR v.active) ORDER BY v.sort, lower(v.name), v.id`,
        [scope === "manage"],
      );
      return engValueListSchema.parse({
        items: rows,
        canManage: scope === "manage",
      });
    });
  }
  async createValue(
    actor: Principal,
    input: z.infer<typeof engValueCreateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          "INSERT INTO eng_value(id,tenant_id,entity_id,name,sort) VALUES ($1,$2,$3,$4,$5)",
          [id, actor.tenantId, actor.entityId, input.name, input.sort],
        );
        await this.record(
          client,
          actor,
          requestId,
          "engage.value_created",
          `eng-value:${id}`,
          id,
          1,
          {},
        );
        return this.value(client, id);
      }),
    );
  }
  async updateValue(
    actor: Principal,
    id: string,
    input: z.infer<typeof engValueUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<Locked>(
          "SELECT version FROM eng_value WHERE id=$1 FOR UPDATE",
          [id],
        );
        const row = this.fresh(found.rows[0], input.version, "value");
        await client.query(
          "UPDATE eng_value SET name=$2, active=$3, sort=$4, version=version+1 WHERE id=$1",
          [id, input.name, input.active, input.sort],
        );
        await this.record(
          client,
          actor,
          requestId,
          "engage.value_updated",
          `eng-value:${id}`,
          id,
          row.version + 1,
          { active: input.active },
        );
        return this.value(client, id);
      }),
    );
  }
  private async value(client: PoolClient, id: string) {
    const { rows } = await client.query(
      `SELECT ${valueColumns} FROM eng_value v WHERE v.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This value is unavailable.");
    return engValueSchema.parse(rows[0]);
  }

  // ---- Colleagues ----
  async colleagues(
    actor: Principal,
    query: z.infer<typeof engColleagueQuerySchema>,
  ): Promise<EngColleagueList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT employee_id AS "employeeId", name FROM eng_colleagues($1)`,
        [query.q],
      );
      return engColleagueListSchema.parse({ items: rows });
    });
  }

  // ---- Recognition ----
  async listKudos(
    actor: Principal,
    query: z.infer<typeof engKudosQuerySchema>,
  ): Promise<EngKudosList> {
    const scope = this.see(actor);
    if (query.view === "hidden" && scope !== "manage")
      throw new ForbiddenException("Only HR sees hidden recognition.");
    return scoped(this.platform.pool, actor, async (client) => {
      const view = {
        feed: "NOT k.hidden",
        received: "NOT k.hidden AND k.recipient_employee_id=$1",
        given: "NOT k.hidden AND k.giver_employee_id=$1",
        hidden: "k.hidden",
      }[query.view];
      const where = `$1::uuid IS NOT NULL AND ${view} AND ($2::uuid IS NULL OR k.value_id=$2)`;
      const base = [actor.employeeId, query.valueId ?? null];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM eng_kudos k WHERE ${where}`,
          base,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<KudosRow>(
        `SELECT ${kudosColumns} FROM eng_kudos k WHERE ${where}
         ORDER BY k.created_at DESC, k.id LIMIT $3 OFFSET $4`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      const givenToday =
        // Counts hidden posts too, as the daily cap does (063).
        (await client.query<{ n: number }>("SELECT eng_given_today() AS n"))
          .rows[0]!.n;
      return engKudosListSchema.parse({
        items: rows.map((r) => this.kudosShape(r, scope)),
        total,
        page: query.page,
        limit: query.limit,
        view: query.view,
        givenToday,
        dailyLimit: ENG_DAILY_KUDOS_LIMIT,
        canModerate: scope === "manage",
      });
    });
  }
  async kudosDetail(actor: Principal, id: string): Promise<EngKudosDetail> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.kudos(client, actor, id, scope),
    );
  }
  async giveKudos(
    actor: Principal,
    input: z.infer<typeof engKudosCreateSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    if (input.recipientEmployeeId === actor.employeeId)
      throw new BadRequestException("Recognise a colleague, not yourself.");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO eng_kudos(id,tenant_id,entity_id,recipient_employee_id,value_id,message)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.recipientEmployeeId,
            input.valueId,
            input.message,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "engage.kudos_given",
          `eng-kudos:${id}`,
          id,
          1,
          {},
        );
        return this.kudos(client, actor, id, scope);
      }),
    );
  }
  async react(
    actor: Principal,
    id: string,
    input: z.infer<typeof engReactionSetSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.kudosLock(client, id);
        await this.visibleKudos(client, id);
        const reaction = randomUUID();
        await client.query(
          "INSERT INTO eng_reaction(id,tenant_id,entity_id,kudos_id,code) VALUES ($1,$2,$3,$4,$5)",
          [reaction, actor.tenantId, actor.entityId, id, input.code],
        );
        await this.record(
          client,
          actor,
          requestId,
          "engage.reaction_added",
          `eng-kudos:${id}`,
          reaction,
          1,
          { code: input.code },
        );
        return this.kudos(client, actor, id, scope);
      }),
    );
  }
  async unreact(actor: Principal, id: string, requestId: string) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.kudosLock(client, id);
        await this.visibleKudos(client, id);
        const { rows } = await client.query<{ id: string }>(
          "DELETE FROM eng_reaction WHERE kudos_id=$1 AND employee_id=$2 RETURNING id",
          [id, actor.employeeId],
        );
        if (!rows[0])
          throw new NotFoundException(
            "You have not reacted to this recognition.",
          );
        await this.record(
          client,
          actor,
          requestId,
          "engage.reaction_removed",
          `eng-kudos:${id}`,
          rows[0].id,
          2,
          {},
        );
        return this.kudos(client, actor, id, scope);
      }),
    );
  }
  async moderate(
    actor: Principal,
    id: string,
    action: "hide" | "restore",
    input: z.infer<typeof engModerateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.kudosLock(client, id);
        const found = await client.query<Locked>(
          "SELECT version, hidden FROM eng_kudos WHERE id=$1",
          [id],
        );
        const row = this.fresh(found.rows[0], input.version, "recognition");
        if (row.hidden === (action === "hide"))
          throw new ConflictException(
            action === "hide"
              ? "This recognition is already hidden."
              : "This recognition is not hidden.",
          );
        await client.query(
          "INSERT INTO eng_kudos_moderation(id,tenant_id,entity_id,kudos_id,action,reason) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            id,
            action,
            input.reason,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          action === "hide" ? "engage.kudos_hidden" : "engage.kudos_restored",
          `eng-kudos:${id}`,
          id,
          row.version + 1,
          {},
        );
        return this.kudos(client, actor, id, "manage");
      }),
    );
  }
  private async kudosLock(client: PoolClient, id: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('eng-kudos:'||$1::text,0))",
      [id],
    );
  }
  // Missing, in another entity and hidden (for non-HR) all answer the same.
  private async visibleKudos(client: PoolClient, id: string) {
    const { rows } = await client.query("SELECT 1 FROM eng_kudos WHERE id=$1", [
      id,
    ]);
    if (!rows[0]) throw new NotFoundException(kudosUnavailable);
  }
  private async kudos(
    client: PoolClient,
    actor: Principal,
    id: string,
    scope: "manage" | "self",
  ): Promise<EngKudosDetail> {
    const { rows } = await client.query<KudosRow>(
      `SELECT ${kudosColumns} FROM eng_kudos k WHERE k.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw new NotFoundException(kudosUnavailable);
    const moderation =
      scope === "manage"
        ? (
            await client.query(
              `SELECT m.id, m.action, m.reason, m.by_label AS "byLabel", ${stamp("m.at")} AS at
               FROM eng_kudos_moderation m WHERE m.kudos_id=$1 ORDER BY m.at, m.id`,
              [id],
            )
          ).rows
        : [];
    return engKudosDetailSchema.parse({
      kudos: this.kudosShape(rows[0], scope),
      moderation,
    });
  }
  private kudosShape(row: KudosRow, scope: "manage" | "self"): EngKudos {
    return {
      ...row,
      reactions: Object.fromEntries(
        REACTIONS.map((code) => [code, row.reactions[code] ?? 0]),
      ) as EngKudos["reactions"],
      canReact: !row.hidden,
      canModerate: scope === "manage",
    };
  }

  // ---- Surveys ----
  async listSurveys(
    actor: Principal,
    query: z.infer<typeof engSurveyQuerySchema>,
  ): Promise<EngSurveyList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const manage = scope === "manage";
      const status = query.status ?? null;
      const total = (
        await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM eng_survey s WHERE ($1::text IS NULL OR s.status=$1)",
          [status],
        )
      ).rows[0]!.n;
      const { rows } = await client.query<SurveyRow>(
        `SELECT ${surveyColumns} FROM eng_survey s WHERE ($3::text IS NULL OR s.status=$3)
         ORDER BY s.created_at DESC, s.id LIMIT $4 OFFSET $5`,
        [
          actor.employeeId,
          manage,
          status,
          query.limit,
          (query.page - 1) * query.limit,
        ],
      );
      const counts: Record<string, number> = Object.fromEntries(
        SURVEY_STATUSES.map((k) => [k, 0]),
      );
      for (const r of (
        await client.query<{ key: string; n: number }>(
          "SELECT s.status AS key, count(*)::int AS n FROM eng_survey s GROUP BY s.status",
        )
      ).rows)
        counts[r.key] = r.n;
      return engSurveyListSchema.parse({
        items: rows.map((r) => this.surveyShape(r, manage)),
        total,
        page: query.page,
        limit: query.limit,
        counts,
        canManage: manage,
      });
    });
  }
  async surveyDetail(actor: Principal, id: string): Promise<EngSurveyDetail> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.survey(client, actor, id, scope === "manage"),
    );
  }
  async createSurvey(
    actor: Principal,
    input: z.infer<typeof engSurveyCreateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          "INSERT INTO eng_survey(id,tenant_id,entity_id,title,opens_at,closes_at) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.title,
            input.opensAt,
            input.closesAt,
          ],
        );
        await this.writeQuestions(client, actor, id, input.questions);
        await this.record(
          client,
          actor,
          requestId,
          "engage.survey_created",
          `eng-survey:${id}`,
          id,
          1,
          { questions: input.questions.length },
        );
        return this.survey(client, actor, id, true);
      }),
    );
  }
  async updateSurvey(
    actor: Principal,
    id: string,
    input: z.infer<typeof engSurveyUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockSurvey(client, id, input.version);
        if (row.status !== "draft")
          throw new ConflictException("A published survey cannot be edited.");
        await client.query(
          "UPDATE eng_survey SET title=$2, opens_at=$3, closes_at=$4, version=version+1 WHERE id=$1",
          [id, input.title, input.opensAt, input.closesAt],
        );
        await client.query(
          "DELETE FROM eng_survey_question WHERE survey_id=$1",
          [id],
        );
        await this.writeQuestions(client, actor, id, input.questions);
        await this.record(
          client,
          actor,
          requestId,
          "engage.survey_updated",
          `eng-survey:${id}`,
          id,
          row.version + 1,
          { questions: input.questions.length },
        );
        return this.survey(client, actor, id, true);
      }),
    );
  }
  async surveyStep(
    actor: Principal,
    id: string,
    step: SurveyStep,
    input: z.infer<typeof engSurveyActionSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    const { to, event } = surveySteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockSurvey(client, id, input.version);
        await client.query(
          "UPDATE eng_survey SET status=$2, version=version+1 WHERE id=$1",
          [id, to],
        );
        await this.record(
          client,
          actor,
          requestId,
          event,
          `eng-survey:${id}`,
          id,
          row.version + 1,
          { from: row.status, to },
        );
        return this.survey(client, actor, id, true);
      }),
    );
  }
  // Participation and answers are written by eng_submit_response (062) in this transaction; the
  // outbox row carries the survey id and count only; there is deliberately no audit row (064).
  async respond(
    actor: Principal,
    id: string,
    input: z.infer<typeof engResponseCreateSchema>,
    _requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const visible = await client.query(
          "SELECT 1 FROM eng_survey s WHERE s.id=$1 AND s.status<>'draft' AND EXISTS(SELECT 1 FROM eng_survey_eligible g WHERE g.survey_id=s.id AND g.employee_id=$2)",
          [id, actor.employeeId],
        );
        if (!visible.rows[0]) throw new NotFoundException(surveyUnavailable);
        await client.query("SELECT eng_submit_response($1,$2::jsonb)", [
          id,
          JSON.stringify(
            input.answers.map((a) => ({
              questionId: a.questionId,
              ...(a.rating !== undefined ? { rating: a.rating } : {}),
              ...(a.choice !== undefined ? { choice: a.choice } : {}),
              ...(a.text !== undefined ? { text: a.text } : {}),
            })),
          ),
        ]);
        const count = await client.query<{ n: number }>(
          "SELECT response_count AS n FROM eng_survey WHERE id=$1",
          [id],
        );
        // Outbox only: an audit row would name who answered which survey and when, for anyone
        // with audit.read (064). The outbox row carries no person.
        await client.query(
          `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
           VALUES ($1,$2,$3,'engage.survey_responded.v1',$4,$5)`,
          [randomUUID(), actor.tenantId, actor.entityId, id, count.rows[0]!.n],
        );
        return { responded: true as const };
      }),
    );
  }
  async results(actor: Principal, id: string): Promise<EngSurveyResults> {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query(
          "SELECT 1 FROM eng_survey WHERE id=$1",
          [id],
        );
        if (!found.rows[0]) throw new NotFoundException(surveyUnavailable);
        const { rows } = await client.query<{ r: Record<string, unknown> }>(
          "SELECT eng_survey_results($1) AS r",
          [id],
        );
        return engSurveyResultsSchema.parse({ surveyId: id, ...rows[0]!.r });
      }),
    );
  }
  private async writeQuestions(
    client: PoolClient,
    actor: Principal,
    surveyId: string,
    questions: z.infer<typeof engQuestionInputSchema>[],
  ) {
    for (const [index, q] of questions.entries())
      await client.query(
        `INSERT INTO eng_survey_question(id,tenant_id,entity_id,survey_id,position,kind,prompt,options)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          actor.tenantId,
          actor.entityId,
          surveyId,
          index + 1,
          q.kind,
          q.prompt,
          q.kind === "choice" ? q.options : [],
        ],
      );
  }
  private async lockSurvey(client: PoolClient, id: string, version: number) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('eng-survey:'||$1::text,0))",
      [id],
    );
    const found = await client.query<Locked>(
      "SELECT version, status FROM eng_survey WHERE id=$1 FOR UPDATE",
      [id],
    );
    return this.fresh(found.rows[0], version, "survey");
  }
  private async survey(
    client: PoolClient,
    actor: Principal,
    id: string,
    manage: boolean,
  ): Promise<EngSurveyDetail> {
    const { rows } = await client.query<SurveyRow>(
      `SELECT ${surveyColumns} FROM eng_survey s WHERE s.id=$3`,
      [actor.employeeId, manage, id],
    );
    if (!rows[0]) throw new NotFoundException(surveyUnavailable);
    const questions = await client.query(
      `SELECT q.id, q.position, q.kind, q.prompt, q.options, (q.kind<>'text') AS required
       FROM eng_survey_question q WHERE q.survey_id=$1 ORDER BY q.position`,
      [id],
    );
    return engSurveyDetailSchema.parse({
      survey: this.surveyShape(rows[0], manage),
      questions: questions.rows,
    });
  }
  private surveyShape(row: SurveyRow, manage: boolean): EngSurvey {
    const { eligible, closesInFuture, ...rest } = row;
    return {
      ...rest,
      canRespond: row.acceptingAnswers && eligible && !row.responded,
      canEdit: manage && row.status === "draft",
      canPublish: manage && row.status === "draft" && closesInFuture,
      canClose: manage && row.status === "published",
    };
  }

  private fresh(row: Locked | undefined, version: number, what: string) {
    if (!row) throw new NotFoundException(`This ${what} is unavailable.`);
    if (row.version !== version)
      throw new ConflictException(
        `This ${what} changed. Reload it before trying again.`,
      );
    return row;
  }
  private async record(
    client: PoolClient,
    actor: Principal,
    requestId: string,
    action: string,
    target: string,
    aggregateId: string,
    version: number,
    details: Record<string, unknown>,
  ) {
    await audit(client, actor, action, target, requestId, { details });
    await client.query(
      `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        `${action}.v1`,
        aggregateId,
        version,
      ],
    );
  }
  private async rules<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (typeof code === "string" && conflictCodes.has(code))
          throw new ConflictException(retry);
        if (code === "23503")
          throw new BadRequestException(
            "A referenced value, survey or person is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "23505") {
          const constraint =
            "constraint" in error ? String(error.constraint) : "";
          throw new ConflictException(
            uniqueMessages[constraint] ?? "This already exists.",
          );
        }
        if (
          typeof code === "string" &&
          code in ruleErrors &&
          "message" in error &&
          typeof error.message === "string"
        )
          throw ruleErrors[code]!(`${error.message}.`);
      }
      throw error;
    }
  }
}
