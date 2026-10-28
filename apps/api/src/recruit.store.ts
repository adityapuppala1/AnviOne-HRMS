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
  recruitApplicationDetailSchema,
  recruitApplicationListSchema,
  recruitApplicationSchema,
  recruitCandidateListSchema,
  recruitCandidateSchema,
  recruitFunnelSchema,
  recruitInterviewListSchema,
  recruitInterviewSchema,
  recruitLookupsSchema,
  recruitOfferAcceptedSchema,
  recruitOfferListSchema,
  recruitOfferSchema,
  recruitRequisitionListSchema,
  recruitRequisitionSchema,
  recruitScorecardListSchema,
  recruitStageHistorySchema,
  recruitStageSchema,
  type RecruitApplication,
  type RecruitApplicationDetail,
  type RecruitApplicationList,
  type RecruitCandidate,
  type RecruitCandidateList,
  type RecruitFunnel,
  type RecruitInterview,
  type RecruitInterviewList,
  type RecruitLookups,
  type RecruitOffer,
  type RecruitOfferAccepted,
  type RecruitOfferList,
  type RecruitRequisition,
  type RecruitRequisitionList,
  type RecruitStage,
  type recruitApplicationCreateSchema,
  type recruitApplicationQuerySchema,
  type recruitCandidateCreateSchema,
  type recruitCandidateQuerySchema,
  type recruitCandidateRetentionSchema,
  type recruitCandidateWithdrawConsentSchema,
  type recruitCandidateAnonymiseSchema,
  type recruitFunnelQuerySchema,
  type recruitInterviewCreateSchema,
  type recruitInterviewQuerySchema,
  type recruitInterviewRescheduleSchema,
  type recruitInterviewStatusChangeSchema,
  type recruitOfferAcceptSchema,
  type recruitOfferActionSchema,
  type recruitOfferCreateSchema,
  type recruitOfferDeclineSchema,
  type recruitOfferQuerySchema,
  type recruitRequisitionActionSchema,
  type recruitRequisitionCreateSchema,
  type recruitRequisitionQuerySchema,
  type recruitRequisitionUpdateSchema,
  type recruitScorecardCreateSchema,
  type recruitStageChangeSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";
import { openValue, profileKeys, sealValue } from "./profile.crypto";
import {
  maskEmail,
  maskPhone,
  recruitEmailHash,
  recruitHashKeyId,
} from "./recruit.crypto";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const day = (column: string) => `to_char(${column},'YYYY-MM-DD')`;
const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const EMAIL = "recruit.email";
const PHONE = "recruit.phone";

const requisitionColumns = `r.id, r.code, r.title, r.department_id AS "departmentId", d.name AS "departmentName",
  r.location_id AS "locationId", l.name AS "locationName", r.designation_id AS "designationId",
  g.name AS "designationName", r.headcount,
  (SELECT count(*)::int FROM recruit_application a WHERE a.requisition_id=r.id AND a.stage='hired') AS "filledCount",
  (SELECT count(*)::int FROM recruit_application a WHERE a.requisition_id=r.id) AS "applicationCount",
  r.employment_type AS "employmentType", r.hiring_manager_id AS "hiringManagerId",
  r.hiring_manager_name AS "hiringManagerName", r.description, ${day("r.target_start")} AS "targetStart",
  r.status, r.status_note AS "statusNote", r.requested_by_employee AS "requestedByEmployeeId",
  r.approved_by_label AS "approvedBy", ${stamp("r.approved_at")} AS "approvedAt", ${stamp("r.closed_at")} AS "closedAt",
  (r.reapproval_requested_by IS NOT NULL) AS "needsReapproval", r.reapproval_requested_by AS "reapprovalRequestedByEmployeeId",
  r.version, r.created_by_label AS "createdBy", ${stamp("r.created_at")} AS "createdAt",
  r.updated_by_label AS "updatedBy", ${stamp("r.updated_at")} AS "updatedAt"`;
const requisitionFrom = `FROM job_requisition r LEFT JOIN org_unit d ON d.id=r.department_id
  LEFT JOIN org_unit l ON l.id=r.location_id LEFT JOIN org_unit g ON g.id=r.designation_id`;
const applicationColumns = `a.id, a.candidate_id AS "candidateId", a.requisition_id AS "requisitionId",
  r.code AS "requisitionCode", r.title AS "requisitionTitle", r.status AS "requisitionStatus",
  r.hiring_manager_id AS "hiringManagerId", a.candidate_name AS "candidateName",
  a.candidate_company AS "candidateCompany", a.candidate_experience_months AS "candidateExperienceMonths",
  a.source, a.stage, a.previous_stage AS "previousStage", ${stamp("a.stage_entered_at")} AS "stageEnteredAt",
  floor(extract(epoch FROM now()-a.stage_entered_at)/86400)::int AS "daysInStage",
  a.rejection_reason AS "rejectionReason", a.rating_average::float8 AS "ratingAverage",
  a.scorecard_count AS "scorecardCount", a.version, ${stamp("a.created_at")} AS "createdAt",
  ${stamp("a.updated_at")} AS "updatedAt",
  (SELECT o.status FROM recruit_offer o WHERE o.application_id=a.id
    AND o.status IN ('draft','pending_approval','approved','sent','accepted') LIMIT 1) AS "activeOffer"`;
const applicationFrom = `FROM recruit_application a JOIN job_requisition r ON r.id=a.requisition_id`;
const interviewColumns = `i.id, i.application_id AS "applicationId", i.requisition_id AS "requisitionId",
  i.requisition_title AS "requisitionTitle", i.candidate_name AS "candidateName", i.round_name AS "roundName",
  ${stamp("i.scheduled_at")} AS "scheduledAt", i.duration_minutes AS "durationMinutes", ${stamp("i.ends_at")} AS "endsAt",
  i.mode, i.location_or_link AS "locationOrLink", i.status, i.status_note AS "statusNote",
  coalesce((SELECT json_agg(json_build_object('employeeId',p.employee_id,'employeeName',p.employee_name,
    'submitted',EXISTS(SELECT 1 FROM recruit_scorecard s WHERE s.interview_id=i.id
      AND s.interviewer_employee_id=p.employee_id)) ORDER BY p.employee_name)
    FROM recruit_interview_panel p WHERE p.interview_id=i.id),'[]'::json) AS panel,
  EXISTS(SELECT 1 FROM recruit_interview_panel p WHERE p.interview_id=i.id AND p.employee_id=$1) AS "onPanel",
  EXISTS(SELECT 1 FROM recruit_scorecard s WHERE s.interview_id=i.id AND s.interviewer_employee_id=$1) AS "myScorecardSubmitted",
  i.version, i.created_by_label AS "createdBy", ${stamp("i.created_at")} AS "createdAt", ${stamp("i.updated_at")} AS "updatedAt",
  (i.scheduled_at<=now()) AS started, recruit_manages_req(i.requisition_id) AS manages`;
const scorecardColumns = `s.id, s.interview_id AS "interviewId", s.application_id AS "applicationId",
  s.interviewer_employee_id AS "interviewerEmployeeId", s.interviewer_name AS "interviewerName", s.ratings,
  s.overall::float8 AS overall, s.recommendation, s.comment, ${stamp("s.submitted_at")} AS "submittedAt",
  (s.interviewer_employee_id=$1) AS mine`;
const offerColumns = `o.id, o.application_id AS "applicationId", o.requisition_id AS "requisitionId",
  o.candidate_id AS "candidateId", a.candidate_name AS "candidateName", o.title, o.department_id AS "departmentId",
  o.location_id AS "locationId", o.designation_id AS "designationId", o.manager_id AS "managerId",
  o.manager_name AS "managerName", ${day("o.proposed_joining_date")} AS "proposedJoiningDate", o.status,
  o.status_note AS "statusNote", o.created_by_label AS "createdBy", o.created_by_employee AS "createdByEmployee",
  (SELECT r.hiring_manager_id FROM job_requisition r WHERE r.id=o.requisition_id) AS "hiringManagerId",
  o.approved_by_label AS "approvedBy", ${stamp("o.approved_at")} AS "approvedAt", ${stamp("o.sent_at")} AS "sentAt",
  ${day("o.responded_on")} AS "respondedOn", o.candidate_case_id AS "candidateCaseId", o.version,
  ${stamp("o.created_at")} AS "createdAt", ${stamp("o.updated_at")} AS "updatedAt"`;
const offerFrom = `FROM recruit_offer o JOIN recruit_application a ON a.id=o.application_id`;

const ruleErrors: Record<string, (message: string) => Error> = {
  RC003: (m) => new BadRequestException(m),
  RC004: (m) => new ConflictException(m),
  RC005: (m) => new ForbiddenException(m),
};
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  recruit_application_pair_key:
    "This candidate is already on this requisition.",
  recruit_scorecard_once_key:
    "You have already submitted your scorecard for this interview.",
  recruit_offer_active_key: "This application already has an open offer.",
  recruit_interview_panel_pkey: "List each interviewer once.",
};
const RANK: Record<string, number> = {
  applied: 1,
  screening: 2,
  interview: 3,
  assessment: 4,
  offer: 5,
  hired: 6,
};
const STAGES = recruitStageSchema.options;

type RequisitionRow = Omit<
  RecruitRequisition,
  | "canEdit"
  | "canSubmit"
  | "canDecide"
  | "canOpen"
  | "canHold"
  | "canClose"
  | "canCancel"
  | "canAddCandidates"
>;
type ApplicationRow = Omit<
  RecruitApplication,
  "allowedStages" | "canScheduleInterview" | "canMakeOffer"
> & {
  requisitionStatus: string;
  hiringManagerId: string;
  activeOffer: string | null;
};
type InterviewRow = Omit<
  RecruitInterview,
  "canReschedule" | "canChangeStatus" | "canSubmitScorecard"
> & { started: boolean; manages: boolean };
type OfferRow = Omit<
  RecruitOffer,
  "canSubmit" | "canApprove" | "canSend" | "canRecordResponse" | "canWithdraw"
> & { createdByEmployee: string; hiringManagerId: string };
type CandidateRow = {
  id: string;
  name: string;
  emailSealed: string | null;
  phoneSealed: string | null;
  consentWithdrawnAt: string | null;
  anonymised: boolean;
  openApplications: number;
  currentCompany: string | null;
  totalExperienceMonths: number;
  source: RecruitCandidate["source"];
  referrerEmployeeId: string | null;
  consentRecordedAt: string;
  retentionUntil: string;
  purgeEligible: boolean;
  notes: string | null;
  applicationCount: number;
  version: number;
  createdBy: string;
  createdAt: string;
};
type Locked = { version: number; [key: string]: unknown };

const requisitionSteps = {
  submit: { to: "pending_approval", action: "submitted" },
  approve: { to: "approved", action: "approved" },
  reject: { to: "rejected", action: "rejected" },
  open: { to: "open", action: "opened" },
  hold: { to: "on_hold", action: "held" },
  close: { to: "closed", action: "closed" },
  cancel: { to: "cancelled", action: "cancelled" },
} as const;
export type RequisitionStep = keyof typeof requisitionSteps;

// Who may do what, the stage and status matrices, the four-eyes rules, headcount and the
// double-booking checks all live in the database guards (053); the store seals contact
// details, shapes replies, takes locks in one order (requisition first, then the row) and
// writes audit and outbox rows that carry ids and states but never names or contact details.
export class RecruitStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal) {
    return (
      scopeFor(actor, "recruit.manage") ??
      scopeFor(actor, "recruit.request") ??
      scopeFor(actor, "recruit.interview")
    );
  }
  private hr(actor: Principal) {
    return scopeFor(actor, "recruit.manage") === "entity";
  }
  private see(actor: Principal) {
    if (!this.scope(actor))
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
  }
  private follow(actor: Principal) {
    if (!scopeFor(actor, "recruit.manage"))
      this.platform.require(actor, "recruit.request");
  }
  private get keys() {
    return profileKeys(this.platform.config);
  }
  // Keyed HMAC of the normalised email for duplicate detection, with the pinned hash key.
  private emailHash(email: string) {
    const ring = this.keys;
    const keyId = recruitHashKeyId(
      ring,
      this.platform.config.RECRUIT_HASH_KEY_ID,
    );
    return { keyId, hash: recruitEmailHash(ring, keyId, email) };
  }

  // ---- Requisitions ----
  async listRequisitions(
    actor: Principal,
    query: z.infer<typeof recruitRequisitionQuerySchema>,
  ): Promise<RecruitRequisitionList> {
    this.follow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($1='%%' OR r.title ILIKE $1 OR r.code ILIKE $1) AND ($2::text IS NULL OR r.status=$2)`;
      const params = [escapeLike(query.q), query.status ?? null];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM job_requisition r WHERE ${where}`,
        params,
      );
      const { rows } = await client.query<RequisitionRow>(
        `SELECT ${requisitionColumns} ${requisitionFrom} WHERE ${where}
         ORDER BY (r.status IN ('open','pending_approval','approved','on_hold','draft')) DESC, r.created_at DESC, r.id
         LIMIT $3 OFFSET $4`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return recruitRequisitionListSchema.parse({
        items: rows.map((row) => this.requisitionFlags(actor, row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          "SELECT status AS key, count(*)::int AS count FROM job_requisition GROUP BY status",
          [
            "draft",
            "pending_approval",
            "approved",
            "open",
            "on_hold",
            "closed",
            "rejected",
            "cancelled",
          ],
        ),
        canCreate: true,
      });
    });
  }

  // Pick-lists for the raise form. organization.read is HR-only, so requesters get just the
  // id, code and name of units in effect today in their own tenant and entity (RLS-scoped).
  async lookups(actor: Principal): Promise<RecruitLookups> {
    this.follow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<{
        kind: "department" | "location" | "designation";
        id: string;
        code: string;
        name: string;
      }>(
        `SELECT u.kind, u.id, u.code, u.name FROM org_unit u, recruit_entity_today() AS today
         WHERE u.kind IN ('department','location','designation') AND u.active AND u.merged_into_id IS NULL
           AND u.effective_from<=today AND (u.effective_to IS NULL OR u.effective_to>=today)
         ORDER BY lower(u.name), u.id`,
      );
      const pick = (kind: string) =>
        rows
          .filter((row) => row.kind === kind)
          .map(({ id, code, name }) => ({ id, code, name }));
      return recruitLookupsSchema.parse({
        departments: pick("department"),
        locations: pick("location"),
        designations: pick("designation"),
      });
    });
  }

  async requisitionDetail(actor: Principal, id: string) {
    this.follow(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.requisition(client, actor, id),
    );
  }

  async createRequisition(
    actor: Principal,
    input: z.infer<typeof recruitRequisitionCreateSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO job_requisition(id,tenant_id,entity_id,title,department_id,location_id,designation_id,headcount,
             employment_type,hiring_manager_id,description,target_start) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.title,
            input.departmentId,
            input.locationId,
            input.designationId ?? null,
            input.headcount,
            input.employmentType,
            input.hiringManagerId ?? actor.employeeId,
            input.description ?? null,
            input.targetStart ?? null,
          ],
        );
        const created = await this.requisition(client, actor, id);
        await this.record(
          client,
          actor,
          requestId,
          "recruit.requisition_created",
          `recruit-requisition:${id}`,
          id,
          1,
          {
            code: created.code,
            headcount: input.headcount,
            employmentType: input.employmentType,
            hiringManagerId: created.hiringManagerId,
          },
        );
        return created;
      }),
    );
  }

  async updateRequisition(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitRequisitionUpdateSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockRequisition(client, id, input.version);
        await client.query(
          `UPDATE job_requisition SET title=$2, department_id=$3, location_id=$4, designation_id=$5, headcount=$6,
             employment_type=$7, hiring_manager_id=$8, description=$9, target_start=$10, version=version+1 WHERE id=$1`,
          [
            id,
            input.title,
            input.departmentId,
            input.locationId,
            input.designationId ?? null,
            input.headcount,
            input.employmentType,
            input.hiringManagerId,
            input.description ?? null,
            input.targetStart ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.requisition_updated",
          `recruit-requisition:${id}`,
          id,
          row.version + 1,
          {
            fields: Object.keys(input).filter((k) => k !== "version"),
            headcount: input.headcount,
          },
        );
        return this.requisition(client, actor, id);
      }),
    );
  }

  async requisitionStep(
    actor: Principal,
    id: string,
    step: RequisitionStep,
    input: z.infer<typeof recruitRequisitionActionSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    const { to } = requisitionSteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockRequisition(client, id, input.version);
        await client.query(
          "UPDATE job_requisition SET status=$2, status_note=$3, version=version+1 WHERE id=$1",
          [id, to, input.note ?? row.statusNote ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.requisition_status_changed",
          `recruit-requisition:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, noteGiven: Boolean(input.note) },
        );
        return this.requisition(client, actor, id);
      }),
    );
  }

  // ---- Candidates (HR; others see a limited card through applications they follow) ----
  async listCandidates(
    actor: Principal,
    query: z.infer<typeof recruitCandidateQuerySchema>,
  ): Promise<RecruitCandidateList> {
    this.platform.require(actor, "recruit.manage");
    const ring = this.keys;
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($1='%%' OR c.name ILIKE $1 OR c.current_company ILIKE $1) AND ($2::text IS NULL OR c.source=$2)`;
      const params = [escapeLike(query.q), query.source ?? null];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM ats_candidate c WHERE ${where}`,
        params,
      );
      const { rows } = await client.query<CandidateRow>(
        `SELECT ${this.candidateColumns()} FROM ats_candidate c WHERE ${where}
         ORDER BY c.created_at DESC, c.id LIMIT $3 OFFSET $4`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      const purge = await this.count(
        client,
        `SELECT count(*)::int AS count FROM ats_candidate c WHERE c.anonymised_at IS NULL
           AND (c.consent_withdrawn_at IS NOT NULL OR c.retention_until<recruit_entity_today())`,
        [],
      );
      return recruitCandidateListSchema.parse({
        items: rows.map((row) => this.candidateView(ring, row, true)),
        total,
        page: query.page,
        limit: query.limit,
        counts: {
          total: await this.count(
            client,
            "SELECT count(*)::int AS count FROM ats_candidate",
            [],
          ),
          purgeEligible: purge,
        },
      });
    });
  }

  // HR's full read opens the sealed contact details and is audited (ids only, no outbox).
  async candidateDetail(
    actor: Principal,
    id: string,
    requestId: string = randomUUID(),
  ): Promise<RecruitCandidate> {
    this.follow(actor);
    if (this.hr(actor)) {
      const ring = this.keys;
      return scoped(this.platform.pool, actor, async (client) => {
        const { rows } = await client.query<CandidateRow>(
          `SELECT ${this.candidateColumns()} FROM ats_candidate c WHERE c.id=$1`,
          [id],
        );
        if (!rows[0])
          throw new NotFoundException("This candidate is unavailable.");
        await audit(
          client,
          actor,
          "recruit.candidate_viewed",
          `recruit-candidate:${id}`,
          requestId,
          { details: { candidateId: id } },
        );
        return this.candidateView(ring, rows[0]);
      });
    }
    // Hiring managers: name, company and experience only, from applications they follow.
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<{
        name: string;
        company: string | null;
        months: number;
        source: RecruitCandidate["source"];
        count: number;
      }>(
        `SELECT min(a.candidate_name) AS name, min(a.candidate_company) AS company,
           min(a.candidate_experience_months)::int AS months, min(a.source) AS source, count(*)::int AS count
         FROM recruit_application a WHERE a.candidate_id=$1 HAVING count(*)>0`,
        [id],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException("This candidate is unavailable.");
      return recruitCandidateSchema.parse({
        id,
        name: row.name,
        contactVisible: false,
        contactMasked: false,
        email: null,
        phone: null,
        currentCompany: row.company,
        totalExperienceMonths: row.months,
        source: row.source,
        referrerEmployeeId: null,
        consentRecordedAt: null,
        retentionUntil: null,
        consentWithdrawnAt: null,
        anonymised: false,
        purgeEligible: false,
        notes: null,
        applicationCount: row.count,
        version: 1,
        createdBy: null,
        createdAt: null,
        canExtendRetention: false,
        canWithdrawConsent: false,
        canAnonymise: false,
      });
    });
  }

  async createCandidate(
    actor: Principal,
    input: z.infer<typeof recruitCandidateCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    if (!input.consentGiven)
      throw new BadRequestException(
        "Record the candidate's consent before saving their details.",
      );
    const ring = this.keys;
    const id = randomUUID();
    const { hash, keyId } = this.emailHash(input.email);
    try {
      return await this.rules(() =>
        scoped(this.platform.pool, actor, async (client) => {
          await client.query(
            `INSERT INTO ats_candidate(id,tenant_id,entity_id,name,email_sealed,phone_sealed,email_hash,current_company,
               total_experience_months,source,referrer_employee_id,consent_given,retention_until,notes,hash_key_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              id,
              actor.tenantId,
              actor.entityId,
              input.name,
              sealValue(ring, id, EMAIL, input.email.trim().toLowerCase()),
              input.phone ? sealValue(ring, id, PHONE, input.phone) : null,
              hash,
              input.currentCompany ?? null,
              input.totalExperienceMonths,
              input.source,
              input.referrerEmployeeId ?? null,
              true,
              input.retentionUntil ?? null,
              input.notes ?? null,
              keyId,
            ],
          );
          const { rows } = await client.query<CandidateRow>(
            `SELECT ${this.candidateColumns()} FROM ats_candidate c WHERE c.id=$1`,
            [id],
          );
          await this.record(
            client,
            actor,
            requestId,
            "recruit.candidate_created",
            `recruit-candidate:${id}`,
            id,
            1,
            {
              source: input.source,
              hasPhone: Boolean(input.phone),
              retentionUntil: rows[0]!.retentionUntil,
            },
          );
          return this.candidateView(ring, rows[0]!);
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505" &&
        "constraint" in error &&
        error.constraint === "ats_candidate_email_hash_key"
      ) {
        // Only HR reaches this point, so naming the existing record is safe.
        const existing = await scoped(this.platform.pool, actor, (client) =>
          client.query<{ id: string; name: string }>(
            "SELECT id, name FROM ats_candidate WHERE email_hash=$1",
            [hash],
          ),
        );
        const found = existing.rows[0];
        throw new ConflictException(
          found
            ? `A candidate with this email already exists: ${found.name} (${found.id}).`
            : "A candidate with this email already exists.",
        );
      }
      throw error;
    }
  }

  async extendRetention(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitCandidateRetentionSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    const ring = this.keys;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('recruit-candidate:'||$1::text,0))",
          [id],
        );
        const found = await client.query<Locked>(
          "SELECT version FROM ats_candidate WHERE id=$1 FOR UPDATE",
          [id],
        );
        const row = this.fresh(found.rows[0], input.version, "candidate");
        await client.query(
          "UPDATE ats_candidate SET retention_until=$2, version=version+1 WHERE id=$1",
          [id, input.retentionUntil],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.candidate_retention_extended",
          `recruit-candidate:${id}`,
          id,
          row.version + 1,
          { retentionUntil: input.retentionUntil },
        );
        const { rows } = await client.query<CandidateRow>(
          `SELECT ${this.candidateColumns()} FROM ats_candidate c WHERE c.id=$1`,
          [id],
        );
        return this.candidateView(ring, rows[0]!);
      }),
    );
  }

  // Blocks new applications and interviews and makes the record eligible for anonymisation.
  async withdrawConsent(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitCandidateWithdrawConsentSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    const ring = this.keys;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('recruit-candidate:'||$1::text,0))",
          [id],
        );
        const found = await client.query<Locked>(
          "SELECT version FROM ats_candidate WHERE id=$1 FOR UPDATE",
          [id],
        );
        const row = this.fresh(found.rows[0], input.version, "candidate");
        await client.query(
          "UPDATE ats_candidate SET consent_withdrawal_reason=$2, version=version+1 WHERE id=$1",
          [id, input.reason],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.candidate_consent_withdrawn",
          `recruit-candidate:${id}`,
          id,
          row.version + 1,
          { candidateId: id },
        );
        const { rows } = await client.query<CandidateRow>(
          `SELECT ${this.candidateColumns()} FROM ats_candidate c WHERE c.id=$1`,
          [id],
        );
        return this.candidateView(ring, rows[0]!);
      }),
    );
  }

  // Irreversible; done by the database's writer function so every copy is cleared together.
  async anonymise(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitCandidateAnonymiseSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    const ring = this.keys;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const done = await client.query<{ version: number }>(
          "SELECT recruit_anonymise_candidate($1,$2) AS version",
          [id, input.reason],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.candidate_anonymised",
          `recruit-candidate:${id}`,
          id,
          done.rows[0]!.version,
          { candidateId: id },
        );
        const { rows } = await client.query<CandidateRow>(
          `SELECT ${this.candidateColumns()} FROM ats_candidate c WHERE c.id=$1`,
          [id],
        );
        return this.candidateView(ring, rows[0]!);
      }),
    );
  }

  // ---- Applications ----
  async listApplications(
    actor: Principal,
    query: z.infer<typeof recruitApplicationQuerySchema>,
  ): Promise<RecruitApplicationList> {
    this.follow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($1='%%' OR a.candidate_name ILIKE $1 OR r.title ILIKE $1 OR r.code ILIKE $1)
        AND ($2::text IS NULL OR a.stage=$2) AND ($3::uuid IS NULL OR a.requisition_id=$3)
        AND ($4::text IS NULL OR a.source=$4)`;
      const params = [
        escapeLike(query.q),
        query.stage ?? null,
        query.requisitionId ?? null,
        query.source ?? null,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count ${applicationFrom} WHERE ${where}`,
        params,
      );
      const { rows } = await client.query<ApplicationRow>(
        `SELECT ${applicationColumns} ${applicationFrom} WHERE ${where}
         ORDER BY a.updated_at DESC, a.id LIMIT $5 OFFSET $6`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return recruitApplicationListSchema.parse({
        items: rows.map((row) => this.applicationFlags(actor, row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT a.stage AS key, count(*)::int AS count FROM recruit_application a
           WHERE ($1::uuid IS NULL OR a.requisition_id=$1) GROUP BY a.stage`,
          STAGES,
          [query.requisitionId ?? null],
        ),
        canCreate: this.hr(actor),
      });
    });
  }

  async applicationDetail(
    actor: Principal,
    id: string,
  ): Promise<RecruitApplicationDetail> {
    this.follow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const application = await this.application(client, actor, id);
      const history = await client.query(
        `SELECT from_stage AS "fromStage", to_stage AS "toStage", reason, rejection_reason AS "rejectionReason",
           by_label AS by, ${stamp("h.at")} AS at FROM recruit_stage_history h WHERE h.application_id=$1 ORDER BY h.at, h.id`,
        [id],
      );
      const interviews = await client.query<InterviewRow>(
        `SELECT ${interviewColumns} FROM recruit_interview i WHERE i.application_id=$2 ORDER BY i.scheduled_at`,
        [actor.employeeId, id],
      );
      const offers = this.hr(actor)
        ? (
            await client.query<OfferRow>(
              `SELECT ${offerColumns} ${offerFrom} WHERE o.application_id=$1 ORDER BY o.created_at`,
              [id],
            )
          ).rows.map((row) => this.offerFlags(actor, row))
        : [];
      return recruitApplicationDetailSchema.parse({
        application,
        history: history.rows.map((row) =>
          recruitStageHistorySchema.parse(row),
        ),
        interviews: interviews.rows.map((row) => this.interviewFlags(row)),
        scorecards: await this.scorecardList(client, actor, id),
        offers,
      });
    });
  }

  async createApplication(
    actor: Principal,
    input: z.infer<typeof recruitApplicationCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.requisitionLock(client, input.requisitionId);
        const id = randomUUID();
        await client.query(
          `INSERT INTO recruit_application(id,tenant_id,entity_id,candidate_id,requisition_id) VALUES ($1,$2,$3,$4,$5)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.candidateId,
            input.requisitionId,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.application_created",
          `recruit-application:${id}`,
          id,
          1,
          {
            candidateId: input.candidateId,
            requisitionId: input.requisitionId,
          },
        );
        return this.application(client, actor, id);
      }),
    );
  }

  async changeStage(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitStageChangeSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    if (input.stage === "offer" || input.stage === "hired")
      throw new BadRequestException(
        "Applications reach the offer and hired stages through an offer.",
      );
    if (input.stage !== "rejected" && input.rejectionReason)
      throw new BadRequestException(
        "A rejection reason is given only when rejecting.",
      );
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockApplication(client, id, input.version);
        await client.query(
          "UPDATE recruit_application SET stage=$2, stage_reason=$3, rejection_reason=$4, version=version+1 WHERE id=$1",
          [
            id,
            input.stage,
            input.reason ?? null,
            input.rejectionReason ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.application_stage_changed",
          `recruit-application:${id}`,
          id,
          row.version + 1,
          {
            from: row.stage,
            to: input.stage,
            rejectionReason: input.rejectionReason ?? null,
            reasonGiven: Boolean(input.reason),
          },
        );
        return this.application(client, actor, id);
      }),
    );
  }

  // ---- Interviews ----
  async listInterviews(
    actor: Principal,
    query: z.infer<typeof recruitInterviewQuerySchema>,
    mine = false,
  ): Promise<RecruitInterviewList> {
    if (mine) this.see(actor);
    else this.follow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($2='%%' OR i.candidate_name ILIKE $2 OR i.requisition_title ILIKE $2 OR i.round_name ILIKE $2)
        AND ($3::text IS NULL OR i.status=$3) AND ($4::uuid IS NULL OR i.requisition_id=$4)
        AND ($5::uuid IS NULL OR i.application_id=$5)
        AND (NOT $6::boolean OR EXISTS(SELECT 1 FROM recruit_interview_panel p WHERE p.interview_id=i.id AND p.employee_id=$1))`;
      const params = [
        actor.employeeId,
        escapeLike(query.q),
        query.status ?? null,
        query.requisitionId ?? null,
        query.applicationId ?? null,
        mine,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM recruit_interview i WHERE ${where}`,
        params,
      );
      const { rows } = await client.query<InterviewRow>(
        `SELECT ${interviewColumns} FROM recruit_interview i WHERE ${where}
         ORDER BY (i.status='scheduled') DESC, i.scheduled_at, i.id LIMIT $7 OFFSET $8`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return recruitInterviewListSchema.parse({
        items: rows.map((row) => this.interviewFlags(row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT i.status AS key, count(*)::int AS count FROM recruit_interview i
           WHERE (NOT $2::boolean OR EXISTS(SELECT 1 FROM recruit_interview_panel p WHERE p.interview_id=i.id AND p.employee_id=$1))
           GROUP BY i.status`,
          ["scheduled", "completed", "cancelled", "no_show"],
          [actor.employeeId, mine],
        ),
      });
    });
  }

  async interviewDetail(actor: Principal, id: string) {
    this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.interview(client, actor, id),
    );
  }

  async createInterview(
    actor: Principal,
    input: z.infer<typeof recruitInterviewCreateSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const app = await client.query<{ requisitionId: string }>(
          `SELECT requisition_id AS "requisitionId" FROM recruit_application WHERE id=$1`,
          [input.applicationId],
        );
        if (!app.rows[0])
          throw new NotFoundException("This application is unavailable.");
        await this.requisitionLock(client, app.rows[0].requisitionId);
        const id = randomUUID();
        await client.query(
          `INSERT INTO recruit_interview(id,tenant_id,entity_id,application_id,round_name,scheduled_at,duration_minutes,
             mode,location_or_link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.applicationId,
            input.roundName,
            input.scheduledAt,
            input.durationMinutes,
            input.mode,
            input.locationOrLink ?? null,
          ],
        );
        // Sorted, so concurrent bookings take interviewer locks in the same order.
        for (const employeeId of [...input.panel].sort())
          await client.query(
            `INSERT INTO recruit_interview_panel(interview_id,employee_id,tenant_id,entity_id) VALUES ($1,$2,$3,$4)`,
            [id, employeeId, actor.tenantId, actor.entityId],
          );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.interview_scheduled",
          `recruit-interview:${id}`,
          id,
          1,
          {
            applicationId: input.applicationId,
            panelSize: input.panel.length,
            durationMinutes: input.durationMinutes,
            mode: input.mode,
          },
        );
        return this.interview(client, actor, id);
      }),
    );
  }

  async rescheduleInterview(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitInterviewRescheduleSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockInterview(client, id, input.version);
        await client.query(
          `UPDATE recruit_interview SET scheduled_at=$2, duration_minutes=$3, mode=$4, location_or_link=$5,
             version=version+1 WHERE id=$1`,
          [
            id,
            input.scheduledAt,
            input.durationMinutes,
            input.mode,
            input.locationOrLink ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.interview_rescheduled",
          `recruit-interview:${id}`,
          id,
          row.version + 1,
          { durationMinutes: input.durationMinutes, mode: input.mode },
        );
        return this.interview(client, actor, id);
      }),
    );
  }

  async interviewStatus(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitInterviewStatusChangeSchema>,
    requestId: string,
  ) {
    this.follow(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockInterview(client, id, input.version);
        await client.query(
          "UPDATE recruit_interview SET status=$2, status_note=$3, version=version+1 WHERE id=$1",
          [id, input.status, input.note ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.interview_status_changed",
          `recruit-interview:${id}`,
          id,
          row.version + 1,
          { from: row.status, to: input.status },
        );
        return this.interview(client, actor, id);
      }),
    );
  }

  async scorecards(actor: Principal, interviewId: string) {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const interview = await this.interview(client, actor, interviewId);
      return this.scorecardList(client, actor, interview.applicationId);
    });
  }

  async submitScorecard(
    actor: Principal,
    interviewId: string,
    input: z.infer<typeof recruitScorecardCreateSchema>,
    requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const interview = await this.interview(client, actor, interviewId);
        await this.requisitionLock(client, interview.requisitionId);
        const id = randomUUID();
        const ratings = Object.fromEntries(
          Object.entries(input.ratings).filter(([, v]) => v !== undefined),
        );
        await client.query(
          `INSERT INTO recruit_scorecard(id,tenant_id,entity_id,interview_id,interviewer_employee_id,ratings,recommendation,comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            interviewId,
            actor.employeeId,
            JSON.stringify(ratings),
            input.recommendation,
            input.comment ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.scorecard_submitted",
          `recruit-scorecard:${id}`,
          id,
          1,
          { interviewId, applicationId: interview.applicationId },
        );
        return this.scorecardList(client, actor, interview.applicationId);
      }),
    );
  }

  // ---- Offers (HR) ----
  async listOffers(
    actor: Principal,
    query: z.infer<typeof recruitOfferQuerySchema>,
  ): Promise<RecruitOfferList> {
    this.platform.require(actor, "recruit.manage");
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($1='%%' OR a.candidate_name ILIKE $1 OR o.title ILIKE $1)
        AND ($2::text IS NULL OR o.status=$2) AND ($3::uuid IS NULL OR o.requisition_id=$3)`;
      const params = [
        escapeLike(query.q),
        query.status ?? null,
        query.requisitionId ?? null,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count ${offerFrom} WHERE ${where}`,
        params,
      );
      const { rows } = await client.query<OfferRow>(
        `SELECT ${offerColumns} ${offerFrom} WHERE ${where} ORDER BY o.updated_at DESC, o.id LIMIT $4 OFFSET $5`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return recruitOfferListSchema.parse({
        items: rows.map((row) => this.offerFlags(actor, row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          "SELECT status AS key, count(*)::int AS count FROM recruit_offer GROUP BY status",
          [
            "draft",
            "pending_approval",
            "approved",
            "sent",
            "accepted",
            "declined",
            "expired",
            "withdrawn",
          ],
        ),
      });
    });
  }

  async createOffer(
    actor: Principal,
    input: z.infer<typeof recruitOfferCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const app = await client.query<Locked>(
          `SELECT requisition_id AS "requisitionId", stage, version FROM recruit_application WHERE id=$1`,
          [input.applicationId],
        );
        if (!app.rows[0])
          throw new NotFoundException("This application is unavailable.");
        await this.requisitionLock(client, String(app.rows[0].requisitionId));
        const locked = await this.lockApplication(
          client,
          input.applicationId,
          app.rows[0].version,
        );
        const id = randomUUID();
        await client.query(
          `INSERT INTO recruit_offer(id,tenant_id,entity_id,application_id,department_id,location_id,designation_id,
             manager_id,proposed_joining_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.applicationId,
            input.departmentId ?? null,
            input.locationId ?? null,
            input.designationId ?? null,
            input.managerId ?? null,
            input.proposedJoiningDate,
          ],
        );
        // Making an offer moves the application to the offer stage in the same step.
        await client.query(
          "UPDATE recruit_application SET stage='offer', stage_reason=NULL, rejection_reason=NULL, version=version+1 WHERE id=$1",
          [input.applicationId],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.offer_created",
          `recruit-offer:${id}`,
          id,
          1,
          { applicationId: input.applicationId },
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.application_stage_changed",
          `recruit-application:${input.applicationId}`,
          input.applicationId,
          locked.version + 1,
          { from: locked.stage, to: "offer", rejectionReason: null },
        );
        return this.offer(client, actor, id);
      }),
    );
  }

  async offerStep(
    actor: Principal,
    id: string,
    to: "pending_approval" | "approved" | "sent" | "withdrawn",
    input: z.infer<typeof recruitOfferActionSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockOffer(client, id, input.version);
        await client.query(
          "UPDATE recruit_offer SET status=$2, status_note=coalesce($3,status_note), version=version+1 WHERE id=$1",
          [id, to, input.note ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.offer_status_changed",
          `recruit-offer:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, applicationId: row.applicationId },
        );
        return this.offer(client, actor, id);
      }),
    );
  }

  async declineOffer(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitOfferDeclineSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "recruit.manage");
    const to = input.expired ? "expired" : "declined";
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockOffer(client, id, input.version);
        await client.query(
          "UPDATE recruit_offer SET status=$2, responded_on=$3, status_note=coalesce($4,status_note), version=version+1 WHERE id=$1",
          [id, to, input.respondedOn, input.note ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.offer_status_changed",
          `recruit-offer:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, applicationId: row.applicationId },
        );
        return this.offer(client, actor, id);
      }),
    );
  }

  // Accepting records the candidate's answer (taken by HR), marks the application hired within
  // the requisition's headcount and creates a draft pre-boarding record through the same
  // candidate_case insert the onboarding module uses, all in one transaction.
  async acceptOffer(
    actor: Principal,
    id: string,
    input: z.infer<typeof recruitOfferAcceptSchema>,
    requestId: string,
  ): Promise<RecruitOfferAccepted> {
    this.platform.require(actor, "recruit.manage");
    this.platform.require(actor, "onboarding.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockOffer(client, id, input.version);
        const offer = await this.offer(client, actor, id);
        if (offer.status !== "sent")
          throw new ConflictException(
            "Record an answer only for an offer that was sent.",
          );
        const app = await client.query<Locked>(
          "SELECT stage, version FROM recruit_application WHERE id=$1 FOR UPDATE",
          [offer.applicationId],
        );
        if (!app.rows[0])
          throw new NotFoundException("This application is unavailable.");
        const caseId = randomUUID();
        await client.query(
          `INSERT INTO candidate_case(id,tenant_id,entity_id,name,email,title,department_id,location_id,manager_id,joined_on)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            caseId,
            actor.tenantId,
            actor.entityId,
            offer.candidateName,
            input.preboardingEmail.toLowerCase(),
            offer.title,
            offer.departmentId,
            offer.locationId,
            offer.managerId,
            offer.proposedJoiningDate,
          ],
        );
        await client.query(
          "UPDATE recruit_offer SET status='accepted', responded_on=$2, candidate_case_id=$3, version=version+1 WHERE id=$1",
          [id, input.respondedOn, caseId],
        );
        await client.query(
          "UPDATE recruit_application SET stage='hired', stage_reason=NULL, rejection_reason=NULL, version=version+1 WHERE id=$1",
          [offer.applicationId],
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.offer_status_changed",
          `recruit-offer:${id}`,
          id,
          row.version + 1,
          {
            from: "sent",
            to: "accepted",
            applicationId: offer.applicationId,
            candidateCaseId: caseId,
          },
        );
        await this.record(
          client,
          actor,
          requestId,
          "recruit.application_stage_changed",
          `recruit-application:${offer.applicationId}`,
          offer.applicationId,
          Number(app.rows[0]!.version) + 1,
          { from: app.rows[0]!.stage, to: "hired", rejectionReason: null },
        );
        // Same audit and outbox shape as a pre-boarding record created in Onboarding.
        await audit(client, actor, "candidate.created", caseId, requestId, {
          reason: "Created from an accepted offer",
        });
        await client.query(
          "INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            "candidate.created.v1",
            caseId,
            1,
          ],
        );
        return recruitOfferAcceptedSchema.parse({
          offer: await this.offer(client, actor, id),
          application: await this.application(
            client,
            actor,
            offer.applicationId,
          ),
          candidateCaseId: caseId,
          preboarding:
            "A draft pre-boarding record was created in Onboarding with the offer's department, location, manager and joining date. No email has been sent; invite the candidate from Onboarding. The preview accepts only synthetic @anvi.example addresses.",
        });
      }),
    );
  }

  // ---- Funnel (aggregates only) ----
  async funnel(
    actor: Principal,
    query: z.infer<typeof recruitFunnelQuerySchema>,
  ): Promise<RecruitFunnel> {
    this.follow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const req = query.requisitionId ?? null;
      const stages = await client.query<{
        stage: string;
        current: number;
        reached: number;
        avgDays: number | null;
      }>(
        `WITH apps AS (SELECT a.id, a.stage FROM recruit_application a WHERE ($1::uuid IS NULL OR a.requisition_id=$1)),
         spans AS (SELECT h.application_id, h.to_stage,
            extract(epoch FROM coalesce(lead(h.at) OVER (PARTITION BY h.application_id ORDER BY h.at, h.id), now())-h.at)/86400 AS days
          FROM recruit_stage_history h WHERE h.application_id IN (SELECT id FROM apps))
         SELECT s.stage,
           (SELECT count(*)::int FROM apps WHERE apps.stage=s.stage) AS current,
           (SELECT count(DISTINCT application_id)::int FROM spans WHERE to_stage=s.stage) AS reached,
           (SELECT round(avg(days)::numeric,1)::float8 FROM spans WHERE to_stage=s.stage) AS "avgDays"
         FROM unnest($2::text[]) AS s(stage)`,
        [req, STAGES],
      );
      const total = await this.count(
        client,
        "SELECT count(*)::int AS count FROM recruit_application a WHERE ($1::uuid IS NULL OR a.requisition_id=$1)",
        [req],
      );
      const sources = await client.query<{ source: string; count: number }>(
        `SELECT a.source, count(*)::int AS count FROM recruit_application a
         WHERE ($1::uuid IS NULL OR a.requisition_id=$1) GROUP BY a.source ORDER BY count(*) DESC, a.source`,
        [req],
      );
      const summary = await client.query<{
        open: number;
        onHold: number;
        pendingApproval: number;
        openHeadcount: number;
        filled: number;
      }>(
        `SELECT count(*) FILTER (WHERE r.status='open')::int AS open,
           count(*) FILTER (WHERE r.status='on_hold')::int AS "onHold",
           count(*) FILTER (WHERE r.status='pending_approval')::int AS "pendingApproval",
           coalesce(sum(r.headcount) FILTER (WHERE r.status IN ('open','on_hold')),0)::int AS "openHeadcount",
           (SELECT count(*)::int FROM recruit_application a WHERE a.stage='hired'
             AND a.requisition_id IN (SELECT id FROM job_requisition WHERE status IN ('open','on_hold'))) AS filled
         FROM job_requisition r WHERE ($1::uuid IS NULL OR r.id=$1)`,
        [req],
      );
      const per = await client.query(
        `SELECT r.id AS "requisitionId", r.code, r.title, r.status, r.headcount,
           (SELECT count(*)::int FROM recruit_application a WHERE a.requisition_id=r.id AND a.stage='hired') AS "filledCount",
           (SELECT count(*)::int FROM recruit_application a WHERE a.requisition_id=r.id) AS applications
         FROM job_requisition r WHERE ($1::uuid IS NULL OR r.id=$1)
           AND ($1::uuid IS NOT NULL OR r.status IN ('open','on_hold','approved','pending_approval'))
         ORDER BY r.created_at DESC LIMIT 50`,
        [req],
      );
      return recruitFunnelSchema.parse({
        requisitionId: req,
        totalApplications: total,
        stages: stages.rows.map((row) => ({
          stage: row.stage,
          current: row.current,
          reached: row.reached,
          conversionPercent:
            total === 0 ? null : Math.round((row.reached / total) * 1000) / 10,
          averageDaysInStage: row.avgDays,
        })),
        sources: sources.rows,
        requisitions: summary.rows[0],
        perRequisition: per.rows,
      });
    });
  }

  // ---- Readers and flags ----
  private async requisition(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<RecruitRequisition> {
    const { rows } = await client.query<RequisitionRow>(
      `SELECT ${requisitionColumns} ${requisitionFrom} WHERE r.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This requisition is unavailable.");
    return this.requisitionFlags(actor, rows[0]);
  }
  private requisitionFlags(
    actor: Principal,
    row: RequisitionRow,
  ): RecruitRequisition {
    const hr = this.hr(actor);
    const me = actor.employeeId;
    const mine =
      scopeFor(actor, "recruit.request") === "team" &&
      (row.hiringManagerId === me || row.requestedByEmployeeId === me);
    const s = row.status;
    return recruitRequisitionSchema.parse({
      ...row,
      canEdit:
        (s === "draft" && (hr || mine)) ||
        (hr && ["approved", "open", "on_hold"].includes(s)),
      canSubmit: s === "draft" && (hr || mine),
      canDecide:
        s === "pending_approval" &&
        hr &&
        me !== row.requestedByEmployeeId &&
        me !== row.hiringManagerId &&
        me !== row.reapprovalRequestedByEmployeeId,
      canOpen: hr && (s === "approved" || s === "on_hold"),
      canHold: hr && s === "open",
      canClose: hr && (s === "open" || s === "on_hold"),
      canCancel:
        ((s === "draft" || s === "pending_approval") && (hr || mine)) ||
        (hr && s === "approved"),
      canAddCandidates: hr && s === "open",
    });
  }

  private candidateColumns() {
    return `c.id, c.name, c.email_sealed AS "emailSealed", c.phone_sealed AS "phoneSealed",
      c.current_company AS "currentCompany", c.total_experience_months AS "totalExperienceMonths", c.source,
      c.referrer_employee_id AS "referrerEmployeeId", ${stamp("c.consent_recorded_at")} AS "consentRecordedAt",
      ${day("c.retention_until")} AS "retentionUntil",
      (c.anonymised_at IS NULL AND (c.consent_withdrawn_at IS NOT NULL
        OR c.retention_until<recruit_entity_today())) AS "purgeEligible",
      ${stamp("c.consent_withdrawn_at")} AS "consentWithdrawnAt", (c.anonymised_at IS NOT NULL) AS anonymised,
      (SELECT count(*)::int FROM recruit_application a WHERE a.candidate_id=c.id
        AND a.stage NOT IN ('rejected','withdrawn')) AS "openApplications",
      c.notes, (SELECT count(*)::int FROM recruit_application a WHERE a.candidate_id=c.id) AS "applicationCount",
      c.version, c.created_by_label AS "createdBy", ${stamp("c.created_at")} AS "createdAt"`;
  }
  private candidateView(
    ring: ReturnType<typeof profileKeys>,
    row: CandidateRow,
    masked = false,
  ): RecruitCandidate {
    const open = (column: string, sealed: string | null) => {
      try {
        return openValue(ring, row.id, column, sealed);
      } catch {
        return null;
      }
    };
    const email = open(EMAIL, row.emailSealed);
    const phone = open(PHONE, row.phoneSealed);
    const live = !row.anonymised;
    return recruitCandidateSchema.parse({
      id: row.id,
      name: row.name,
      contactVisible: live,
      contactMasked: masked,
      email: masked ? maskEmail(email) : email,
      phone: masked ? maskPhone(phone) : phone,
      consentWithdrawnAt: row.consentWithdrawnAt,
      anonymised: row.anonymised,
      canWithdrawConsent: live && !row.consentWithdrawnAt,
      canAnonymise: row.purgeEligible && row.openApplications === 0,
      currentCompany: row.currentCompany,
      totalExperienceMonths: row.totalExperienceMonths,
      source: row.source,
      referrerEmployeeId: row.referrerEmployeeId,
      consentRecordedAt: row.consentRecordedAt,
      retentionUntil: row.retentionUntil,
      purgeEligible: row.purgeEligible,
      notes: row.notes,
      applicationCount: row.applicationCount,
      version: row.version,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      canExtendRetention: live && !row.consentWithdrawnAt,
    });
  }

  private async application(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<RecruitApplication> {
    const { rows } = await client.query<ApplicationRow>(
      `SELECT ${applicationColumns} ${applicationFrom} WHERE a.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This application is unavailable.");
    return this.applicationFlags(actor, rows[0]);
  }
  private applicationFlags(
    actor: Principal,
    row: ApplicationRow,
  ): RecruitApplication {
    const hr = this.hr(actor);
    const manages =
      hr ||
      (scopeFor(actor, "recruit.request") === "team" &&
        row.hiringManagerId === actor.employeeId);
    const open = row.requisitionStatus === "open";
    const offer = row.activeOffer;
    const rank = RANK[row.stage] ?? 0;
    const allowed: RecruitStage[] = [];
    if (manages && row.stage !== "hired") {
      if (row.stage === "rejected" || row.stage === "withdrawn") {
        // After an offer, a reopened application returns to assessment.
        if (hr && open && row.previousStage)
          allowed.push(
            row.previousStage === "offer" ? "assessment" : row.previousStage,
          );
      } else {
        if (open && rank < 4)
          for (const stage of ["screening", "interview", "assessment"] as const)
            if (RANK[stage]! > rank) allowed.push(stage);
        if (hr && rank > 1 && !offer)
          allowed.push(STAGES[rank - 2] as RecruitStage);
        if (!offer) {
          allowed.push("rejected");
          if (hr) allowed.push("withdrawn");
        }
      }
    }
    const rest: Partial<ApplicationRow> = { ...row };
    delete rest.requisitionStatus;
    delete rest.hiringManagerId;
    delete rest.activeOffer;
    return recruitApplicationSchema.parse({
      ...rest,
      allowedStages: allowed,
      canScheduleInterview:
        manages && ["screening", "interview", "assessment"].includes(row.stage),
      canMakeOffer:
        hr && open && !offer && ["interview", "assessment"].includes(row.stage),
    });
  }

  private async interview(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<RecruitInterview> {
    const { rows } = await client.query<InterviewRow>(
      `SELECT ${interviewColumns} FROM recruit_interview i WHERE i.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw new NotFoundException("This interview is unavailable.");
    return this.interviewFlags(rows[0]);
  }
  private interviewFlags(row: InterviewRow): RecruitInterview {
    const { started, manages, ...rest } = row;
    const scheduled = row.status === "scheduled";
    return recruitInterviewSchema.parse({
      ...rest,
      canReschedule: manages && scheduled,
      canChangeStatus: manages && scheduled,
      canSubmitScorecard:
        row.onPanel &&
        !row.myScorecardSubmitted &&
        (row.status === "completed" || (scheduled && started)),
    });
  }

  private async scorecardList(
    client: PoolClient,
    actor: Principal,
    applicationId: string,
  ) {
    const { rows } = await client.query(
      `SELECT ${scorecardColumns} FROM recruit_scorecard s WHERE s.application_id=$2 ORDER BY s.submitted_at, s.id`,
      [actor.employeeId, applicationId],
    );
    const follows = await client.query<{ follows: boolean }>(
      "SELECT recruit_sees_application($1) AS follows",
      [applicationId],
    );
    return recruitScorecardListSchema.parse({
      items: rows,
      blind:
        !follows.rows[0]?.follows &&
        !rows.some((row: { mine: boolean }) => row.mine),
    });
  }

  private async offer(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<RecruitOffer> {
    const { rows } = await client.query<OfferRow>(
      `SELECT ${offerColumns} ${offerFrom} WHERE o.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This offer is unavailable.");
    return this.offerFlags(actor, rows[0]);
  }
  private offerFlags(actor: Principal, row: OfferRow): RecruitOffer {
    const { createdByEmployee, hiringManagerId, ...rest } = row;
    const s = row.status;
    const me = actor.employeeId;
    return recruitOfferSchema.parse({
      ...rest,
      canSubmit: s === "draft",
      canApprove:
        s === "pending_approval" &&
        ![createdByEmployee, row.managerId, hiringManagerId].includes(me),
      canSend: s === "approved",
      canRecordResponse: s === "sent",
      canWithdraw: ["draft", "pending_approval", "approved", "sent"].includes(
        s,
      ),
    });
  }

  // ---- Locks, counts, recording and errors ----
  private async requisitionLock(client: PoolClient, id: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('recruit-req:'||$1::text,0))",
      [id],
    );
  }
  private async lockRequisition(
    client: PoolClient,
    id: string,
    version: number,
  ) {
    await this.requisitionLock(client, id);
    const found = await client.query<Locked>(
      `SELECT status, status_note AS "statusNote", version FROM job_requisition WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return this.fresh(found.rows[0], version, "requisition");
  }
  private async lockApplication(
    client: PoolClient,
    id: string,
    version: number,
  ) {
    const req = await client.query<{ requisitionId: string }>(
      `SELECT requisition_id AS "requisitionId" FROM recruit_application WHERE id=$1`,
      [id],
    );
    if (req.rows[0])
      await this.requisitionLock(client, req.rows[0].requisitionId);
    const found = await client.query<Locked>(
      "SELECT stage, version FROM recruit_application WHERE id=$1 FOR UPDATE",
      [id],
    );
    return this.fresh(found.rows[0], version, "application");
  }
  private async lockInterview(client: PoolClient, id: string, version: number) {
    const req = await client.query<{ requisitionId: string }>(
      `SELECT requisition_id AS "requisitionId" FROM recruit_interview WHERE id=$1`,
      [id],
    );
    if (req.rows[0])
      await this.requisitionLock(client, req.rows[0].requisitionId);
    const found = await client.query<Locked>(
      "SELECT status, version FROM recruit_interview WHERE id=$1 FOR UPDATE",
      [id],
    );
    return this.fresh(found.rows[0], version, "interview");
  }
  private async lockOffer(client: PoolClient, id: string, version: number) {
    const req = await client.query<{ requisitionId: string }>(
      `SELECT requisition_id AS "requisitionId" FROM recruit_offer WHERE id=$1`,
      [id],
    );
    if (req.rows[0])
      await this.requisitionLock(client, req.rows[0].requisitionId);
    const found = await client.query<Locked>(
      `SELECT status, application_id AS "applicationId", version FROM recruit_offer WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return this.fresh(found.rows[0], version, "offer");
  }
  private fresh(row: Locked | undefined, version: number, what: string) {
    if (!row) throw new NotFoundException(`This ${what} is unavailable.`);
    if (row.version !== version)
      throw new ConflictException(
        `This ${what} changed. Reload it before trying again.`,
      );
    return row;
  }
  private async count(client: PoolClient, sql: string, params: unknown[]) {
    const { rows } = await client.query<{ count: number }>(sql, params);
    return rows[0]?.count ?? 0;
  }
  private async counts(
    client: PoolClient,
    sql: string,
    keys: readonly string[],
    params: unknown[] = [],
  ) {
    const counts: Record<string, number> = Object.fromEntries(
      keys.map((k) => [k, 0]),
    );
    for (const row of (
      await client.query<{ key: string; count: number }>(sql, params)
    ).rows)
      counts[row.key] = row.count;
    return counts;
  }

  // Audit and outbox carry ids, states and codes only: never names, emails or phones.
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
            "A referenced person, requisition, candidate or unit is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "23505") {
          const constraint =
            "constraint" in error ? String(error.constraint) : "";
          const message = uniqueMessages[constraint];
          if (message) throw new ConflictException(message);
          // createCandidate names the existing record itself (HR only).
          if (constraint === "ats_candidate_email_hash_key") throw error;
          throw new ConflictException("This already exists.");
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
