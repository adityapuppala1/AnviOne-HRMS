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
  permissions: z.array(
    z.enum(["directory.read", "branding.write", "audit.read"]),
  ),
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
  }),
);
export const authConfigSchema = z.object({
  mode: z.enum(["demo", "oidc"]),
  demo: z.boolean(),
});
