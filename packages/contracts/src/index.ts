import { z } from "zod";

export const roleSchema = z.enum([
  "employee",
  "manager",
  "hr_admin",
  "platform_admin",
  "auditor",
]);
export type Role = z.infer<typeof roleSchema>;
export const roleLabels: Record<Role, string> = {
  employee: "Employee",
  manager: "Team manager",
  hr_admin: "HR admin",
  platform_admin: "Platform admin",
  auditor: "Auditor",
};
export const permissionSchema = z.enum([
  "directory.read",
  "branding.write",
  "audit.read",
  "organization.read",
  "organization.write",
]);
export type Permission = z.infer<typeof permissionSchema>;
export const employeeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  title: z.string(),
  department: z.string(),
  location: z.string(),
  email: z.email(),
  joinedOn: z.string(),
  status: z.enum(["active", "notice"]),
  initials: z.string(),
});
export type Employee = z.infer<typeof employeeSchema>;
export const directoryQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  department: z.string().max(60).default(""),
  location: z.string().max(60).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export const directorySchema = z.object({
  items: z.array(employeeSchema),
  total: z.number(),
  page: z.number(),
  pages: z.number(),
  departments: z.array(z.string()),
  locations: z.array(z.string()),
});
export type Directory = z.infer<typeof directorySchema>;
export const themeSchema = z.enum(["ocean", "iris", "forest"]);
export type Theme = z.infer<typeof themeSchema>;
export const brandingSchema = z.object({
  platformName: z.string().trim().min(2).max(30),
  employeeName: z.string().trim().min(2).max(30),
  organizationName: z.string().trim().min(2).max(60),
  theme: themeSchema,
  version: z.number().int().positive(),
});
export type Branding = z.infer<typeof brandingSchema>;
export const brandingUpdateSchema = brandingSchema.strict();
export const meSchema = z.object({
  actorId: z.uuid(),
  name: z.string(),
  employeeId: z.uuid(),
  role: roleSchema,
  roles: z.array(roleSchema),
  csrfToken: z.string(),
  entityName: z.string(),
  demo: z.boolean(),
  permissions: z.array(permissionSchema),
});
export type Me = z.infer<typeof meSchema>;
export const dashboardSchema = z.object({
  total: z.number(),
  departments: z.array(z.object({ name: z.string(), count: z.number() })),
  locations: z.array(z.object({ name: z.string(), count: z.number() })),
  recent: z.array(employeeSchema),
  asOf: z.string(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export const auditSchema = z.array(
  z.object({
    id: z.string(),
    action: z.string(),
    actor: z.string(),
    role: z.string(),
    target: z.string(),
    occurredAt: z.string(),
    requestId: z.string(),
    reason: z.string().nullable(),
  }),
);
export const authConfigSchema = z.object({
  mode: z.enum(["demo", "oidc"]),
  demo: z.boolean(),
});

export const organizationKindSchema = z.enum(["department", "location"]);
const organizationNameSchema = z.string().trim().min(2).max(60);
const changeReasonSchema = z.string().trim().min(10).max(300);
export const organizationUnitSchema = z.object({
  id: z.uuid(),
  kind: organizationKindSchema,
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  version: z.number().int().positive(),
  employeeCount: z.number().int().nonnegative(),
});
export type OrganizationUnit = z.infer<typeof organizationUnitSchema>;
export const organizationQuerySchema = z
  .object({
    kind: organizationKindSchema.default("department"),
    q: z.string().trim().max(80).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const organizationDirectorySchema = z.object({
  entityName: z.string(),
  items: z.array(organizationUnitSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pages: z.number().int().positive(),
});
export type OrganizationDirectory = z.infer<typeof organizationDirectorySchema>;
export const organizationCreateSchema = z
  .object({
    kind: organizationKindSchema,
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_-]{1,19}$/),
    name: organizationNameSchema,
    reason: changeReasonSchema,
  })
  .strict();
export const organizationUpdateSchema = z
  .object({
    name: organizationNameSchema,
    active: z.boolean(),
    version: z.number().int().positive(),
    reason: changeReasonSchema,
  })
  .strict();
