import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import {
  brandingSchema,
  brandingUpdateSchema,
  directorySchema,
  dashboardSchema,
  meSchema,
  employeeSchema,
  auditSchema,
  authConfigSchema,
  roleSchema,
  organizationDirectorySchema,
  organizationUnitSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
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
        ...read("Authorized work profile", employeeSchema),
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
    "/organization": {
      get: {
        ...read(
          "HR-only department/location masters within the current entity",
          organizationDirectorySchema,
        ),
        parameters: [
          {
            name: "kind",
            in: "query",
            schema: {
              type: "string",
              enum: ["department", "location"],
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
    "/organization/{id}": {
      put: {
        ...write(
          "Rename or change active state with a version and recorded reason",
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
