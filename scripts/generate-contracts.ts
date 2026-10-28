import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import {
  brandingSchema,
  brandingUpdateSchema,
  brandingHistorySchema,
  brandingRollbackSchema,
  permissionMatrixSchema,
  integrationReadinessSchema,
  directorySchema,
  dashboardSchema,
  meSchema,
  auditSchema,
  authConfigSchema,
  roleSchema,
  organizationDirectorySchema,
  organizationUnitSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  organizationKindSchema,
  organizationDetailSchema,
  organizationMergeSchema,
  employeeDetailSchema,
  employeeClassificationUpdateSchema,
  employeeClassificationSchema,
  organizationMergeResultSchema,
  organizationChartSchema,
  orgChartSearchSchema,
  orgChartNeighborhoodSchema,
  candidateListSchema,
  candidateOptionsSchema,
  candidateDetailSchema,
  candidateCreateSchema,
  candidateSchema,
  candidateActionSchema,
  candidateReviewSchema,
  candidateDeliverySchema,
  candidateChallengeSchema,
  candidateExchangeSchema,
  candidateSaveSchema,
  candidateSubmitSchema,
  candidatePortalSchema,
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  candidateTaskAssignmentSchema,
  assignedTaskUpdateSchema,
  assignedTaskListSchema,
  localReviewProposalSchema,
  localReviewDecisionSchema,
  leaveOverviewSchema,
  leaveApprovalsSchema,
  leaveRequestSchema,
  leaveRequestCreateSchema,
  leaveCancelSchema,
  leaveDecisionSchema,
  attendanceOverviewSchema,
  attendanceTeamSchema,
  attendanceRecordSchema,
  attendanceCorrectionSchema,
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceCorrectionCreateSchema,
  attendanceCancelSchema,
  attendanceDecisionSchema,
  calendarSchema,
  holidaySchema,
  holidayCreateSchema,
  holidayUpdateSchema,
  workWeekSchema,
  workWeekUpdateSchema,
  approvalInboxSchema,
  employeeDocumentSchema,
  documentListSchema,
  documentReviewSchema,
  documentWithdrawSchema,
  documentDecisionSchema,
  reportCatalogSchema,
  reportRunSchema,
  reportResultSchema,
  reportExportSchema,
  savedReportSchema,
  savedReportListSchema,
  savedReportCreateSchema,
  savedReportUpdateSchema,
  savedReportArchiveSchema,
  projectSchema,
  projectListSchema,
  projectCreateSchema,
  projectUpdateSchema,
  projectStatusChangeSchema,
  projectMemberListSchema,
  projectMemberAddSchema,
  projectMemberRemoveSchema,
  projectTaskSchema,
  projectTaskListSchema,
  projectTaskCreateSchema,
  projectTaskUpdateSchema,
  projectTaskStatusChangeSchema,
  timeEntrySchema,
  myTimeSchema,
  timeReviewSchema,
  timeEntryCreateSchema,
  timeEntryWithdrawSchema,
  timeEntryApproveSchema,
  timeEntryRejectSchema,
  recruitRequisitionSchema,
  recruitRequisitionListSchema,
  recruitRequisitionCreateSchema,
  recruitRequisitionUpdateSchema,
  recruitRequisitionActionSchema,
  recruitRequisitionReasonSchema,
  recruitCandidateSchema,
  recruitCandidateListSchema,
  recruitCandidateCreateSchema,
  recruitCandidateRetentionSchema,
  recruitCandidateWithdrawConsentSchema,
  recruitCandidateAnonymiseSchema,
  recruitApplicationSchema,
  recruitApplicationListSchema,
  recruitApplicationDetailSchema,
  recruitApplicationCreateSchema,
  recruitStageChangeSchema,
  recruitInterviewSchema,
  recruitInterviewListSchema,
  recruitInterviewCreateSchema,
  recruitInterviewRescheduleSchema,
  recruitInterviewStatusChangeSchema,
  recruitScorecardListSchema,
  recruitScorecardCreateSchema,
  recruitOfferSchema,
  recruitOfferListSchema,
  recruitOfferCreateSchema,
  recruitOfferActionSchema,
  recruitOfferWithdrawSchema,
  recruitOfferDeclineSchema,
  recruitOfferAcceptSchema,
  recruitOfferAcceptedSchema,
  recruitFunnelSchema,
} from "../packages/contracts/src/index";
const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, { target: "draft-2020-12", unrepresentable: "throw" });
const json = (value: z.ZodType) => ({
  "application/json": { schema: schema(value) },
});
const response = (value: z.ZodType, description = "Success") => ({
  description,
  content: json(value),
});
const problemSchema = {
  type: "object",
  properties: {
    status: { type: "integer" },
    title: { type: "string" },
    code: { type: "string" },
    requestId: { type: "string" },
  },
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 429, 500].map((status) => [
    status,
    {
      description: `HTTP ${status}`,
      content: { "application/problem+json": { schema: problemSchema } },
    },
  ]),
);
const read = (summary: string, value: z.ZodType) => ({
  summary,
  responses: { "200": response(value), ...errors },
});
const write = (
  summary: string,
  input?: z.ZodType,
  output: z.ZodType = z.object({ changed: z.boolean() }),
  status = "201",
) => ({
  summary,
  security: [{ session: [], csrf: [] }],
  ...(input ? { requestBody: { required: true, content: json(input) } } : {}),
  responses: { [status]: response(output), ...errors },
});
const spec = {
  openapi: "3.1.0",
  info: {
    title: "AnviOne foundation API",
    version: "0.7.0",
    description:
      "Synthetic foundation preview. Session origin checks apply to all mutations. Production requires separately verified corporate OIDC. Local HTTP uses anvi_dev_session instead of the production cookie.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ session: [] }],
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "__Host-anvi_session" },
      csrf: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
    },
  },
  paths: {
    "/auth/config": {
      get: { ...read("Authentication mode", authConfigSchema), security: [] },
    },
    "/auth/demo": {
      post: {
        ...write(
          "Loopback development-only synthetic login",
          undefined,
          z.object({ signedIn: z.boolean() }),
        ),
        security: [],
      },
    },
    "/auth/login": {
      get: {
        summary: "Start approved corporate OIDC flow",
        security: [],
        responses: {
          "302": { description: "Redirect to configured provider" },
          ...errors,
        },
      },
    },
    "/auth/callback": {
      get: {
        summary: "Validate single-use OIDC callback",
        security: [],
        responses: {
          "302": { description: "Redirect to workspace or safe login error" },
        },
      },
    },
    "/auth/logout": {
      post: write(
        "Revoke current session",
        undefined,
        z.object({ signedOut: z.boolean() }),
      ),
    },
    "/me": { get: read("Current approved actor and effective role", meSchema) },
    "/session/role-context": {
      post: write(
        "Rotate session into an assigned role",
        z.object({ role: roleSchema }).strict(),
      ),
    },
    "/employees": {
      get: {
        ...read("Scope-filtered professional directory", directorySchema),
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 80 } },
          {
            name: "department",
            in: "query",
            schema: { type: "string", maxLength: 60 },
          },
          {
            name: "location",
            in: "query",
            schema: { type: "string", maxLength: 60 },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 12 },
          },
        ],
      },
    },
    "/employees/{id}": {
      get: {
        ...read(
          "Authorized work profile, with designation, grade and cost centre",
          employeeDetailSchema,
        ),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
    "/dashboard": {
      get: read(
        "Counts and recent colleagues within the same directory scope",
        dashboardSchema,
      ),
    },
    "/branding/active": {
      get: read("Current entity branding", brandingSchema),
      put: write(
        "Publish version-checked branding, audit and outbox atomically",
        brandingUpdateSchema,
        brandingSchema,
        "200",
      ),
    },
    "/branding/history": {
      get: {
        ...read(
          "Branding version history, newest first (platform admin; at most 50 per page)",
          brandingHistorySchema,
        ),
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          },
          {
            name: "beforeVersion",
            in: "query",
            schema: { type: "integer", minimum: 2 },
          },
        ],
      },
    },
    "/branding/rollback": {
      post: write(
        "Publish a new branding version restoring a recorded one; version-checked, audited and outboxed atomically",
        brandingRollbackSchema,
        brandingSchema,
      ),
    },
    "/admin/permissions": {
      get: read(
        "Read-only role x permission matrix as defined in code",
        permissionMatrixSchema,
      ),
    },
    "/admin/integrations": {
      get: read(
        "Read-only integration readiness derived from configuration, without secrets",
        integrationReadinessSchema,
      ),
    },
    "/audit-events": {
      get: read("Auditor-only latest 50 entity audit events", auditSchema),
    },
    "/leave": {
      get: read(
        "Current actor's leave balances and latest 50 requests",
        leaveOverviewSchema,
      ),
    },
    "/leave/approvals": {
      get: read(
        "Pending and recently decided leave visible to the approver",
        leaveApprovalsSchema,
      ),
    },
    "/leave/requests": {
      post: write(
        "Request leave for the current actor",
        leaveRequestCreateSchema,
        leaveRequestSchema,
      ),
    },
    "/leave/requests/{id}/cancel": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Cancel your pending or future approved leave",
        leaveCancelSchema,
        leaveRequestSchema,
      ),
    },
    "/leave/requests/{id}/decision": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Approve or decline a routed leave request",
        leaveDecisionSchema,
        leaveRequestSchema,
      ),
    },
    "/attendance": {
      get: read(
        "Current actor's attendance today, last 30 days and corrections",
        attendanceOverviewSchema,
      ),
    },
    "/attendance/team": {
      get: read(
        "Today's presence and corrections visible to the reviewer",
        attendanceTeamSchema,
      ),
    },
    "/attendance/check-in": {
      post: write(
        "Check in now (server time)",
        attendanceCheckInSchema,
        attendanceRecordSchema,
      ),
    },
    "/attendance/check-out": {
      post: write(
        "Check out now (server time)",
        attendanceCheckOutSchema,
        attendanceRecordSchema,
      ),
    },
    "/attendance/corrections": {
      post: write(
        "Request a correction for one of the previous 30 days",
        attendanceCorrectionCreateSchema,
        attendanceCorrectionSchema,
      ),
    },
    "/attendance/corrections/{id}/cancel": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Cancel your pending correction",
        attendanceCancelSchema,
        attendanceCorrectionSchema,
      ),
    },
    "/attendance/corrections/{id}/decision": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Approve or decline a routed correction",
        attendanceDecisionSchema,
        attendanceCorrectionSchema,
      ),
    },
    "/calendar": {
      get: {
        ...read(
          "Work week and holidays for the current legal entity",
          calendarSchema,
        ),
        parameters: [
          {
            name: "year",
            in: "query",
            schema: { type: "integer", minimum: 2000, maximum: 2200 },
          },
        ],
      },
    },
    "/calendar/holidays": {
      post: write("Add a holiday (HR)", holidayCreateSchema, holidaySchema),
    },
    "/calendar/holidays/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      put: write(
        "Rename or (de)activate a holiday (HR)",
        holidayUpdateSchema,
        holidaySchema,
        "200",
      ),
    },
    "/calendar/work-week": {
      put: write(
        "Change the working week (HR)",
        workWeekUpdateSchema,
        workWeekSchema,
        "200",
      ),
    },
    "/approvals": {
      get: read(
        "Pending leave and attendance-correction decisions visible to the approver",
        approvalInboxSchema,
      ),
    },
    "/documents": {
      get: read("Current actor's documents, newest first", documentListSchema),
      post: {
        summary: "Upload a document (PDF, PNG or JPEG up to 5 MB)",
        security: [{ session: [], csrf: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["category", "title", "file"],
                properties: {
                  category: {
                    type: "string",
                    enum: ["identity", "education", "employment", "other"],
                  },
                  title: { type: "string", minLength: 2, maxLength: 80 },
                  file: { type: "string", format: "binary" },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: { "201": response(employeeDocumentSchema), ...errors },
      },
    },
    "/documents/review": {
      get: read(
        "Documents awaiting HR verification and recent decisions",
        documentReviewSchema,
      ),
    },
    "/documents/{id}/withdraw": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Withdraw your pending document",
        documentWithdrawSchema,
        employeeDocumentSchema,
      ),
    },
    "/documents/{id}/decision": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Verify or reject a document (HR)",
        documentDecisionSchema,
        employeeDocumentSchema,
      ),
    },
    "/documents/{id}/content": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      get: {
        summary: "Download a document as an attachment (audited)",
        responses: {
          "200": {
            description: "File bytes",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
            },
          },
          ...errors,
        },
      },
    },
    "/organization": {
      get: {
        ...read(
          "HR-only organization masters (department, location, designation, grade, cost centre) with effective status, within the current entity",
          organizationDirectorySchema,
        ),
        parameters: [
          {
            name: "kind",
            in: "query",
            schema: {
              type: "string",
              enum: organizationKindSchema.options,
              default: "department",
            },
          },
          { name: "q", in: "query", schema: { type: "string", maxLength: 80 } },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          },
        ],
      },
      post: write(
        "Create a scoped organization master with audit and outbox",
        organizationCreateSchema,
        organizationUnitSchema,
      ),
    },
    "/organization/chart": {
      get: {
        ...read(
          "Reporting chart limited to the caller's directory scope (HR entity, manager self and direct reports, employee self); depth counts levels including the root (depth=1 returns roots only), capped at 20 levels and 2000 people; truncated marks a partial chart",
          organizationChartSchema,
        ),
        parameters: [
          {
            name: "rootId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "depth",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 20, default: 20 },
          },
        ],
      },
    },
    "/organization/chart/search": {
      get: {
        ...read(
          "Search active and notice-period people of the caller's legal entity by name, title or department (literal text, 2-60 characters) for anyone with directory.read at any scope; returns only id, name, initials, title, department, managerId and directReportCount, ordered by name; at most 10; 120 searches a minute per person; not audited and the search text is never logged",
          orgChartSearchSchema,
        ),
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 2, maxLength: 60 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 10, default: 10 },
          },
        ],
      },
    },
    "/organization/chart/neighborhood/{employeeId}": {
      get: {
        ...read(
          "One person's reporting neighbourhood (manager one level up, up to 200 direct reports by name) with the same basic fields as search, for anyone with directory.read; unknown, former and other-entity people all answer 404; 120 lookups a minute per person; not audited",
          orgChartNeighborhoodSchema,
        ),
        parameters: [
          {
            name: "employeeId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
    "/people/{employeeId}/classification": {
      put: {
        ...write(
          "HR assigns or clears an employee's designation, grade and cost centre (null clears). A changed link must be a unit of that kind in effect in this entity; unchanged links are kept even if their unit has since ended. An unchanged replay writes nothing. Audit carries ids and codes only",
          employeeClassificationUpdateSchema,
          employeeClassificationSchema,
        ),
        parameters: [
          {
            name: "employeeId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
    "/organization/{id}/merge": {
      post: {
        ...write(
          "Merge a department or location into another in effect: moves every employee (current and former) and unfinished candidates, closes the source and records one audit row; refused while draft or published policies or active holidays still use the source; both versions are required",
          organizationMergeSchema,
          organizationMergeResultSchema,
        ),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
    "/organization/{id}": {
      get: {
        ...read(
          "One organization master with what it was merged into and what was merged into it",
          organizationDetailSchema,
        ),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
      put: {
        ...write(
          "Rename, change active state or effective window with a version and recorded reason",
          organizationUpdateSchema,
          organizationUnitSchema,
          "200",
        ),
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
  },
};
const idParameter = [
  {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
];
Object.assign(spec.paths, {
  "/candidates/{id}/local-reviews": {
    parameters: idParameter,
    post: write(
      "Propose independent synthetic local-readiness review",
      localReviewProposalSchema,
    ),
  },
  "/candidates/{id}/local-reviews/{reviewId}": {
    parameters: [
      ...idParameter,
      {
        name: "reviewId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    post: write(
      "Independently decide or maker-withdraw a local-readiness review",
      localReviewDecisionSchema,
    ),
  },
  "/candidates/{id}/checklist": {
    parameters: idParameter,
    post: write(
      "Apply synthetic starter v1 to empty checklist",
      candidateActionSchema,
    ),
  },
  "/candidates/{id}/tasks": {
    parameters: idParameter,
    post: write(
      "Add immutable task metadata with a same-case prerequisite",
      candidateTaskCreateSchema,
    ),
  },
  "/candidates/{id}/tasks/{taskId}": {
    parameters: [
      ...idParameter,
      {
        name: "taskId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    post: write(
      "Versioned HR-coordinated task status and evidence",
      candidateTaskUpdateSchema,
    ),
  },
  "/candidates/{id}/tasks/{taskId}/assignment": {
    parameters: [
      ...idParameter,
      {
        name: "taskId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    post: write(
      "Assign or reassign an internal onboarding task",
      candidateTaskAssignmentSchema,
    ),
  },
  "/onboarding/tasks": {
    get: read(
      "Current actor's assigned onboarding tasks",
      assignedTaskListSchema,
    ),
  },
  "/onboarding/tasks/{taskId}": {
    parameters: [
      {
        name: "taskId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    post: write("Update an assigned onboarding task", assignedTaskUpdateSchema),
  },
  "/candidates": {
    get: {
      ...read(
        "Latest 50 HR intake cases in current legal entity",
        candidateListSchema,
      ),
      parameters: [
        { name: "q", in: "query", schema: { type: "string", maxLength: 80 } },
      ],
    },
    post: write(
      "Create synthetic candidate intake",
      candidateCreateSchema,
      candidateSchema,
    ),
  },
  "/candidates/options": {
    get: read("Active scoped intake assignments", candidateOptionsSchema),
  },
  "/candidates/{id}": {
    parameters: idParameter,
    get: read("Intake and immutable submissions", candidateDetailSchema),
  },
  "/candidates/{id}/delivery-preview": {
    parameters: idParameter,
    get: read(
      "Audited encrypted local delivery preview; no email sent",
      candidateDeliverySchema,
    ),
  },
  "/candidates/{id}/invitation": {
    parameters: idParameter,
    post: write(
      "Rotate invitation and revoke old credentials",
      candidateActionSchema,
      candidateSchema,
    ),
  },
  "/candidates/{id}/revoke": {
    parameters: idParameter,
    post: write(
      "Cancel intake and revoke candidate access",
      candidateActionSchema,
      candidateSchema,
    ),
  },
  "/candidates/{id}/review": {
    parameters: idParameter,
    post: write(
      "Review form only; does not activate employment",
      candidateReviewSchema,
      candidateSchema,
    ),
  },
});
Object.assign(spec.paths, {
  "/reports/datasets": {
    get: read(
      "Report catalog limited to what the caller may run: managers see team datasets (people, leave, attendance, expenses) without sensitive columns; HR sees every dataset and column",
      reportCatalogSchema,
    ),
  },
  "/reports/run": {
    post: write(
      "Run a whitelisted report definition under the caller's row-level security; at most 1000 rows, with the total count and a truncated flag; money cells are integer paise",
      reportRunSchema,
      reportResultSchema,
      "200",
    ),
  },
  "/reports/export": {
    post: {
      ...write("HR-only CSV export", reportExportSchema),
      description:
        "UTF-8 CSV with BOM, CRLF and RFC 4180 quoting; text starting with = + - @ tab, CR or LF is prefixed with an apostrophe; money in rupees with two decimals. At most 10,000 rows: X-Report-Truncated says whether rows were left out and X-Report-Row-Count gives the rows written (no note row is added). Each export writes one audit row and outbox event with the dataset, column keys and filter operators only. Limited to 10 exports per minute per person.",
      responses: {
        "200": {
          description: "CSV attachment",
          headers: {
            "X-Report-Truncated": {
              schema: { type: "string", enum: ["true", "false"] },
            },
            "X-Report-Row-Count": { schema: { type: "integer" } },
            "X-Report-Export-Id": {
              schema: { type: "string", format: "uuid" },
            },
          },
          content: { "text/csv": { schema: { type: "string" } } },
        },
        ...errors,
      },
    },
  },
  "/reports/saved": {
    get: read(
      "The caller's own saved report definitions (archived ones are hidden)",
      savedReportListSchema,
    ),
    post: write(
      "Save a report definition for yourself (up to 50, unique names)",
      savedReportCreateSchema,
      savedReportSchema,
    ),
  },
  "/reports/saved/{id}": {
    parameters: idParameter,
    put: write(
      "Change your saved report with its current version",
      savedReportUpdateSchema,
      savedReportSchema,
      "200",
    ),
  },
  "/reports/saved/{id}/archive": {
    parameters: idParameter,
    post: write(
      "Archive your saved report (final; reports are never deleted)",
      savedReportArchiveSchema,
      savedReportSchema,
    ),
  },
});
const uuidParameter = (name: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
});
Object.assign(spec.paths, {
  "/projects": {
    get: {
      ...read(
        "Projects the caller may see (members and owners their own; HR every project), up to 200 with status counts",
        projectListSchema,
      ),
      parameters: [
        { name: "q", in: "query", schema: { type: "string", maxLength: 80 } },
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: ["planned", "active", "on_hold", "completed", "cancelled"],
          },
        },
      ],
    },
    post: write(
      "Create a project; a manager owns it, HR may name another owner",
      projectCreateSchema,
      projectSchema,
    ),
  },
  "/projects/{id}": {
    parameters: idParameter,
    get: read("One visible project", projectSchema),
    put: write(
      "Change a project's details with its current version (owner or HR; only HR changes the owner)",
      projectUpdateSchema,
      projectSchema,
      "200",
    ),
  },
  "/projects/{id}/status": {
    parameters: idParameter,
    post: write(
      "Move a project's status; completed and cancelled projects are read-only until HR reopens them",
      projectStatusChangeSchema,
      projectSchema,
    ),
  },
  "/projects/{id}/members": {
    parameters: idParameter,
    get: read("Current and former members, up to 200", projectMemberListSchema),
    post: write(
      "Add a current employee to an open project (owner or HR)",
      projectMemberAddSchema,
      projectMemberListSchema,
    ),
  },
  "/projects/{id}/members/{employeeId}/remove": {
    parameters: [...idParameter, uuidParameter("employeeId")],
    post: write(
      "Remove a member (kept as history); their open tasks must be reassigned first",
      projectMemberRemoveSchema,
      projectMemberListSchema,
    ),
  },
  "/projects/{id}/tasks": {
    parameters: idParameter,
    get: read("Tasks of a visible project, up to 200", projectTaskListSchema),
    post: write(
      "Add a task, optionally assigned to a current member (owner or HR)",
      projectTaskCreateSchema,
      projectTaskSchema,
    ),
  },
  "/projects/{id}/tasks/{taskId}": {
    parameters: [...idParameter, uuidParameter("taskId")],
    put: write(
      "Change a task with its current version (owner or HR)",
      projectTaskUpdateSchema,
      projectTaskSchema,
      "200",
    ),
  },
  "/projects/{id}/tasks/{taskId}/status": {
    parameters: [...idParameter, uuidParameter("taskId")],
    post: write(
      "Move a task's status (owner, HR, or the task's assignee)",
      projectTaskStatusChangeSchema,
      projectTaskSchema,
    ),
  },
  "/time/mine": {
    get: {
      ...read(
        "My time entries (latest 200) and the week's minutes per project",
        myTimeSchema,
      ),
      parameters: [
        {
          name: "weekOf",
          in: "query",
          schema: { type: "string", format: "date" },
        },
      ],
    },
    post: write(
      "Log time on a project I belong to: 15 to 720 minutes in steps of 15, within the last 60 days, at most 24 hours a day",
      timeEntryCreateSchema,
      myTimeSchema,
    ),
  },
  "/time/mine/{id}/withdraw": {
    parameters: idParameter,
    post: write(
      "Withdraw my own undecided time entry",
      timeEntryWithdrawSchema,
      myTimeSchema,
    ),
  },
  "/time/review": {
    get: read(
      "Time awaiting a decision on projects I own (HR: every project), never my own, up to 200",
      timeReviewSchema,
    ),
  },
  "/time/{id}/approve": {
    parameters: idParameter,
    post: write(
      "Approve someone else's time (project owner or HR)",
      timeEntryApproveSchema,
      timeEntrySchema,
    ),
  },
  "/time/{id}/reject": {
    parameters: idParameter,
    post: write(
      "Reject someone else's time with a reason (project owner or HR)",
      timeEntryRejectSchema,
      timeEntrySchema,
    ),
  },
});
// Recruitment (REC-01). Every list: page (default 1), limit (default 25, max 100), q, filters.
const recruitList = (...filters: string[]) => [
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, default: 1 },
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  { name: "q", in: "query", schema: { type: "string", maxLength: 80 } },
  ...filters.map((name) => ({
    name,
    in: "query",
    schema: { type: "string" },
  })),
];
const requisitionSteps: Record<string, [string, z.ZodType]> = {
  submit: [
    "Send a draft for approval (requester, hiring manager or HR)",
    recruitRequisitionActionSchema,
  ],
  approve: [
    "Approve (HR who is neither the requester nor the hiring manager)",
    recruitRequisitionActionSchema,
  ],
  reject: [
    "Reject with a reason (HR who is neither the requester nor the hiring manager)",
    recruitRequisitionReasonSchema,
  ],
  open: [
    "Open an approved or held requisition (HR)",
    recruitRequisitionActionSchema,
  ],
  hold: [
    "Put an open requisition on hold (HR)",
    recruitRequisitionActionSchema,
  ],
  close: ["Close with a reason (HR)", recruitRequisitionReasonSchema],
  cancel: [
    "Cancel a draft or pending requisition (requester or HR) or an approved one (HR)",
    recruitRequisitionActionSchema,
  ],
};
const offerSteps: Record<string, [string, z.ZodType]> = {
  submit: ["Send a draft offer for approval (HR)", recruitOfferActionSchema],
  approve: [
    "Approve an offer (HR other than its creator)",
    recruitOfferActionSchema,
  ],
  send: [
    "Record that the approved offer was sent (no email is dispatched)",
    recruitOfferActionSchema,
  ],
  withdraw: [
    "Withdraw an open offer with a reason (HR)",
    recruitOfferWithdrawSchema,
  ],
};
Object.assign(spec.paths, {
  "/recruit/requisitions": {
    get: {
      ...read(
        "Requisitions the caller may see (HR all; hiring managers and requesters their own), paginated with status counts",
        recruitRequisitionListSchema,
      ),
      parameters: recruitList("status"),
    },
    post: write(
      "Raise a draft requisition; a manager raises for themselves, HR may name the hiring manager",
      recruitRequisitionCreateSchema,
      recruitRequisitionSchema,
    ),
  },
  "/recruit/requisitions/{id}": {
    parameters: idParameter,
    get: read("One visible requisition", recruitRequisitionSchema),
    put: write(
      "Edit a draft (requester or HR) or adjust an approved or open one (HR) with its version",
      recruitRequisitionUpdateSchema,
      recruitRequisitionSchema,
      "200",
    ),
  },
  ...Object.fromEntries(
    Object.entries(requisitionSteps).map(([name, [summary, input]]) => [
      `/recruit/requisitions/{id}/${name}`,
      {
        parameters: idParameter,
        post: write(summary, input, recruitRequisitionSchema),
      },
    ]),
  ),
  "/recruit/candidates": {
    get: {
      ...read(
        "Candidates with contact details (HR only), paginated",
        recruitCandidateListSchema,
      ),
      parameters: recruitList("source"),
    },
    post: write(
      "Record a candidate with consent; email and phone are sealed; a duplicate email is refused (409)",
      recruitCandidateCreateSchema,
      recruitCandidateSchema,
    ),
  },
  "/recruit/candidates/{id}": {
    parameters: idParameter,
    get: read(
      "A candidate: HR sees contact details; hiring managers a limited card",
      recruitCandidateSchema,
    ),
  },
  "/recruit/candidates/{id}/extend-retention": {
    parameters: idParameter,
    post: write(
      "Extend how long a candidate's details are kept (HR)",
      recruitCandidateRetentionSchema,
      recruitCandidateSchema,
    ),
  },
  "/recruit/candidates/{id}/withdraw-consent": {
    parameters: idParameter,
    post: write(
      "Record that the candidate withdrew consent (HR, reason of 10+ characters); blocks new applications and interviews",
      recruitCandidateWithdrawConsentSchema,
      recruitCandidateSchema,
    ),
  },
  "/recruit/candidates/{id}/anonymise": {
    parameters: idParameter,
    post: write(
      "Irreversibly clear a candidate's personal details (HR; after consent withdrawal or retention, no open application)",
      recruitCandidateAnonymiseSchema,
      recruitCandidateSchema,
    ),
  },
  "/recruit/applications": {
    get: {
      ...read(
        "Applications on requisitions the caller follows, paginated with stage counts",
        recruitApplicationListSchema,
      ),
      parameters: recruitList("stage", "requisitionId", "source"),
    },
    post: write(
      "Add a candidate to an open requisition (HR)",
      recruitApplicationCreateSchema,
      recruitApplicationSchema,
    ),
  },
  "/recruit/applications/{id}": {
    parameters: idParameter,
    get: read(
      "An application with stage history, interviews, visible scorecards and (HR) offers",
      recruitApplicationDetailSchema,
    ),
  },
  "/recruit/applications/{id}/stage": {
    parameters: idParameter,
    post: write(
      "Move an application's stage (forward by HR or the hiring manager; back, withdraw and reopen by HR with a reason)",
      recruitStageChangeSchema,
      recruitApplicationSchema,
    ),
  },
  "/recruit/interviews": {
    get: {
      ...read(
        "Interviews the caller manages or sits on, paginated with status counts",
        recruitInterviewListSchema,
      ),
      parameters: recruitList("status", "requisitionId", "applicationId"),
    },
    post: write(
      "Schedule an interview with a panel of 1 to 6 current employees; overlapping bookings are refused (409)",
      recruitInterviewCreateSchema,
      recruitInterviewSchema,
    ),
  },
  "/recruit/interviews/mine": {
    get: {
      ...read(
        "Interviews I am on the panel for, paginated",
        recruitInterviewListSchema,
      ),
      parameters: recruitList("status", "requisitionId", "applicationId"),
    },
  },
  "/recruit/interviews/{id}": {
    parameters: idParameter,
    get: read("One visible interview", recruitInterviewSchema),
    put: write(
      "Reschedule a scheduled interview with its version",
      recruitInterviewRescheduleSchema,
      recruitInterviewSchema,
      "200",
    ),
  },
  "/recruit/interviews/{id}/status": {
    parameters: idParameter,
    post: write(
      "Mark an interview completed, cancelled (with a reason) or no-show",
      recruitInterviewStatusChangeSchema,
      recruitInterviewSchema,
    ),
  },
  "/recruit/interviews/{id}/scorecards": {
    parameters: idParameter,
    get: read(
      "Scorecards visible to the caller (blind until they submit their own)",
      recruitScorecardListSchema,
    ),
  },
  "/recruit/interviews/{id}/scorecard": {
    parameters: idParameter,
    post: write(
      "Submit my scorecard once (panel members, after the interview starts)",
      recruitScorecardCreateSchema,
      recruitScorecardListSchema,
    ),
  },
  "/recruit/offers": {
    get: {
      ...read(
        "Offers (HR), paginated with status counts",
        recruitOfferListSchema,
      ),
      parameters: recruitList("status", "requisitionId"),
    },
    post: write(
      "Draft an offer (HR); prefilled from the requisition; no salary is stored",
      recruitOfferCreateSchema,
      recruitOfferSchema,
    ),
  },
  ...Object.fromEntries(
    Object.entries(offerSteps).map(([name, [summary, input]]) => [
      `/recruit/offers/{id}/${name}`,
      {
        parameters: idParameter,
        post: write(summary, input, recruitOfferSchema),
      },
    ]),
  ),
  "/recruit/offers/{id}/accept": {
    parameters: idParameter,
    post: write(
      "Record the candidate's acceptance: marks the application hired and creates a draft pre-boarding record (HR)",
      recruitOfferAcceptSchema,
      recruitOfferAcceptedSchema,
    ),
  },
  "/recruit/offers/{id}/decline": {
    parameters: idParameter,
    post: write(
      "Record a decline or expiry (HR)",
      recruitOfferDeclineSchema,
      recruitOfferSchema,
    ),
  },
  "/recruit/funnel": {
    get: {
      ...read(
        "Aggregate funnel for followed requisitions: stage counts, conversion, days in stage, sources",
        recruitFunnelSchema,
      ),
      parameters: [
        {
          name: "requisitionId",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
      ],
    },
  },
});
const candidateSpec = {
  openapi: "3.1.0",
  info: {
    title: "MyAnvi synthetic candidate preview",
    version: "0.5.0",
    description:
      "Development/demo only. Separate hostname and database role. Exact Origin required on mutations. No real email or employment activation.",
  },
  servers: [{ url: "http://127.0.0.2:5174/api/candidate" }],
  security: [{ session: [] }],
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "anvi_candidate_preview" },
      csrf: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
    },
  },
  paths: {
    "/tasks/{taskId}": {
      parameters: [
        {
          name: "taskId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: write(
        "Update only the current candidate's own task; versioned and audited",
        candidateTaskUpdateSchema,
        candidatePortalSchema,
      ),
    },
    "/challenge": {
      post: {
        ...write(
          "Request local OTP preview; generic response",
          candidateChallengeSchema,
          z.object({ challengeId: z.uuid() }),
        ),
        security: [],
      },
    },
    "/exchange": {
      post: {
        ...write(
          "Exchange single use invitation and OTP",
          candidateExchangeSchema,
          z.object({ verified: z.boolean() }),
        ),
        security: [],
      },
    },
    "/session": {
      get: read(
        "Candidate's own minimal form and CSRF token",
        candidatePortalSchema,
      ),
    },
    "/draft": {
      put: write(
        "Versioned autosave",
        candidateSaveSchema,
        candidatePortalSchema,
        "200",
      ),
    },
    "/submit": {
      post: write(
        "Create immutable submission and atomic audit/outbox",
        candidateSubmitSchema,
        candidatePortalSchema,
      ),
    },
    "/logout": {
      post: write(
        "Revoke current candidate session",
        z.strictObject({}),
        z.object({ signedOut: z.boolean() }),
      ),
    },
  },
};
await mkdir("docs/api", { recursive: true });
await writeFile(
  "docs/api/candidate-openapi.json",
  JSON.stringify(candidateSpec, null, 2) + "\n",
);
await writeFile("docs/api/openapi.json", JSON.stringify(spec, null, 2) + "\n");
