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
    version: "0.1.0",
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
  },
};
await mkdir("docs/api", { recursive: true });
await writeFile("docs/api/openapi.json", JSON.stringify(spec, null, 2) + "\n");
