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
  "onboarding.manage",
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

export const candidateStateSchema = z.enum([
  "draft",
  "invited",
  "in_progress",
  "submitted",
  "changes_requested",
  "approved",
  "cancelled",
]);
export const candidateDraftSchema = z
  .object({
    preferredName: z.string().trim().max(120),
    introduction: z.string().trim().max(2000),
    acknowledged: z.boolean(),
  })
  .strict();
export type CandidateDraft = z.infer<typeof candidateDraftSchema>;
export const candidateCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(254)
      .refine(
        (value) => value.endsWith("@anvi.example"),
        "Use a synthetic @anvi.example address",
      ),
    title: z.string().trim().min(2).max(80),
    departmentId: z.uuid(),
    locationId: z.uuid(),
    managerId: z.uuid(),
    joinedOn: z.iso.date(),
  })
  .strict();
export const candidateActionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(10).max(300),
  })
  .strict();
export const candidateReviewSchema = candidateActionSchema
  .extend({ decision: z.enum(["changes_requested", "approved"]) })
  .strict();
export const candidateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  title: z.string(),
  joinedOn: z.string(),
  state: candidateStateSchema,
  version: z.number().int(),
  invitationExpiresAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  draft: candidateDraftSchema,
  department: z.string(),
  location: z.string(),
  manager: z.string(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const candidateListSchema = z.object({
  items: z.array(candidateSchema),
});
export const candidateOptionsSchema = z.object({
  departments: z.array(organizationUnitSchema),
  locations: z.array(organizationUnitSchema),
  managers: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export const candidateSubmissionSchema = z.object({
  version: z.number().int(),
  payload: candidateDraftSchema,
  submittedAt: z.string(),
});
export const candidateTaskOwnerSchema = z.enum([
  "candidate",
  "hr",
  "manager",
  "it",
  "administration",
]);
export const candidateTaskStateSchema = z.enum([
  "pending",
  "blocked",
  "completed",
]);
export const candidateTaskSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  owner: candidateTaskOwnerSchema,
  required: z.boolean(),
  dueOn: z.iso.date(),
  state: candidateTaskStateSchema,
  version: z.number().int().positive(),
  dependsOn: z.uuid().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string(),
  waitingOn: z.boolean(),
  overdue: z.boolean(),
});
export type CandidateTask = z.infer<typeof candidateTaskSchema>;
export const candidateOwnTaskSchema = candidateTaskSchema.omit({
  owner: true,
  dependsOn: true,
});
export const candidateTaskCreateSchema = z.strictObject({
  caseVersion: z.number().int().positive(),
  label: z.string().trim().min(5).max(140),
  owner: candidateTaskOwnerSchema,
  required: z.boolean(),
  dueOffsetDays: z.number().int().min(-30).max(90),
  dependsOn: z.uuid().nullable(),
});
export const candidateTaskUpdateSchema = z.strictObject({
  caseVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  state: candidateTaskStateSchema,
  reason: z.string().trim().min(10).max(300),
});
export const localReviewStateSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);
export const localReviewSchema = z.strictObject({
  id: z.uuid(),
  state: localReviewStateSchema,
  version: z.number().int().positive(),
  proposedBy: z.uuid(),
  proposerLabel: z.string(),
  proposalNote: z.string(),
  proposedAt: z.string(),
  decidedBy: z.uuid().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
});
export const localReviewProposalSchema = z.strictObject({
  caseVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(300),
});
export const localReviewDecisionSchema = z.strictObject({
  caseVersion: z.number().int().positive(),
  reviewVersion: z.number().int().positive(),
  decision: z.enum(["approved", "rejected", "withdrawn"]),
  reason: z.string().trim().min(10).max(300),
});
export const activationControlSchema = z.strictObject({
  id: z.enum([
    "form",
    "checklist",
    "email_ownership",
    "identity",
    "documents",
    "privacy",
  ]),
  label: z.string(),
  status: z.enum(["passed", "blocked"]),
  source: z.enum(["preview", "external"]),
  detail: z.string(),
});
export const activationReadinessSchema = z.strictObject({
  activationReady: z.boolean(),
  controls: z.array(activationControlSchema).length(6),
});
export const candidateDetailSchema = z.object({
  candidate: candidateSchema,
  submissions: z.array(candidateSubmissionSchema),
  tasks: z.array(candidateTaskSchema),
  readiness: activationReadinessSchema,
  localReviews: z.array(localReviewSchema),
});
export const candidatePortalSchema = z.object({
  tasks: z.array(candidateOwnTaskSchema),
  candidate: candidateSchema.pick({
    id: true,
    name: true,
    title: true,
    joinedOn: true,
    state: true,
    version: true,
    reviewNote: true,
    draft: true,
  }),
  csrfToken: z.string(),
});
export const candidateSaveSchema = z
  .object({ version: z.number().int().positive(), draft: candidateDraftSchema })
  .strict();
export const candidateSubmitSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const candidateChallengeSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const candidateExchangeSchema = candidateChallengeSchema
  .extend({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
export const candidateDeliverySchema = z.object({
  invitationUrl: z.string().optional(),
  code: z.string().optional(),
  expiresAt: z.string().nullable(),
  previewOnly: z.literal(true),
});
export {
  activationReadiness,
  onboardingStarter,
  submissionChanges,
} from "./onboarding";
