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
  "onboarding.task.update",
  "leave.request",
  "leave.approve",
  "attendance.self",
  "attendance.review",
  "document.self",
  "document.review",
  "insights.read",
  "asset.manage",
  "asset.self",
  "policy.manage",
  "policy.self",
  "exit.manage",
  "exit.self",
  "expense.self",
  "expense.approve",
  "expense.manage",
  "project.self",
  "project.manage",
  "recruit.manage",
  "recruit.request",
  "recruit.interview",
  "performance.self",
  "performance.review",
  "performance.manage",
  "helpdesk.self",
  "helpdesk.agent",
  "helpdesk.manage",
  "engage.self",
  "engage.manage",
  "learn.self",
  "learn.team",
  "learn.manage",
  "shift.self",
  "shift.team",
  "shift.manage",
  "profile.self",
  "profile.review",
  "report.run",
  "report.export",
  "admin.read",
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
// The single work profile adds designation, grade and cost centre (never in lists).
export const employeeDetailSchema = employeeSchema.extend({
  designation: z
    .object({ id: z.uuid(), code: z.string(), name: z.string() })
    .nullable(),
  grade: z
    .object({ id: z.uuid(), code: z.string(), name: z.string() })
    .nullable(),
  costCenter: z
    .object({ id: z.uuid(), code: z.string(), name: z.string() })
    .nullable(),
  // Expected by PUT /people/:id/classification as `version`.
  version: z.number().int().nonnegative(),
  // True when grade and cost centre are withheld (viewer is neither HR nor self);
  // both are then null regardless of the stored value.
  classificationRestricted: z.boolean(),
});
export type EmployeeDetail = z.infer<typeof employeeDetailSchema>;
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
// `reason` is optional on edits (recorded in history and audit); rollback requires one.
export const brandingUpdateSchema = brandingSchema
  .extend({ reason: z.string().trim().min(10).max(300).optional() })
  .strict();
export type BrandingUpdate = z.infer<typeof brandingUpdateSchema>;
export const brandingHistorySourceSchema = z.enum([
  "baseline",
  "edit",
  "rollback",
]);
export const brandingHistoryEntrySchema = z.object({
  version: z.number().int().positive(),
  platformName: z.string(),
  employeeName: z.string(),
  organizationName: z.string(),
  theme: themeSchema,
  source: brandingHistorySourceSchema,
  restoredVersion: z.number().int().positive().nullable(),
  changedBy: z.string(),
  reason: z.string().nullable(),
  occurredAt: z.string(),
});
export const brandingHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    beforeVersion: z.coerce.number().int().min(2).optional(),
  })
  .strict();
export const brandingHistorySchema = z.object({
  items: z.array(brandingHistoryEntrySchema),
  nextBeforeVersion: z.number().int().positive().nullable(),
});
export type BrandingHistory = z.infer<typeof brandingHistorySchema>;
export const brandingRollbackSchema = z
  .object({
    toVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    reason: z.string().trim().min(10).max(300),
  })
  .strict();
export const permissionMatrixSchema = z.object({
  source: z.literal("code"),
  note: z.string(),
  roles: z.array(z.object({ role: roleSchema, label: z.string() })),
  permissions: z.array(
    z.object({
      permission: permissionSchema,
      description: z.string(),
      grants: z.array(
        z.object({
          role: roleSchema,
          scope: z.enum(["self", "team", "entity"]),
        }),
      ),
    }),
  ),
});
export type PermissionMatrix = z.infer<typeof permissionMatrixSchema>;
export const integrationStatusSchema = z.enum([
  "configured",
  "not_configured",
  "demo",
]);
export const integrationReadinessSchema = z.object({
  asOf: z.string(),
  items: z.array(
    z.object({
      key: z.enum([
        "oidc",
        "rate_limit_store",
        "document_scanning",
        "notifications",
        "profile_data_keys",
        "worker_schedules",
        "ai_helper",
      ]),
      name: z.string(),
      status: integrationStatusSchema,
      note: z.string(),
      detail: z.record(z.string(), z.union([z.number(), z.boolean()])),
    }),
  ),
});
export type IntegrationReadiness = z.infer<typeof integrationReadinessSchema>;
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
  idleLimitSeconds: z.number().int().positive(),
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

export const organizationKindSchema = z.enum([
  "department",
  "location",
  "designation",
  "grade",
  "cost_center",
]);
// Only these kinds hold employees today, so only these can be merged.
export const organizationMergeableKindSchema = z.enum([
  "department",
  "location",
]);
export const organizationStatusSchema = z.enum([
  "scheduled",
  "in_effect",
  "ended",
  "inactive",
]);
const organizationNameSchema = z.string().trim().min(2).max(60);
const changeReasonSchema = z.string().trim().min(10).max(300);
const organizationDateSchema = z.iso
  .date()
  .refine((v) => v >= "1900-01-01" && v <= "2199-12-31");
export const organizationUnitSchema = z.object({
  id: z.uuid(),
  kind: organizationKindSchema,
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  version: z.number().int().positive(),
  // Counts active and notice employees assigned to the unit (any kind).
  employeeCount: z.number().int().nonnegative(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  // Active, not merged, and today (entity time) inside the inclusive window.
  inEffect: z.boolean(),
  status: organizationStatusSchema,
  mergedIntoId: z.uuid().nullable(),
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
    // Defaults to today in the entity's time zone.
    effectiveFrom: organizationDateSchema.optional(),
    effectiveTo: organizationDateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.effectiveTo || !v.effectiveFrom || v.effectiveTo >= v.effectiveFrom,
    { message: "The end date cannot be before the start date." },
  );
export const organizationUpdateSchema = z
  .object({
    name: organizationNameSchema,
    active: z.boolean(),
    version: z.number().int().positive(),
    reason: changeReasonSchema,
    // Omitted keeps the current window; effectiveTo null clears the end date.
    effectiveFrom: organizationDateSchema.optional(),
    effectiveTo: organizationDateSchema.nullable().optional(),
  })
  .strict();
export const organizationMergeSchema = z.strictObject({
  targetId: z.uuid(),
  version: z.number().int().positive(),
  targetVersion: z.number().int().positive(),
  reason: changeReasonSchema,
});
export const organizationRefSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  mergedAt: z.string().nullable(),
});
export const organizationDetailSchema = z.object({
  item: organizationUnitSchema,
  mergedInto: organizationRefSchema.nullable(),
  mergedFrom: z.array(organizationRefSchema),
});
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;
// Designation, grade and cost centre of one employee; ids only on input, null clears.
export const employeeClassificationUpdateSchema = z.strictObject({
  designationId: z.uuid().nullable(),
  gradeId: z.uuid().nullable(),
  costCenterId: z.uuid().nullable(),
  // The current classification version (employee detail `version`).
  version: z.number().int().nonnegative(),
  reason: changeReasonSchema,
});
export const classificationRefSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
export const employeeClassificationSchema = z.strictObject({
  employeeId: z.uuid(),
  designation: classificationRefSchema.nullable(),
  grade: classificationRefSchema.nullable(),
  costCenter: classificationRefSchema.nullable(),
  // Increments on every real change; an unchanged replay keeps it.
  version: z.number().int().nonnegative(),
  changed: z.boolean(),
});
export type EmployeeClassification = z.infer<
  typeof employeeClassificationSchema
>;
export const organizationMergeResultSchema = z.object({
  source: organizationUnitSchema,
  target: organizationUnitSchema,
  // Every employment row moved, including former (inactive) employees, so nothing
  // keeps pointing at the closed record.
  movedEmployees: z.number().int().nonnegative(),
  movedActive: z.number().int().nonnegative(),
  movedInactive: z.number().int().nonnegative(),
  // Unfinished candidate offers re-pointed to the target.
  movedCandidates: z.number().int().nonnegative(),
});
export type OrganizationMergeResult = z.infer<
  typeof organizationMergeResultSchema
>;
export const organizationChartQuerySchema = z.strictObject({
  rootId: z.uuid().optional(),
  // Levels counted including the root: depth=1 returns only the roots.
  depth: z.coerce.number().int().min(1).max(20).default(20),
});
export const organizationChartNodeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  initials: z.string(),
  title: z.string(),
  department: z.string(),
  status: z.enum(["active", "notice"]),
  // Null when the manager is outside what the caller may see (or there is none).
  managerId: z.uuid().nullable(),
  directReportCount: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
});
export const organizationChartSchema = z.object({
  scope: z.enum(["self", "team", "entity"]),
  rootIds: z.array(z.uuid()),
  nodes: z.array(organizationChartNodeSchema),
  total: z.number().int().nonnegative(),
  // True when the depth or node cap cut the tree, or a reporting loop was broken.
  // The UI should say the chart is partial; "scope" says why a manager sees one
  // level (self + direct reports) and an employee only themselves.
  truncated: z.boolean(),
});
export type OrganizationChart = z.infer<typeof organizationChartSchema>;

// Entity-wide reporting structure for anyone with directory.read. Deliberately
// limited to these fields: no email, code, location, dates, status or contact data.
export const orgChartSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(2).max(60),
  limit: z.coerce.number().int().min(1).max(10).default(10),
});
export const orgChartNodeLiteSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  initials: z.string(),
  title: z.string(),
  // Null when the person has no department in their entity.
  department: z.string().nullable(),
  // Null when there is no manager or the manager is no longer active; set exactly
  // when a neighbourhood would return that manager.
  managerId: z.uuid().nullable(),
  directReportCount: z.number().int().nonnegative(),
});
export const orgChartSearchSchema = z.strictObject({
  items: z.array(orgChartNodeLiteSchema),
});
export const orgChartNeighborhoodSchema = z.strictObject({
  focus: orgChartNodeLiteSchema,
  manager: orgChartNodeLiteSchema.nullable(),
  // Direct reports by name, at most 200; reportCount is the full number.
  reports: z.array(orgChartNodeLiteSchema),
  reportCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  skipLevelHint: z.strictObject({ managerHasManager: z.boolean() }),
});
export type OrgChartSearchQuery = z.infer<typeof orgChartSearchQuerySchema>;
export type OrgChartNodeLite = z.infer<typeof orgChartNodeLiteSchema>;
export type OrgChartSearch = z.infer<typeof orgChartSearchSchema>;
export type OrgChartNeighborhood = z.infer<typeof orgChartNeighborhoodSchema>;

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
  assignees: z.array(
    z.object({ id: z.uuid(), name: z.string(), title: z.string() }),
  ),
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
  assignee: z
    .object({
      employeeId: z.uuid(),
      name: z.string(),
      version: z.number().int().positive(),
      assignedAt: z.string(),
      assignerLabel: z.string(),
    })
    .nullable(),
});
export type CandidateTask = z.infer<typeof candidateTaskSchema>;
export const candidateOwnTaskSchema = candidateTaskSchema.omit({
  owner: true,
  dependsOn: true,
  assignee: true,
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
export const candidateTaskAssignmentSchema = z.strictObject({
  caseVersion: z.number().int().positive(),
  assignmentVersion: z.number().int().positive().nullable(),
  employeeId: z.uuid(),
  reason: z.string().trim().min(10).max(300),
});
export const assignedTaskUpdateSchema = z.strictObject({
  taskVersion: z.number().int().positive(),
  state: candidateTaskStateSchema,
  reason: z.string().trim().min(10).max(300),
});
export const assignedTaskSchema = z.strictObject({
  id: z.uuid(),
  label: z.string(),
  owner: candidateTaskOwnerSchema.exclude(["candidate"]),
  required: z.boolean(),
  dueOn: z.iso.date(),
  state: candidateTaskStateSchema,
  version: z.number().int().positive(),
  note: z.string().nullable(),
  waitingOn: z.boolean(),
  overdue: z.boolean(),
  candidateName: z.string(),
  candidateTitle: z.string(),
  joinedOn: z.iso.date(),
  assignmentVersion: z.number().int().positive(),
  assignedAt: z.string(),
  assignerLabel: z.string(),
});
export const assignedTaskListSchema = z.strictObject({
  items: z.array(assignedTaskSchema),
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
  deciderLabel: z.string().nullable(),
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

// Leave (F0.10). Dates are ISO calendar dates in the legal entity's time zone.
export const leaveStateSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export type LeaveState = z.infer<typeof leaveStateSchema>;
export const leaveBalanceSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  paid: z.boolean(),
  annualDays: z.number().nullable(),
  used: z.number(),
  pending: z.number(),
  available: z.number().nullable(),
});
export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;
export const leaveRequestSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  initials: z.string(),
  department: z.string(),
  leaveType: z.strictObject({ code: z.string(), name: z.string() }),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  days: z.number().positive(),
  reason: z.string(),
  state: leaveStateSchema,
  approver: z.enum(["manager", "hr"]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  canDecide: z.boolean(),
  canCancel: z.boolean(),
});
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;
// Calendar (F0.12). Weekdays are ISO: 1 = Monday … 7 = Sunday.
const isoWeekdaySchema = z.number().int().min(1).max(7);
export const personalCalendarSchema = z.strictObject({
  workDays: z.array(isoWeekdaySchema),
  holidays: z.array(z.strictObject({ date: z.iso.date(), name: z.string() })),
});
export type PersonalCalendar = z.infer<typeof personalCalendarSchema>;
export const leaveOverviewSchema = z.strictObject({
  year: z.number().int(),
  today: z.iso.date(),
  calendar: personalCalendarSchema,
  balances: z.array(leaveBalanceSchema),
  requests: z.array(leaveRequestSchema),
});
export type LeaveOverview = z.infer<typeof leaveOverviewSchema>;
export const leaveApprovalsSchema = z.strictObject({
  pending: z.array(leaveRequestSchema),
  decided: z.array(leaveRequestSchema),
});
export type LeaveApprovals = z.infer<typeof leaveApprovalsSchema>;
export const leaveRequestCreateSchema = z
  .strictObject({
    leaveTypeId: z.uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  })
  .refine((v) => v.startDate.slice(0, 4) === v.endDate.slice(0, 4), {
    message: "A request cannot span two calendar years",
    path: ["endDate"],
  })
  .refine(
    (v) => Date.parse(v.endDate) - Date.parse(v.startDate) <= 31 * 86400000,
    {
      message: "A single request can cover at most 31 days",
      path: ["endDate"],
    },
  );
export const leaveCancelSchema = z.strictObject({
  version: z.number().int().positive(),
});
export const leaveDecisionSchema = z
  .strictObject({
    version: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().min(3).max(300).nullable(),
  })
  .refine((v) => v.decision === "approve" || v.note !== null, {
    message: "Explain why the request is declined",
    path: ["note"],
  });

// Attendance (F0.11). Times are local "HH:MM" in the legal entity's time zone.
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const attendanceDayStatusSchema = z.enum([
  "present",
  "in_progress",
  "incomplete",
  "leave",
  "weekend",
  "holiday",
  "unaccounted",
  "not_started",
]);
export type AttendanceDayStatus = z.infer<typeof attendanceDayStatusSchema>;
export const attendanceDaySchema = z.strictObject({
  date: z.iso.date(),
  status: attendanceDayStatusSchema,
  checkIn: clockSchema.nullable(),
  checkOut: clockSchema.nullable(),
  minutes: z.number().int().nonnegative().nullable(),
  source: z.enum(["web", "correction"]).nullable(),
  leaveType: z.string().nullable(),
  holiday: z.string().nullable(),
  correctionPending: z.boolean(),
});
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;
export const attendanceCorrectionSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  initials: z.string(),
  department: z.string(),
  workDate: z.iso.date(),
  checkIn: clockSchema,
  checkOut: clockSchema,
  reason: z.string(),
  state: leaveStateSchema,
  approver: z.enum(["manager", "hr"]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  canDecide: z.boolean(),
  canCancel: z.boolean(),
});
export type AttendanceCorrection = z.infer<typeof attendanceCorrectionSchema>;
export const attendanceRecordSchema = z.strictObject({
  id: z.uuid(),
  workDate: z.iso.date(),
  checkIn: clockSchema,
  checkOut: clockSchema.nullable(),
  version: z.number().int().positive(),
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;
export const attendanceOverviewSchema = z.strictObject({
  today: z.iso.date(),
  now: clockSchema,
  record: attendanceRecordSchema.nullable(),
  days: z.array(attendanceDaySchema),
  corrections: z.array(attendanceCorrectionSchema),
});
export type AttendanceOverview = z.infer<typeof attendanceOverviewSchema>;
export const attendanceTeamMemberSchema = z.strictObject({
  employeeId: z.uuid(),
  name: z.string(),
  initials: z.string(),
  department: z.string(),
  status: z.enum(["in", "done", "leave", "not_in", "weekend", "holiday"]),
  checkIn: clockSchema.nullable(),
  checkOut: clockSchema.nullable(),
});
export const attendanceTeamSchema = z.strictObject({
  date: z.iso.date(),
  people: z.array(attendanceTeamMemberSchema),
  pending: z.array(attendanceCorrectionSchema),
  decided: z.array(attendanceCorrectionSchema),
});
export type AttendanceTeam = z.infer<typeof attendanceTeamSchema>;
export const attendanceCheckInSchema = z.strictObject({});
export const attendanceCheckOutSchema = z.strictObject({
  version: z.number().int().positive(),
});
export const attendanceCorrectionCreateSchema = z
  .strictObject({
    workDate: z.iso.date(),
    checkIn: clockSchema,
    checkOut: clockSchema,
    reason: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    message: "Check-out must be after check-in",
    path: ["checkOut"],
  });
export const attendanceCancelSchema = leaveCancelSchema;
export const attendanceDecisionSchema = leaveDecisionSchema;
export const holidaySchema = z.strictObject({
  id: z.uuid(),
  date: z.iso.date(),
  name: z.string(),
  locationId: z.uuid().nullable(),
  locationName: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
});
export type Holiday = z.infer<typeof holidaySchema>;
export const workWeekSchema = z.strictObject({
  days: z.array(isoWeekdaySchema),
  version: z.number().int().positive(),
});
export const calendarSchema = z.strictObject({
  year: z.number().int(),
  today: z.iso.date(),
  workWeek: workWeekSchema,
  holidays: z.array(holidaySchema),
  locations: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  next: holidaySchema.nullable(),
  canManage: z.boolean(),
});
export type Calendar = z.infer<typeof calendarSchema>;
export const calendarQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200).optional(),
});
const holidayNameSchema = z.string().trim().min(2).max(60);
export const holidayCreateSchema = z.strictObject({
  date: z.iso.date(),
  name: holidayNameSchema,
  locationId: z.uuid().nullable(),
  reason: changeReasonSchema,
});
export const holidayUpdateSchema = z.strictObject({
  name: holidayNameSchema,
  active: z.boolean(),
  version: z.number().int().positive(),
  reason: changeReasonSchema,
});
export const workWeekUpdateSchema = z.strictObject({
  days: z
    .array(isoWeekdaySchema)
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, {
      message: "Each weekday can appear once",
    }),
  version: z.number().int().positive(),
  reason: changeReasonSchema,
});
// Documents (F0.14). File bytes travel as multipart; only metadata is JSON.
export const documentCategorySchema = z.enum([
  "identity",
  "education",
  "employment",
  "other",
]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
export const documentStatusSchema = z.enum([
  "pending",
  "verified",
  "rejected",
  "withdrawn",
]);
export const employeeDocumentSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  initials: z.string(),
  department: z.string(),
  category: documentCategorySchema,
  title: z.string(),
  fileName: z.string(),
  contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  sizeBytes: z.number().int().positive(),
  status: documentStatusSchema,
  version: z.number().int().positive(),
  uploadedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  canWithdraw: z.boolean(),
  canReview: z.boolean(),
});
export type EmployeeDocument = z.infer<typeof employeeDocumentSchema>;
export const documentListSchema = z.strictObject({
  items: z.array(employeeDocumentSchema),
});
export const documentReviewSchema = z.strictObject({
  pending: z.array(employeeDocumentSchema),
  recent: z.array(employeeDocumentSchema),
});
export const documentUploadFieldsSchema = z.strictObject({
  category: documentCategorySchema,
  title: z.string().trim().min(2).max(80),
});
export const documentWithdrawSchema = z.strictObject({
  version: z.number().int().positive(),
});
export const documentDecisionSchema = z
  .strictObject({
    version: z.number().int().positive(),
    decision: z.enum(["verify", "reject"]),
    note: z.string().trim().min(3).max(300).nullable(),
  })
  .refine((v) => v.decision === "verify" || v.note !== null, {
    message: "Explain why the document is rejected",
    path: ["note"],
  });

// Approvals inbox (F0.13): every decision waiting across modules.
const approvalBase = {
  id: z.uuid(),
  version: z.number().int().positive(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  initials: z.string(),
  department: z.string(),
  reason: z.string(),
  submittedAt: z.string(),
  approver: z.enum(["manager", "hr"]),
  canDecide: z.boolean(),
};
export const approvalItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("leave"),
    ...approvalBase,
    leaveType: z.string(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    days: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal("attendance_correction"),
    ...approvalBase,
    workDate: z.iso.date(),
    checkIn: clockSchema,
    checkOut: clockSchema,
  }),
  // A maker-checker readiness review: the maker proposed it; another HR person decides.
  z.strictObject({
    kind: z.literal("readiness_review"),
    id: z.uuid(),
    version: z.number().int().positive(),
    caseId: z.uuid(),
    caseVersion: z.number().int().positive(),
    candidateName: z.string(),
    candidateTitle: z.string(),
    initials: z.string(),
    department: z.string(),
    proposerLabel: z.string(),
    reason: z.string(),
    submittedAt: z.string(),
    approver: z.literal("hr"),
    canDecide: z.boolean(),
    evidenceReady: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("document_review"),
    id: z.uuid(),
    version: z.number().int().positive(),
    employeeId: z.uuid(),
    employeeName: z.string(),
    initials: z.string(),
    department: z.string(),
    category: documentCategorySchema,
    title: z.string(),
    fileName: z.string(),
    sizeBytes: z.number().int().positive(),
    submittedAt: z.string(),
    approver: z.literal("hr"),
    canDecide: z.boolean(),
  }),
]);
export type ApprovalItem = z.infer<typeof approvalItemSchema>;
export const approvalInboxSchema = z.strictObject({
  waiting: z.number().int().nonnegative(),
  items: z.array(approvalItemSchema),
});
export type ApprovalInbox = z.infer<typeof approvalInboxSchema>;
const countByName = z.strictObject({
  name: z.string(),
  count: z.number().int().nonnegative(),
});
const byMonth = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  value: z.number().nonnegative(),
});
// Workforce insights: counts only, never names or records. Row-level security
// narrows every figure to what the caller may already see.
export const insightsSchema = z.strictObject({
  scope: z.enum(["team", "entity"]),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  people: z.strictObject({
    total: z.number().int().nonnegative(),
    joinedLast90Days: z.number().int().nonnegative(),
    onNotice: z.number().int().nonnegative(),
    byDepartment: z.array(countByName).max(20),
    byLocation: z.array(countByName).max(20),
    joinersByMonth: z.array(byMonth).max(12),
  }),
  leave: z.strictObject({
    year: z.number().int(),
    daysApproved: z.number().nonnegative(),
    pendingRequests: z.number().int().nonnegative(),
    onLeaveToday: z.number().int().nonnegative(),
    byType: z
      .array(
        z.strictObject({ name: z.string(), days: z.number().nonnegative() }),
      )
      .max(10),
    byMonth: z.array(byMonth).max(12),
  }),
  attendance: z.strictObject({
    headcount: z.number().int().nonnegative(),
    days: z
      .array(
        z.strictObject({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          present: z.number().int().nonnegative(),
        }),
      )
      .max(31),
  }),
});
export type Insights = z.infer<typeof insightsSchema>;
// A decision someone else made on the caller's own request, for the Updates feed.
export const updateItemSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["leave", "attendance", "document"]),
  outcome: z.enum(["approved", "declined", "verified", "rejected"]),
  title: z.string().max(120),
  from: z.string().nullable(),
  to: z.string().nullable(),
  decidedBy: z.string().nullable(),
  note: z.string().nullable(),
  at: z.string(),
});
export type UpdateItem = z.infer<typeof updateItemSchema>;
export const updatesSchema = z.strictObject({
  items: z.array(updateItemSchema).max(30),
});
export type Updates = z.infer<typeof updatesSchema>;
// Company assets: HR keeps the inventory and issues items; the holder acknowledges.
export const assetCategorySchema = z.enum([
  "laptop",
  "phone",
  "monitor",
  "accessory",
  "access_card",
  "other",
]);
export const assetConditionSchema = z.enum(["new", "good", "fair", "damaged"]);
export const assetStatusSchema = z.enum([
  "available",
  "assigned",
  "in_repair",
  "retired",
  "lost",
]);
export type AssetCategory = z.infer<typeof assetCategorySchema>;
export type AssetCondition = z.infer<typeof assetConditionSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export const assetSchema = z.strictObject({
  id: z.uuid(),
  tag: z.string(),
  category: assetCategorySchema,
  name: z.string(),
  serialNumber: z.string().nullable(),
  condition: assetConditionSchema,
  status: assetStatusSchema,
  version: z.number().int().positive(),
  updatedAt: z.string(),
  custodian: z
    .strictObject({ id: z.uuid(), name: z.string(), initials: z.string() })
    .nullable(),
  issuedOn: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
});
export type Asset = z.infer<typeof assetSchema>;
export const assetListSchema = z.strictObject({
  items: z.array(assetSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pages: z.number().int().positive(),
  counts: z.strictObject({
    available: z.number().int().nonnegative(),
    assigned: z.number().int().nonnegative(),
    in_repair: z.number().int().nonnegative(),
    retired: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
  }),
});
export type AssetList = z.infer<typeof assetListSchema>;
export const assetHistoryItemSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  issuedOn: z.string(),
  issueCondition: assetConditionSchema,
  issuedBy: z.string(),
  acknowledgedAt: z.string().nullable(),
  returnedOn: z.string().nullable(),
  returnCondition: z
    .enum(["new", "good", "fair", "damaged", "lost"])
    .nullable(),
  returnNote: z.string().nullable(),
  receivedBy: z.string().nullable(),
});
export const assetDetailSchema = z.strictObject({
  asset: assetSchema,
  history: z.array(assetHistoryItemSchema),
});
export type AssetDetail = z.infer<typeof assetDetailSchema>;
export const myAssetSchema = z.strictObject({
  assignmentId: z.uuid(),
  version: z.number().int().positive(),
  tag: z.string(),
  category: assetCategorySchema,
  name: z.string(),
  serialNumber: z.string().nullable(),
  issuedOn: z.string(),
  issueCondition: assetConditionSchema,
  issuedBy: z.string(),
  acknowledgedAt: z.string().nullable(),
  returnedOn: z.string().nullable(),
  returnCondition: z
    .enum(["new", "good", "fair", "damaged", "lost"])
    .nullable(),
});
export type MyAsset = z.infer<typeof myAssetSchema>;
export const myAssetsSchema = z.strictObject({
  current: z.array(myAssetSchema),
  past: z.array(myAssetSchema),
});
export type MyAssets = z.infer<typeof myAssetsSchema>;
const assetTag = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/);
const assetName = z.string().trim().min(2).max(80);
const assetSerial = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .nullable()
  .optional()
  .transform((value) => value ?? null);
const assetNote = z.string().trim().min(3).max(300);
export const assetQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
  status: z.union([assetStatusSchema, z.literal("")]).default(""),
  category: z.union([assetCategorySchema, z.literal("")]).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export const assetCreateSchema = z.strictObject({
  tag: assetTag,
  category: assetCategorySchema,
  name: assetName,
  serialNumber: assetSerial,
  condition: assetConditionSchema,
});
export const assetUpdateSchema = z.strictObject({
  name: assetName,
  serialNumber: assetSerial,
  condition: assetConditionSchema,
  reason: assetNote,
  version: z.number().int().positive(),
});
export const assetIssueSchema = z.strictObject({
  employeeId: z.uuid(),
  issuedOn: z.iso.date().optional(),
  version: z.number().int().positive(),
});
export const assetReturnSchema = z
  .strictObject({
    condition: assetConditionSchema,
    note: assetNote.optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => value.condition !== "damaged" || Boolean(value.note), {
    message: "Describe the damage",
    path: ["note"],
  });
export const assetStatusChangeSchema = z.strictObject({
  status: z.enum(["available", "in_repair", "retired", "lost"]),
  note: assetNote,
  version: z.number().int().positive(),
});
export const assetAcknowledgeSchema = z.strictObject({
  version: z.number().int().positive(),
});
// HR policies: versioned wording, published to everyone or one department, acknowledged by employees.
export const policyCategorySchema = z.enum([
  "conduct",
  "leave",
  "it_security",
  "safety",
  "compliance",
  "other",
]);
export const policyStatusSchema = z.enum([
  "draft",
  "published",
  "superseded",
  "withdrawn",
]);
export type PolicyCategory = z.infer<typeof policyCategorySchema>;
export type PolicyStatus = z.infer<typeof policyStatusSchema>;
export const policyVersionSchema = z.strictObject({
  id: z.uuid(),
  policyId: z.uuid(),
  code: z.string(),
  category: policyCategorySchema,
  versionNumber: z.number().int().positive(),
  status: policyStatusSchema,
  title: z.string(),
  summary: z.string(),
  effectiveOn: z.string(),
  requiresAcknowledgement: z.boolean(),
  audienceDepartment: z
    .strictObject({ id: z.uuid(), name: z.string() })
    .nullable(),
  version: z.number().int().positive(),
  createdBy: z.string(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
});
export type PolicyVersion = z.infer<typeof policyVersionSchema>;
export const policyVersionDetailSchema = policyVersionSchema.extend({
  body: z.string(),
});
export type PolicyVersionDetail = z.infer<typeof policyVersionDetailSchema>;
const policyStatsSchema = z.strictObject({
  audience: z.number().int().nonnegative(),
  acknowledged: z.number().int().nonnegative(),
});
export const policyListItemSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  category: policyCategorySchema,
  title: z.string(),
  current: policyVersionSchema.nullable(),
  draft: policyVersionSchema.nullable(),
  stats: policyStatsSchema.nullable(),
});
export const policyListSchema = z.strictObject({
  items: z.array(policyListItemSchema),
  counts: z.strictObject({
    published: z.number().int().nonnegative(),
    drafts: z.number().int().nonnegative(),
    outstanding: z.number().int().nonnegative(),
  }),
});
export type PolicyList = z.infer<typeof policyListSchema>;
export const policyDetailSchema = z.strictObject({
  policy: z.strictObject({
    id: z.uuid(),
    code: z.string(),
    category: policyCategorySchema,
  }),
  versions: z.array(policyVersionDetailSchema),
  compliance: z
    .strictObject({
      versionId: z.uuid(),
      stats: policyStatsSchema,
      people: z.array(
        z.strictObject({
          employeeId: z.uuid(),
          name: z.string(),
          initials: z.string(),
          department: z.string(),
          acknowledgedAt: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});
export type PolicyDetail = z.infer<typeof policyDetailSchema>;
export const myPolicySchema = z.strictObject({
  versionId: z.uuid(),
  policyId: z.uuid(),
  code: z.string(),
  category: policyCategorySchema,
  title: z.string(),
  summary: z.string(),
  versionNumber: z.number().int().positive(),
  effectiveOn: z.string(),
  requiresAcknowledgement: z.boolean(),
  publishedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
});
export type MyPolicy = z.infer<typeof myPolicySchema>;
export const myPoliciesSchema = z.strictObject({
  items: z.array(myPolicySchema),
  outstanding: z.number().int().nonnegative(),
});
export type MyPolicies = z.infer<typeof myPoliciesSchema>;
export const myPolicyDetailSchema = myPolicySchema.extend({ body: z.string() });
export type MyPolicyDetail = z.infer<typeof myPolicyDetailSchema>;
const policyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/);
const policyContent = {
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(300),
  body: z.string().trim().min(20).max(20000),
  effectiveOn: z.iso.date(),
  requiresAcknowledgement: z.boolean().default(true),
  audienceDepartmentId: z
    .uuid()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
};
export const policyCreateSchema = z.strictObject({
  code: policyCode,
  category: policyCategorySchema,
  ...policyContent,
});
export const policyDraftSchema = z.strictObject({
  ...policyContent,
  version: z.number().int().positive(),
});
export const policyPublishSchema = z.strictObject({
  version: z.number().int().positive(),
});
export const policyWithdrawSchema = z.strictObject({
  version: z.number().int().positive(),
  note: z.string().trim().min(3).max(300),
});
export const policyAcknowledgeSchema = z.strictObject({});
// Exits: a resignation or HR-started exit, accepted with a last working day, cleared and completed.
export const exitKindSchema = z.enum([
  "resignation",
  "termination",
  "end_of_contract",
  "retirement",
  "other",
]);
export const exitStatusSchema = z.enum([
  "submitted",
  "accepted",
  "completed",
  "withdrawn",
  "rejected",
]);
export const exitClearanceItemSchema = z.enum([
  "assets",
  "finance",
  "it_access",
  "manager_handover",
  "hr_documents",
]);
export const exitClearanceStatusSchema = z.enum([
  "pending",
  "cleared",
  "waived",
]);
export type ExitKind = z.infer<typeof exitKindSchema>;
export type ExitStatus = z.infer<typeof exitStatusSchema>;
export type ExitClearanceItem = z.infer<typeof exitClearanceItemSchema>;
export type ExitClearanceStatus = z.infer<typeof exitClearanceStatusSchema>;
export const exitCaseSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeCode: z.string(),
  department: z.string().nullable(),
  kind: exitKindSchema,
  reason: z.string(),
  noticeGivenOn: z.string(),
  lastWorkingDay: z.string().nullable(),
  status: exitStatusSchema,
  decisionNote: z.string().nullable(),
  version: z.number().int().positive(),
  submittedBy: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
});
export type ExitCase = z.infer<typeof exitCaseSchema>;
export const exitClearanceSchema = z.strictObject({
  id: z.uuid(),
  item: exitClearanceItemSchema,
  status: exitClearanceStatusSchema,
  note: z.string().nullable(),
  clearedBy: z.string().nullable(),
  clearedAt: z.string().nullable(),
  version: z.number().int().positive(),
});
export type ExitClearance = z.infer<typeof exitClearanceSchema>;
export const exitDetailSchema = z.strictObject({
  case: exitCaseSchema,
  clearances: z.array(exitClearanceSchema),
  openAssets: z.number().int().nonnegative(),
});
export type ExitDetail = z.infer<typeof exitDetailSchema>;
export const myExitSchema = z.strictObject({
  current: exitDetailSchema.nullable(),
  history: z.array(exitCaseSchema),
});
export type MyExit = z.infer<typeof myExitSchema>;
export const exitListSchema = z.strictObject({
  items: z.array(exitCaseSchema),
  counts: z.strictObject({
    submitted: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    withdrawn: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
});
export type ExitList = z.infer<typeof exitListSchema>;
export const exitQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
  status: exitStatusSchema.optional(),
});
const exitReason = z.string().trim().min(3).max(500);
const exitNote = z.string().trim().min(3).max(500);
const exitVersion = z.number().int().positive();
export const exitSubmitSchema = z.strictObject({ reason: exitReason });
export const exitStartSchema = z.strictObject({
  employeeId: z.uuid(),
  kind: exitKindSchema,
  reason: exitReason,
  noticeGivenOn: z.iso.date(),
});
export const exitAcceptSchema = z.strictObject({
  version: exitVersion,
  lastWorkingDay: z.iso.date(),
  note: exitNote.optional(),
});
export const exitRejectSchema = z.strictObject({
  version: exitVersion,
  note: exitNote,
});
export const exitWithdrawSchema = z.strictObject({
  version: exitVersion,
  note: exitNote.optional(),
});
// Completing before the last working day needs earlyRelease and a reason.
export const exitCompleteSchema = z
  .strictObject({
    version: exitVersion,
    earlyRelease: z.boolean().optional(),
    note: exitNote.optional(),
  })
  .refine((value) => !value.earlyRelease || Boolean(value.note), {
    message: "Give a reason for the early release",
    path: ["note"],
  });
export const exitClearanceUpdateSchema = z.strictObject({
  version: exitVersion,
  status: exitClearanceStatusSchema,
  note: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});
// Expenses: INR claims in integer paise, decided by the manager or HR and paid by HR.
export const expenseKindSchema = z.enum(["expense", "travel", "advance"]);
export const expenseStatusSchema = z.enum([
  "submitted",
  "approved",
  "rejected",
  "paid",
  "cancelled",
]);
export type ExpenseKind = z.infer<typeof expenseKindSchema>;
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;
const minor = z.number().int().nonnegative();
export const expenseCategorySchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  perClaimLimitMinor: minor.nullable(),
  requiresReceiptOverMinor: minor.nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
export const expenseCategoryListSchema = z.strictObject({
  items: z.array(expenseCategorySchema),
});
export type ExpenseCategoryList = z.infer<typeof expenseCategoryListSchema>;
export const expenseClaimSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeCode: z.string(),
  department: z.string().nullable(),
  kind: expenseKindSchema,
  title: z.string(),
  categoryId: z.uuid(),
  categoryCode: z.string(),
  categoryName: z.string(),
  amountMinor: minor,
  currency: z.literal("INR"),
  expenseDate: z.string(),
  tripDestination: z.string().nullable(),
  description: z.string().nullable(),
  receiptReference: z.string().nullable(),
  status: expenseStatusSchema,
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  paidOn: z.string().nullable(),
  paymentReference: z.string().nullable(),
  paidAt: z.string().nullable(),
  paidBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  version: z.number().int().positive(),
  submittedBy: z.string(),
  createdAt: z.string(),
  canDecide: z.boolean(),
  canPay: z.boolean(),
  canCancel: z.boolean(),
});
export type ExpenseClaim = z.infer<typeof expenseClaimSchema>;
const expenseTotal = z.strictObject({
  count: z.number().int().nonnegative(),
  amountMinor: minor,
});
export const myExpensesSchema = z.strictObject({
  items: z.array(expenseClaimSchema),
  summary: z.strictObject({
    submitted: expenseTotal,
    approved: expenseTotal,
    paid: expenseTotal,
    rejected: expenseTotal,
    cancelled: expenseTotal,
  }),
  // Last 12 months by expense date, oldest first; rejected and cancelled claims excluded.
  months: z.array(
    z.strictObject({
      month: z.string(),
      count: z.number().int().nonnegative(),
      amountMinor: minor,
    }),
  ),
});
export type MyExpenses = z.infer<typeof myExpensesSchema>;
export const expenseListSchema = z.strictObject({
  items: z.array(expenseClaimSchema),
  counts: z.strictObject({
    submitted: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
  awaitingDecisionMinor: minor,
  awaitingPaymentMinor: minor,
});
export type ExpenseList = z.infer<typeof expenseListSchema>;
export const expenseQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
  status: expenseStatusSchema.optional(),
});
const expenseVersion = z.number().int().positive();
const expenseNote = z.string().trim().min(3).max(500);
const optionalText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value ?? null);
export const expenseSubmitSchema = z
  .strictObject({
    kind: expenseKindSchema,
    title: z.string().trim().min(3).max(120),
    categoryId: z.uuid(),
    amountMinor: z.number().int().positive().max(1_000_000_000),
    expenseDate: z.iso.date(),
    tripDestination: optionalText(2, 120),
    description: optionalText(1, 1000),
    receiptReference: optionalText(2, 80),
  })
  .refine(
    (value) => (value.kind === "expense") === (value.tripDestination === null),
    {
      message: "Travel claims and advances need a destination",
      path: ["tripDestination"],
    },
  );
export const expenseCancelSchema = z.strictObject({ version: expenseVersion });
export const expenseApproveSchema = z.strictObject({
  version: expenseVersion,
  note: expenseNote.optional(),
});
export const expenseRejectSchema = z.strictObject({
  version: expenseVersion,
  note: expenseNote,
});
export const expensePaySchema = z.strictObject({
  version: expenseVersion,
  paidOn: z.iso.date(),
  paymentReference: z.string().trim().min(2).max(80),
});
const categoryFields = {
  name: z.string().trim().min(2).max(60),
  perClaimLimitMinor: z.number().int().min(1).max(1_000_000_000).nullable(),
  requiresReceiptOverMinor: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .nullable(),
  active: z.boolean(),
};
export const expenseCategoryCreateSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,15}$/),
  ...categoryFields,
});
export const expenseCategoryUpdateSchema = z.strictObject({
  version: expenseVersion,
  ...categoryFields,
});
// Profile edits: an employee asks to change personal contact details; HR decides; an
// approved change applies on its effective date and leaves immutable history.
export const profileFieldSchema = z.enum([
  "personalPhone",
  "personalEmail",
  "emergencyName",
  "emergencyPhone",
  "emergencyRelationship",
  "addressLine1",
  "addressLine2",
  "city",
  "postalCode",
]);
export type ProfileField = z.infer<typeof profileFieldSchema>;
export const profileChangeStatusSchema = z.enum([
  "submitted",
  "approved",
  "rejected",
  "withdrawn",
  "applied",
]);
export type ProfileChangeStatus = z.infer<typeof profileChangeStatusSchema>;
const profilePhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{5,18}[0-9]$/, "Use digits, spaces or dashes");
// Formats are checked here: the database stores only sealed (encrypted) values.
export const profileFieldFormats: Record<ProfileField, z.ZodType<string>> = {
  personalPhone: profilePhone,
  personalEmail: z.string().trim().max(254).pipe(z.email()),
  emergencyName: z.string().trim().min(2).max(80),
  emergencyPhone: profilePhone,
  emergencyRelationship: z.string().trim().min(2).max(40),
  addressLine1: z.string().trim().min(3).max(120),
  addressLine2: z.string().trim().min(1).max(120),
  city: z.string().trim().min(2).max(60),
  postalCode: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/,
      "Use 3-10 letters or digits",
    ),
};
const profileValue = z.string().nullable();
export const profileDetailsSchema = z.strictObject({
  employeeId: z.uuid(),
  personalPhone: profileValue,
  personalEmail: profileValue,
  emergencyName: profileValue,
  emergencyPhone: profileValue,
  emergencyRelationship: profileValue,
  addressLine1: profileValue,
  addressLine2: profileValue,
  city: profileValue,
  postalCode: profileValue,
  // Fields whose stored value could not be opened (shown as null); never the value itself.
  unavailable: z.array(profileFieldSchema),
  // 0 until the first approved change creates the record.
  version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type ProfileDetails = z.infer<typeof profileDetailsSchema>;
export const profileChangeSchema = z.strictObject({
  field: profileFieldSchema,
  value: profileValue,
  // true when the stored value could not be opened; value is then null.
  unavailable: z.boolean(),
});
export type ProfileChange = z.infer<typeof profileChangeSchema>;
export const profileChangeRequestSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeCode: z.string(),
  fields: z.array(profileFieldSchema),
  // Values only for the owner and on HR's audited detail view; null in lists.
  changes: z.array(profileChangeSchema).nullable(),
  reason: z.string().nullable(),
  effectiveOn: z.string(),
  status: profileChangeStatusSchema,
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  appliedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  withdrawnBy: z.string().nullable(),
  submittedBy: z.string(),
  createdAt: z.string(),
  version: z.number().int().positive(),
  canDecide: z.boolean(),
  // Owner: while submitted, or approved and not yet due.
  canWithdraw: z.boolean(),
  // HR: an approved change that is not yet due (needs a note; never one's own).
  canCancel: z.boolean(),
});
export type ProfileChangeRequest = z.infer<typeof profileChangeRequestSchema>;
export const profileHistoryEntrySchema = z.strictObject({
  id: z.uuid(),
  requestId: z.uuid(),
  field: profileFieldSchema,
  oldValue: profileValue,
  newValue: profileValue,
  effectiveOn: z.string(),
  appliedAt: z.string(),
  approvedBy: z.string(),
  // true when the old or new value could not be opened; that value is then null.
  unavailable: z.boolean(),
});
export type ProfileHistoryEntry = z.infer<typeof profileHistoryEntrySchema>;
export const profileHistorySchema = z.strictObject({
  items: z.array(profileHistoryEntrySchema),
});
export type ProfileHistory = z.infer<typeof profileHistorySchema>;
export const myProfileSchema = z.strictObject({
  profile: profileDetailsSchema,
  open: profileChangeRequestSchema.nullable(),
  requests: z.array(profileChangeRequestSchema),
  history: z.array(profileHistoryEntrySchema),
});
export type MyProfile = z.infer<typeof myProfileSchema>;
export const profileEmployeeSchema = z.strictObject({
  employee: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    code: z.string(),
  }),
  profile: profileDetailsSchema,
  open: profileChangeRequestSchema.nullable(),
  history: z.array(profileHistoryEntrySchema),
});
export type ProfileEmployee = z.infer<typeof profileEmployeeSchema>;
export const profileRequestListSchema = z.strictObject({
  items: z.array(profileChangeRequestSchema),
  counts: z.strictObject({
    submitted: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    withdrawn: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
  }),
});
export type ProfileRequestList = z.infer<typeof profileRequestListSchema>;
export const profileApplyDueResultSchema = z.strictObject({
  applied: z.number().int().nonnegative(),
});
export type ProfileApplyDueResult = z.infer<typeof profileApplyDueResultSchema>;
export const profileRequestQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
  status: profileChangeStatusSchema.optional(),
});
const profileVersion = z.number().int().positive();
const profileNote = z.string().trim().min(3).max(500);
export const profileSubmitSchema = z
  .strictObject({
    changes: z
      .array(
        z.strictObject({
          field: profileFieldSchema,
          // null clears the field.
          value: z.string().max(254).nullable(),
        }),
      )
      .min(1)
      .max(9),
    reason: z.string().trim().min(3).max(500),
    effectiveOn: z.iso.date(),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.changes.forEach((change, index) => {
      if (seen.has(change.field))
        ctx.addIssue({
          code: "custom",
          message: "Each field may change only once",
          path: ["changes", index, "field"],
        });
      seen.add(change.field);
      if (change.value === null) return;
      const result = profileFieldFormats[change.field].safeParse(change.value);
      if (!result.success)
        ctx.addIssue({
          code: "custom",
          message: result.error.issues[0]?.message ?? "Invalid value",
          path: ["changes", index, "value"],
        });
    });
  })
  .transform((input) => ({
    ...input,
    changes: input.changes.map((change) => ({
      field: change.field,
      value: change.value === null ? null : change.value.trim(),
    })),
  }));
export const profileWithdrawSchema = z.strictObject({
  version: profileVersion,
});
export const profileApproveSchema = z.strictObject({
  version: profileVersion,
  note: profileNote.optional(),
});
export const profileRejectSchema = z.strictObject({
  version: profileVersion,
  note: profileNote,
});
export const profileCancelSchema = z.strictObject({
  version: profileVersion,
  note: profileNote,
});
export const profileApplyDueSchema = z.strictObject({});
export {
  activationReadiness,
  onboardingStarter,
  submissionChanges,
} from "./onboarding";

// RPT-01 reports: a fixed catalog of datasets; a definition only names whitelisted
// columns, operators and a sort, never SQL. The server checks every key against the
// catalog and the caller's field authorization.
export const reportDatasetSchema = z.enum([
  "people",
  "leave",
  "attendance",
  "expenses",
  "assets",
  "policyAcknowledgements",
  "exits",
]);
export type ReportDataset = z.infer<typeof reportDatasetSchema>;
export const reportColumnTypeSchema = z.enum([
  "text",
  "enum",
  "number",
  "money",
  "date",
]);
export const reportOperatorSchema = z.enum([
  "eq",
  "in",
  "between",
  "contains",
  "gte",
  "lte",
]);
export type ReportOperator = z.infer<typeof reportOperatorSchema>;
const reportColumnKey = z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/);
const reportScalar = z.union([
  z.string().max(120),
  z.number().finite().min(-1e12).max(1e12),
]);
export const reportFilterSchema = z.discriminatedUnion("op", [
  z.strictObject({
    column: reportColumnKey,
    op: z.literal("eq"),
    value: reportScalar,
  }),
  z.strictObject({
    column: reportColumnKey,
    op: z.literal("in"),
    values: z.array(z.string().max(120)).min(1).max(50),
  }),
  z.strictObject({
    column: reportColumnKey,
    op: z.literal("between"),
    from: reportScalar,
    to: reportScalar,
  }),
  z.strictObject({
    column: reportColumnKey,
    op: z.literal("contains"),
    value: z.string().trim().min(1).max(80),
  }),
  z.strictObject({
    column: reportColumnKey,
    op: z.enum(["gte", "lte"]),
    value: reportScalar,
  }),
]);
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export const reportSortSchema = z.strictObject({
  column: reportColumnKey,
  direction: z.enum(["asc", "desc"]),
});
export const reportDefinitionSchema = z
  .strictObject({
    dataset: reportDatasetSchema,
    columns: z.array(reportColumnKey).min(1).max(20),
    filters: z.array(reportFilterSchema).max(10).default([]),
    sort: reportSortSchema.optional(),
    // On-screen rows; exports use their own cap.
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.columns).size !== value.columns.length)
      ctx.addIssue({
        code: "custom",
        message: "Each column may appear only once",
        path: ["columns"],
      });
    if (new TextEncoder().encode(JSON.stringify(value)).length > 8000)
      ctx.addIssue({
        code: "custom",
        message: "This report definition is too large (8,000 bytes at most)",
        path: [],
      });
  });
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
export const reportRunSchema = z.strictObject({
  definition: reportDefinitionSchema,
});
export const reportExportSchema = z.strictObject({
  definition: reportDefinitionSchema,
  // Used only to name the downloaded file; reduced to [a-z0-9-].
  fileName: z.string().trim().min(1).max(80).optional(),
});
export const reportColumnSchema = z.strictObject({
  key: z.string(),
  label: z.string(),
  type: reportColumnTypeSchema,
  sensitive: z.boolean(),
  operators: z.array(reportOperatorSchema),
  options: z.array(z.string()).optional(),
});
export const reportCatalogSchema = z.strictObject({
  scope: z.enum(["team", "entity"]),
  canExport: z.boolean(),
  limits: z.strictObject({
    maxColumns: z.number().int(),
    maxFilters: z.number().int(),
    runRows: z.number().int(),
    exportRows: z.number().int(),
    savedReports: z.number().int(),
    exportsPerMinute: z.number().int(),
    runsPerMinute: z.number().int(),
  }),
  datasets: z.array(
    z.strictObject({
      key: reportDatasetSchema,
      label: z.string(),
      description: z.string(),
      columns: z.array(reportColumnSchema),
    }),
  ),
});
export type ReportCatalog = z.infer<typeof reportCatalogSchema>;
export const reportResultSchema = z.strictObject({
  dataset: reportDatasetSchema,
  scope: z.enum(["team", "entity"]),
  // Money cells are integer paise (INR); dates are YYYY-MM-DD.
  columns: z.array(
    z.strictObject({
      key: z.string(),
      label: z.string(),
      type: reportColumnTypeSchema,
    }),
  ),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  total: z.number().int().min(0),
  truncated: z.boolean(),
  // The count stops at 10,001; true means "more than 10,000".
  totalCapped: z.boolean(),
});
export type ReportResult = z.infer<typeof reportResultSchema>;
const savedReportName = z.string().trim().min(3).max(80);
export const savedReportSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  dataset: reportDatasetSchema,
  // Null when the caller's current role may not run it, so filter values stay hidden.
  definition: reportDefinitionSchema.nullable(),
  // False when the caller's current role may no longer run this definition.
  runnable: z.boolean(),
  archived: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedReport = z.infer<typeof savedReportSchema>;
export const savedReportListSchema = z.strictObject({
  items: z.array(savedReportSchema),
  limit: z.number().int(),
});
export type SavedReportList = z.infer<typeof savedReportListSchema>;
export const savedReportCreateSchema = z.strictObject({
  name: savedReportName,
  definition: reportDefinitionSchema,
});
export const savedReportUpdateSchema = z.strictObject({
  name: savedReportName,
  definition: reportDefinitionSchema,
  version: z.number().int().positive(),
});
export const savedReportArchiveSchema = z.strictObject({
  version: z.number().int().positive(),
});

// Projects, tasks and time tracking (no money). Owners and HR manage; members log time.
export const projectStatusSchema = z.enum([
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export const projectMemberRoleSchema = z.enum(["member", "lead"]);
export const projectTaskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
]);
export type ProjectTaskStatus = z.infer<typeof projectTaskStatusSchema>;
export const projectTaskPrioritySchema = z.enum(["low", "normal", "high"]);
export const timeEntryStatusSchema = z.enum([
  "submitted",
  "approved",
  "rejected",
  "withdrawn",
]);
export type TimeEntryStatus = z.infer<typeof timeEntryStatusSchema>;
const projectVersion = z.number().int().positive();
const projectText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).nullable().optional();
const optionalDate = z.iso.date().nullable().optional();
const optionalId = z.uuid().nullable().optional();

export const projectSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  ownerEmployeeId: z.uuid(),
  ownerName: z.string(),
  status: projectStatusSchema,
  startDate: z.string(),
  endDate: z.string().nullable(),
  memberCount: z.number().int(),
  openTaskCount: z.number().int(),
  version: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  // UI flags: what the caller may do now; the database decides again on every write.
  canManage: z.boolean(),
  canLogTime: z.boolean(),
  canReopen: z.boolean(),
});
export type Project = z.infer<typeof projectSchema>;
export const projectListSchema = z.strictObject({
  items: z.array(projectSchema),
  counts: z.strictObject({
    planned: z.number().int(),
    active: z.number().int(),
    on_hold: z.number().int(),
    completed: z.number().int(),
    cancelled: z.number().int(),
  }),
  total: z.number().int(),
  limit: z.number().int(),
  canCreate: z.boolean(),
});
export type ProjectList = z.infer<typeof projectListSchema>;
export const projectQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
  status: projectStatusSchema.optional(),
});
export const projectCreateSchema = z
  .strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_-]{1,19}$/),
    name: z.string().trim().min(2).max(80),
    description: projectText(1, 500),
    // HR may name another owner; a manager always owns what they create.
    ownerEmployeeId: optionalId,
    status: z.enum(["planned", "active"]).default("planned"),
    startDate: z.iso.date(),
    endDate: optionalDate,
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "The end date cannot be before the start date",
    path: ["endDate"],
  });
export const projectUpdateSchema = z
  .strictObject({
    version: projectVersion,
    name: z.string().trim().min(2).max(80),
    description: projectText(1, 500),
    ownerEmployeeId: z.uuid(),
    startDate: z.iso.date(),
    endDate: optionalDate,
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "The end date cannot be before the start date",
    path: ["endDate"],
  });
export const projectStatusChangeSchema = z.strictObject({
  version: projectVersion,
  status: projectStatusSchema,
});

export const projectMemberSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeCode: z.string(),
  role: projectMemberRoleSchema,
  addedBy: z.string(),
  addedAt: z.string(),
  removedAt: z.string().nullable(),
  removedBy: z.string().nullable(),
  version: z.number().int(),
  canRemove: z.boolean(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export const projectMemberListSchema = z.strictObject({
  items: z.array(projectMemberSchema),
  counts: z.strictObject({
    active: z.number().int(),
    removed: z.number().int(),
  }),
  limit: z.number().int(),
  canAdd: z.boolean(),
});
export type ProjectMemberList = z.infer<typeof projectMemberListSchema>;
export const projectMemberAddSchema = z.strictObject({
  employeeId: z.uuid(),
  role: projectMemberRoleSchema.default("member"),
});
export const projectMemberRemoveSchema = z.strictObject({
  version: projectVersion,
});

export const projectTaskSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  assigneeEmployeeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  status: projectTaskStatusSchema,
  priority: projectTaskPrioritySchema,
  dueDate: z.string().nullable(),
  version: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
  canChangeStatus: z.boolean(),
});
export type ProjectTask = z.infer<typeof projectTaskSchema>;
export const projectTaskListSchema = z.strictObject({
  items: z.array(projectTaskSchema),
  counts: z.strictObject({
    todo: z.number().int(),
    in_progress: z.number().int(),
    blocked: z.number().int(),
    done: z.number().int(),
  }),
  limit: z.number().int(),
  canAdd: z.boolean(),
});
export type ProjectTaskList = z.infer<typeof projectTaskListSchema>;
export const projectTaskCreateSchema = z.strictObject({
  title: z.string().trim().min(3).max(120),
  description: projectText(1, 1000),
  assigneeEmployeeId: optionalId,
  priority: projectTaskPrioritySchema.default("normal"),
  dueDate: optionalDate,
});
export const projectTaskUpdateSchema = z.strictObject({
  version: projectVersion,
  title: z.string().trim().min(3).max(120),
  description: projectText(1, 1000),
  assigneeEmployeeId: z.uuid().nullable(),
  priority: projectTaskPrioritySchema,
  dueDate: optionalDate,
});
export const projectTaskStatusChangeSchema = z.strictObject({
  version: projectVersion,
  status: projectTaskStatusSchema,
});

export const timeEntrySchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  projectId: z.uuid(),
  projectCode: z.string(),
  projectName: z.string().nullable(),
  taskId: z.uuid().nullable(),
  taskTitle: z.string().nullable(),
  workDate: z.string(),
  minutes: z.number().int(),
  note: z.string().nullable(),
  status: timeEntryStatusSchema,
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  canWithdraw: z.boolean(),
  canDecide: z.boolean(),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;
export const myTimeSchema = z.strictObject({
  items: z.array(timeEntrySchema),
  limit: z.number().int(),
  // Monday to Sunday of the requested week; submitted and approved time only.
  week: z.strictObject({
    start: z.string(),
    end: z.string(),
    totalMinutes: z.number().int(),
    projects: z.array(
      z.strictObject({
        projectId: z.uuid(),
        projectCode: z.string(),
        projectName: z.string().nullable(),
        minutes: z.number().int(),
      }),
    ),
  }),
  counts: z.strictObject({
    submitted: z.number().int(),
    approved: z.number().int(),
    rejected: z.number().int(),
    withdrawn: z.number().int(),
  }),
  // Active projects the caller can log time on now.
  projects: z.array(
    z.strictObject({ id: z.uuid(), code: z.string(), name: z.string() }),
  ),
});
export type MyTime = z.infer<typeof myTimeSchema>;
export const myTimeQuerySchema = z.strictObject({
  weekOf: z.iso.date().optional(),
});
export const timeReviewSchema = z.strictObject({
  items: z.array(timeEntrySchema),
  total: z.number().int(),
  awaitingMinutes: z.number().int(),
  limit: z.number().int(),
});
export type TimeReview = z.infer<typeof timeReviewSchema>;
export const timeEntryCreateSchema = z.strictObject({
  projectId: z.uuid(),
  taskId: optionalId,
  workDate: z.iso.date(),
  minutes: z.number().int().min(15).max(720).multipleOf(15),
  note: projectText(1, 300),
});
export const timeEntryWithdrawSchema = z.strictObject({
  version: projectVersion,
});
export const timeEntryApproveSchema = z.strictObject({
  version: projectVersion,
  note: z.string().trim().min(3).max(500).optional(),
});
export const timeEntryRejectSchema = z.strictObject({
  version: projectVersion,
  note: z.string().trim().min(3).max(500),
});

// ----- Recruitment (REC-01): requisitions, candidates, applications, interviews, scorecards, offers.
// Contact details (email, phone) are returned only to HR (recruit.manage); hiring managers and
// interviewers see name, current company and experience. Offers carry no salary. "Sent" is a
// recorded status: no email is dispatched. Every list is paginated: page (default 1),
// limit (default 25, max 100), and returns { items, total, page, limit, counts }.
const recruitVersion = z.number().int().positive();
const recruitNote = z.string().trim().min(3).max(500);
const recruitPaging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const recruitPage = {
  total: z.number().int(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
};
const recruitQ = z.string().trim().max(80).default("");
export const recruitRequisitionStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "open",
  "on_hold",
  "closed",
  "rejected",
  "cancelled",
]);
export const recruitEmploymentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "intern",
]);
export const recruitStageSchema = z.enum([
  "applied",
  "screening",
  "interview",
  "assessment",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
]);
export type RecruitStage = z.infer<typeof recruitStageSchema>;
export const recruitRejectionReasonSchema = z.enum([
  "not_a_fit",
  "salary",
  "experience",
  "withdrew",
  "no_show",
  "position_filled",
  "failed_assessment",
  "other",
]);
export const recruitSourceSchema = z.enum([
  "portal",
  "referral",
  "agency",
  "campaign",
  "direct",
  "other",
]);
export const recruitInterviewModeSchema = z.enum(["video", "phone", "onsite"]);
export const recruitInterviewStatusSchema = z.enum([
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);
export const recruitRecommendationSchema = z.enum([
  "strong_yes",
  "yes",
  "no",
  "strong_no",
]);
export const recruitOfferStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
]);
const recruitRating = z.number().int().min(1).max(5);
export const recruitRatingsSchema = z
  .strictObject({
    skills: recruitRating.optional(),
    communication: recruitRating.optional(),
    problem_solving: recruitRating.optional(),
    culture_fit: recruitRating.optional(),
    ownership: recruitRating.optional(),
  })
  .refine((v) => Object.values(v).some((r) => r !== undefined), {
    message: "Rate at least one competency",
  });

export const recruitRequisitionSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string().nullable(),
  locationId: z.uuid(),
  locationName: z.string().nullable(),
  designationId: z.uuid().nullable(),
  designationName: z.string().nullable(),
  headcount: z.number().int(),
  // Derived from hired applications.
  filledCount: z.number().int(),
  applicationCount: z.number().int(),
  employmentType: recruitEmploymentTypeSchema,
  hiringManagerId: z.uuid(),
  hiringManagerName: z.string(),
  description: z.string().nullable(),
  targetStart: z.string().nullable(),
  status: recruitRequisitionStatusSchema,
  statusNote: z.string().nullable(),
  requestedByEmployeeId: z.uuid(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  // A material edit after approval sent it back for approval; its author cannot approve it.
  needsReapproval: z.boolean(),
  reapprovalRequestedByEmployeeId: z.uuid().nullable(),
  version: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  // UI flags: what the caller may do now; the database decides again on every write.
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
  canDecide: z.boolean(),
  canOpen: z.boolean(),
  canHold: z.boolean(),
  canClose: z.boolean(),
  canCancel: z.boolean(),
  canAddCandidates: z.boolean(),
});
export type RecruitRequisition = z.infer<typeof recruitRequisitionSchema>;
export const recruitRequisitionListSchema = z.strictObject({
  items: z.array(recruitRequisitionSchema),
  ...recruitPage,
  counts: z.record(recruitRequisitionStatusSchema, z.number().int()),
  canCreate: z.boolean(),
});
export type RecruitRequisitionList = z.infer<
  typeof recruitRequisitionListSchema
>;
export const recruitRequisitionQuerySchema = z.strictObject({
  ...recruitPaging,
  q: recruitQ,
  status: recruitRequisitionStatusSchema.optional(),
});
const recruitRequisitionFields = {
  title: z.string().trim().min(3).max(120),
  departmentId: z.uuid(),
  locationId: z.uuid(),
  designationId: z.uuid().nullable().optional(),
  headcount: z.number().int().min(1).max(50),
  employmentType: recruitEmploymentTypeSchema,
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  targetStart: z.iso.date().nullable().optional(),
};
export const recruitRequisitionCreateSchema = z.strictObject({
  ...recruitRequisitionFields,
  // HR may name another hiring manager; a manager always raises for themselves.
  hiringManagerId: z.uuid().nullable().optional(),
});
export const recruitRequisitionUpdateSchema = z.strictObject({
  ...recruitRequisitionFields,
  version: recruitVersion,
  hiringManagerId: z.uuid(),
});
export const recruitRequisitionActionSchema = z.strictObject({
  version: recruitVersion,
  note: recruitNote.optional(),
});
export const recruitRequisitionReasonSchema = z.strictObject({
  version: recruitVersion,
  note: recruitNote,
});

export const recruitCandidateSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  // Contact details only for HR: masked (a***@d***.com, ******3210) in lists, in full on the
  // audited detail read; null for everyone else (and when a key cannot open them).
  contactVisible: z.boolean(),
  contactMasked: z.boolean(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  currentCompany: z.string().nullable(),
  totalExperienceMonths: z.number().int(),
  source: recruitSourceSchema,
  referrerEmployeeId: z.uuid().nullable(),
  consentRecordedAt: z.string().nullable(),
  retentionUntil: z.string().nullable(),
  consentWithdrawnAt: z.string().nullable(),
  anonymised: z.boolean(),
  // Consent withdrawn or retention date passed: HR may anonymise (nothing runs automatically).
  purgeEligible: z.boolean(),
  notes: z.string().nullable(),
  applicationCount: z.number().int(),
  version: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: z.string().nullable(),
  canExtendRetention: z.boolean(),
  canWithdrawConsent: z.boolean(),
  canAnonymise: z.boolean(),
});
export type RecruitCandidate = z.infer<typeof recruitCandidateSchema>;
export const recruitCandidateListSchema = z.strictObject({
  items: z.array(recruitCandidateSchema),
  ...recruitPage,
  counts: z.strictObject({
    total: z.number().int(),
    purgeEligible: z.number().int(),
  }),
});
export type RecruitCandidateList = z.infer<typeof recruitCandidateListSchema>;
export const recruitCandidateQuerySchema = z.strictObject({
  ...recruitPaging,
  q: recruitQ,
  source: recruitSourceSchema.optional(),
});
export const recruitCandidateCreateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().max(254).pipe(z.email()),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,20}$/)
      .nullable()
      .optional(),
    currentCompany: z.string().trim().min(1).max(120).nullable().optional(),
    totalExperienceMonths: z.number().int().min(0).max(720),
    source: recruitSourceSchema,
    referrerEmployeeId: z.uuid().nullable().optional(),
    // Must be true: candidate details are stored only with recorded consent.
    consentGiven: z.boolean(),
    retentionUntil: z.iso.date().nullable().optional(),
    notes: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .refine((v) => v.source !== "referral" || v.referrerEmployeeId, {
    message: "Name the referring employee",
    path: ["referrerEmployeeId"],
  });
export const recruitCandidateRetentionSchema = z.strictObject({
  version: recruitVersion,
  retentionUntil: z.iso.date(),
});
export const recruitCandidateWithdrawConsentSchema = z.strictObject({
  version: recruitVersion,
  reason: z.string().trim().min(10).max(500),
});
// Irreversible: clears name, contact details, notes, company and referrer.
export const recruitCandidateAnonymiseSchema = z.strictObject({
  reason: z.string().trim().min(10).max(500),
});

export const recruitApplicationSchema = z.strictObject({
  id: z.uuid(),
  candidateId: z.uuid(),
  requisitionId: z.uuid(),
  requisitionCode: z.string(),
  requisitionTitle: z.string(),
  candidateName: z.string(),
  candidateCompany: z.string().nullable(),
  candidateExperienceMonths: z.number().int(),
  source: recruitSourceSchema,
  stage: recruitStageSchema,
  previousStage: recruitStageSchema.nullable(),
  stageEnteredAt: z.string(),
  daysInStage: z.number().int(),
  rejectionReason: recruitRejectionReasonSchema.nullable(),
  // Average of submitted scorecards (1..5); null until one is submitted.
  ratingAverage: z.number().nullable(),
  scorecardCount: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Stages the caller may move this application to now.
  allowedStages: z.array(recruitStageSchema),
  canScheduleInterview: z.boolean(),
  canMakeOffer: z.boolean(),
});
export type RecruitApplication = z.infer<typeof recruitApplicationSchema>;
export const recruitApplicationListSchema = z.strictObject({
  items: z.array(recruitApplicationSchema),
  ...recruitPage,
  counts: z.record(recruitStageSchema, z.number().int()),
  canCreate: z.boolean(),
});
export type RecruitApplicationList = z.infer<
  typeof recruitApplicationListSchema
>;
export const recruitApplicationQuerySchema = z.strictObject({
  ...recruitPaging,
  q: recruitQ,
  stage: recruitStageSchema.optional(),
  requisitionId: z.uuid().optional(),
  source: recruitSourceSchema.optional(),
});
export const recruitApplicationCreateSchema = z.strictObject({
  candidateId: z.uuid(),
  requisitionId: z.uuid(),
});
export const recruitStageChangeSchema = z.strictObject({
  version: recruitVersion,
  stage: recruitStageSchema,
  reason: recruitNote.optional(),
  rejectionReason: recruitRejectionReasonSchema.optional(),
});
export const recruitStageHistorySchema = z.strictObject({
  fromStage: recruitStageSchema.nullable(),
  toStage: recruitStageSchema,
  reason: z.string().nullable(),
  rejectionReason: recruitRejectionReasonSchema.nullable(),
  by: z.string(),
  at: z.string(),
});

export const recruitInterviewSchema = z.strictObject({
  id: z.uuid(),
  applicationId: z.uuid(),
  requisitionId: z.uuid(),
  requisitionTitle: z.string(),
  candidateName: z.string(),
  roundName: z.string(),
  scheduledAt: z.string(),
  durationMinutes: z.number().int(),
  endsAt: z.string(),
  mode: recruitInterviewModeSchema,
  // Shown as text only; links are never fetched.
  locationOrLink: z.string().nullable(),
  status: recruitInterviewStatusSchema,
  statusNote: z.string().nullable(),
  panel: z.array(
    z.strictObject({
      employeeId: z.uuid(),
      employeeName: z.string(),
      submitted: z.boolean(),
    }),
  ),
  onPanel: z.boolean(),
  myScorecardSubmitted: z.boolean(),
  version: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canReschedule: z.boolean(),
  canChangeStatus: z.boolean(),
  canSubmitScorecard: z.boolean(),
});
export type RecruitInterview = z.infer<typeof recruitInterviewSchema>;
export const recruitInterviewListSchema = z.strictObject({
  items: z.array(recruitInterviewSchema),
  ...recruitPage,
  counts: z.record(recruitInterviewStatusSchema, z.number().int()),
});
export type RecruitInterviewList = z.infer<typeof recruitInterviewListSchema>;
export const recruitInterviewQuerySchema = z.strictObject({
  ...recruitPaging,
  q: recruitQ,
  status: recruitInterviewStatusSchema.optional(),
  requisitionId: z.uuid().optional(),
  applicationId: z.uuid().optional(),
});
const recruitSlot = {
  scheduledAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(240).multipleOf(15),
  mode: recruitInterviewModeSchema,
  locationOrLink: z.string().trim().min(1).max(200).nullable().optional(),
};
export const recruitInterviewCreateSchema = z.strictObject({
  applicationId: z.uuid(),
  roundName: z.string().trim().min(3).max(60),
  ...recruitSlot,
  panel: z
    .array(z.uuid())
    .min(1)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "List each interviewer once",
    }),
});
export const recruitInterviewRescheduleSchema = z.strictObject({
  version: recruitVersion,
  ...recruitSlot,
});
export const recruitInterviewStatusChangeSchema = z.strictObject({
  version: recruitVersion,
  status: z.enum(["completed", "cancelled", "no_show"]),
  note: recruitNote.optional(),
});

export const recruitScorecardSchema = z.strictObject({
  id: z.uuid(),
  interviewId: z.uuid(),
  applicationId: z.uuid(),
  interviewerEmployeeId: z.uuid(),
  interviewerName: z.string(),
  ratings: z.record(z.string(), z.number().int()),
  overall: z.number(),
  recommendation: recruitRecommendationSchema,
  comment: z.string().nullable(),
  submittedAt: z.string(),
  mine: z.boolean(),
});
export type RecruitScorecard = z.infer<typeof recruitScorecardSchema>;
export const recruitScorecardListSchema = z.strictObject({
  items: z.array(recruitScorecardSchema),
  // True while the caller is an interviewer who has not submitted their own scorecard for
  // this application: other interviewers' scorecards stay hidden until then.
  blind: z.boolean(),
});
export const recruitScorecardCreateSchema = z.strictObject({
  ratings: recruitRatingsSchema,
  recommendation: recruitRecommendationSchema,
  comment: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const recruitOfferSchema = z.strictObject({
  id: z.uuid(),
  applicationId: z.uuid(),
  requisitionId: z.uuid(),
  candidateId: z.uuid(),
  candidateName: z.string(),
  title: z.string(),
  departmentId: z.uuid(),
  locationId: z.uuid(),
  designationId: z.uuid().nullable(),
  managerId: z.uuid(),
  managerName: z.string(),
  proposedJoiningDate: z.string(),
  status: recruitOfferStatusSchema,
  statusNote: z.string().nullable(),
  createdBy: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  // Recorded only: no offer email is sent.
  sentAt: z.string().nullable(),
  respondedOn: z.string().nullable(),
  candidateCaseId: z.uuid().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canSubmit: z.boolean(),
  canApprove: z.boolean(),
  canSend: z.boolean(),
  canRecordResponse: z.boolean(),
  canWithdraw: z.boolean(),
});
export type RecruitOffer = z.infer<typeof recruitOfferSchema>;
export const recruitOfferListSchema = z.strictObject({
  items: z.array(recruitOfferSchema),
  ...recruitPage,
  counts: z.record(recruitOfferStatusSchema, z.number().int()),
});
export type RecruitOfferList = z.infer<typeof recruitOfferListSchema>;
export const recruitOfferQuerySchema = z.strictObject({
  ...recruitPaging,
  q: recruitQ,
  status: recruitOfferStatusSchema.optional(),
  requisitionId: z.uuid().optional(),
});
export const recruitOfferCreateSchema = z.strictObject({
  applicationId: z.uuid(),
  proposedJoiningDate: z.iso.date(),
  // Prefilled from the requisition when omitted.
  departmentId: z.uuid().nullable().optional(),
  locationId: z.uuid().nullable().optional(),
  designationId: z.uuid().nullable().optional(),
  managerId: z.uuid().nullable().optional(),
});
export const recruitOfferActionSchema = z.strictObject({
  version: recruitVersion,
  note: recruitNote.optional(),
});
export const recruitOfferWithdrawSchema = z.strictObject({
  version: recruitVersion,
  note: recruitNote,
});
export const recruitOfferDeclineSchema = z.strictObject({
  version: recruitVersion,
  respondedOn: z.iso.date(),
  // true records the offer as expired rather than declined.
  expired: z.boolean().default(false),
  note: recruitNote.optional(),
});
export const recruitOfferAcceptSchema = z.strictObject({
  version: recruitVersion,
  respondedOn: z.iso.date(),
  // The pre-boarding preview accepts only synthetic @anvi.example addresses.
  preboardingEmail: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .refine((v) => v.toLowerCase().endsWith("@anvi.example"), {
      message:
        "Use a synthetic @anvi.example address for the pre-boarding preview",
    }),
});
export const recruitApplicationDetailSchema = z.strictObject({
  application: recruitApplicationSchema,
  history: z.array(recruitStageHistorySchema),
  interviews: z.array(recruitInterviewSchema),
  scorecards: recruitScorecardListSchema,
  // HR only; empty for hiring managers.
  offers: z.array(recruitOfferSchema),
});
export type RecruitApplicationDetail = z.infer<
  typeof recruitApplicationDetailSchema
>;
export const recruitOfferAcceptedSchema = z.strictObject({
  offer: recruitOfferSchema,
  application: recruitApplicationSchema,
  candidateCaseId: z.uuid(),
  preboarding: z.string(),
});
export type RecruitOfferAccepted = z.infer<typeof recruitOfferAcceptedSchema>;

export const recruitFunnelQuerySchema = z.strictObject({
  requisitionId: z.uuid().optional(),
});
// Aggregates only: no names or contact details.
export const recruitFunnelSchema = z.strictObject({
  requisitionId: z.uuid().nullable(),
  totalApplications: z.number().int(),
  stages: z.array(
    z.strictObject({
      stage: recruitStageSchema,
      current: z.number().int(),
      // Applications that ever reached this stage.
      reached: z.number().int(),
      conversionPercent: z.number().nullable(),
      averageDaysInStage: z.number().nullable(),
    }),
  ),
  sources: z.array(
    z.strictObject({ source: recruitSourceSchema, count: z.number().int() }),
  ),
  requisitions: z.strictObject({
    open: z.number().int(),
    onHold: z.number().int(),
    pendingApproval: z.number().int(),
    openHeadcount: z.number().int(),
    filled: z.number().int(),
  }),
  perRequisition: z.array(
    z.strictObject({
      requisitionId: z.uuid(),
      code: z.string(),
      title: z.string(),
      status: recruitRequisitionStatusSchema,
      headcount: z.number().int(),
      filledCount: z.number().int(),
      applications: z.number().int(),
    }),
  ),
});
export type RecruitFunnel = z.infer<typeof recruitFunnelSchema>;

// Pick-lists for raising a requisition (recruit.request or recruit.manage). Only the id, code
// and name of departments, locations and designations in effect today; no other org data.
const recruitLookupItemSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
export const recruitLookupsSchema = z.strictObject({
  departments: z.array(recruitLookupItemSchema),
  locations: z.array(recruitLookupItemSchema),
  designations: z.array(recruitLookupItemSchema),
});
export type RecruitLookups = z.infer<typeof recruitLookupsSchema>;

// ---- Performance basics (PERF-01) ----
// Goals (objectives with key results) and review cycles with self and manager reviews.
// Visibility: the owner, the owner's direct manager and HR. Reviews are blind: the manager sees
// the self-review only after submitting theirs; the employee sees the manager review and the
// final rating only once HR has finalised. Ratings are human inputs only: nothing is scored,
// suggested or summarised automatically. Every list is paginated: page (default 1), limit
// (default 25, max 100), and returns { items, total, page, limit, counts }.
const perfVersion = z.number().int().positive();
const perfNote = z.string().trim().min(3).max(500);
const perfPaging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const perfPage = {
  total: z.number().int(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
};
const perfQ = z.string().trim().max(80).default("");
const perfValue = z.number().min(-999999999999).max(999999999999);
export const perfObjectiveStatusSchema = z.enum([
  "draft",
  "active",
  "completed",
  "cancelled",
]);
export const perfUnitSchema = z.enum([
  "number",
  "percent",
  "currency",
  "hours",
]);
export const perfCycleStatusSchema = z.enum([
  "draft",
  "active",
  "closed",
  "cancelled",
]);
export const perfReviewStatusSchema = z.enum([
  "self_pending",
  "manager_pending",
  "calibration",
  "finalised",
]);
export const perfCompetencySchema = z.enum([
  "quality",
  "delivery",
  "collaboration",
  "ownership",
  "growth",
]);
export type PerfCompetency = z.infer<typeof perfCompetencySchema>;
const perfRating = z.number().int().min(1).max(5);
// All five fixed competencies, each rated 1 to 5.
export const perfRatingsSchema = z.strictObject({
  quality: perfRating,
  delivery: perfRating,
  collaboration: perfRating,
  ownership: perfRating,
  growth: perfRating,
});

export const perfKeyResultSchema = z.strictObject({
  id: z.uuid(),
  objectiveId: z.uuid(),
  title: z.string(),
  unit: perfUnitSchema,
  startValue: z.number(),
  targetValue: z.number(),
  // Always the latest progress update (the start value until one is recorded).
  currentValue: z.number(),
  // (current - start) / (target - start), clamped to 0..100.
  progress: z.number(),
  updateCount: z.number().int(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
  canRecordProgress: z.boolean(),
});
export type PerfKeyResult = z.infer<typeof perfKeyResultSchema>;
export const perfObjectiveSchema = z.strictObject({
  id: z.uuid(),
  ownerEmployeeId: z.uuid(),
  ownerName: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  parentObjectiveId: z.uuid().nullable(),
  // Null when the parent goal is not visible to the caller.
  parentTitle: z.string().nullable(),
  status: perfObjectiveStatusSchema,
  statusNote: z.string().nullable(),
  // Average of the key results' progress.
  progress: z.number(),
  keyResultCount: z.number().int(),
  mine: z.boolean(),
  version: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  // UI flags: what the caller may do now; the database decides again on every write.
  canEdit: z.boolean(),
  canActivate: z.boolean(),
  canComplete: z.boolean(),
  canCancel: z.boolean(),
  canAddKeyResult: z.boolean(),
});
export type PerfObjective = z.infer<typeof perfObjectiveSchema>;
export const perfObjectiveDetailSchema = z.strictObject({
  objective: perfObjectiveSchema,
  keyResults: z.array(perfKeyResultSchema),
  // Visible goals aligned to this one.
  children: z.array(
    z.strictObject({
      id: z.uuid(),
      title: z.string(),
      ownerName: z.string(),
      status: perfObjectiveStatusSchema,
      progress: z.number(),
    }),
  ),
});
export type PerfObjectiveDetail = z.infer<typeof perfObjectiveDetailSchema>;
export const perfObjectiveListSchema = z.strictObject({
  items: z.array(perfObjectiveSchema),
  ...perfPage,
  counts: z.record(perfObjectiveStatusSchema, z.number().int()),
});
export type PerfObjectiveList = z.infer<typeof perfObjectiveListSchema>;
export const perfObjectiveQuerySchema = z.strictObject({
  ...perfPaging,
  q: perfQ,
  status: perfObjectiveStatusSchema.optional(),
  ownerId: z.uuid().optional(),
  // mine: goals I own; team: my direct reports' goals; all: everything visible to me.
  view: z.enum(["mine", "team", "all"]).default("all"),
});
const perfObjectiveFields = {
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  parentObjectiveId: z.uuid().nullable().optional(),
};
export const perfObjectiveCreateSchema = z.strictObject({
  ...perfObjectiveFields,
  // Managers may set goals for direct reports, HR for anyone; defaults to the caller.
  ownerEmployeeId: z.uuid().nullable().optional(),
});
export const perfObjectiveUpdateSchema = z.strictObject({
  ...perfObjectiveFields,
  version: perfVersion,
});
export const perfObjectiveActionSchema = z.strictObject({
  version: perfVersion,
  note: perfNote.optional(),
});
export const perfObjectiveCancelSchema = z.strictObject({
  version: perfVersion,
  note: perfNote,
});
export const perfAlignableSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.uuid(),
      title: z.string(),
      ownerEmployeeId: z.uuid(),
      ownerName: z.string(),
      status: perfObjectiveStatusSchema,
    }),
  ),
});
export type PerfAlignable = z.infer<typeof perfAlignableSchema>;
export const perfAlignableQuerySchema = z.strictObject({
  ownerId: z.uuid().optional(),
});
const perfKeyResultFields = {
  title: z.string().trim().min(3).max(160),
  unit: perfUnitSchema,
  startValue: perfValue,
  targetValue: perfValue,
};
export const perfKeyResultCreateSchema = z.strictObject(perfKeyResultFields);
export const perfKeyResultUpdateSchema = z.strictObject({
  ...perfKeyResultFields,
  version: perfVersion,
});
export const perfProgressCreateSchema = z.strictObject({
  // The key result's current version (optimistic concurrency).
  version: perfVersion,
  value: perfValue,
  note: z.string().trim().min(1).max(500).nullable().optional(),
});
export const perfProgressSchema = z.strictObject({
  id: z.uuid(),
  keyResultId: z.uuid(),
  value: z.number(),
  previousValue: z.number(),
  note: z.string().nullable(),
  by: z.string(),
  at: z.string(),
});
export const perfProgressListSchema = z.strictObject({
  items: z.array(perfProgressSchema),
  ...perfPage,
});
export type PerfProgressList = z.infer<typeof perfProgressListSchema>;
export const perfProgressQuerySchema = z.strictObject({ ...perfPaging });

export const perfCycleSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  selfDue: z.string(),
  managerDue: z.string(),
  // Null: everyone in the entity with a manager.
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  status: perfCycleStatusSchema,
  statusNote: z.string().nullable(),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  // Counts of the reviews visible to the caller in this cycle.
  reviewCounts: z.record(perfReviewStatusSchema, z.number().int()),
  version: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
  canOpen: z.boolean(),
  canClose: z.boolean(),
  canCancel: z.boolean(),
});
export type PerfCycle = z.infer<typeof perfCycleSchema>;
export const perfCycleListSchema = z.strictObject({
  items: z.array(perfCycleSchema),
  ...perfPage,
  counts: z.record(perfCycleStatusSchema, z.number().int()),
  canCreate: z.boolean(),
});
export type PerfCycleList = z.infer<typeof perfCycleListSchema>;
export const perfCycleQuerySchema = z.strictObject({
  ...perfPaging,
  q: perfQ,
  status: perfCycleStatusSchema.optional(),
});
const perfCycleFields = {
  name: z.string().trim().min(3).max(80),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  selfDue: z.iso.date(),
  managerDue: z.iso.date(),
  departmentId: z.uuid().nullable().optional(),
};
export const perfCycleCreateSchema = z.strictObject(perfCycleFields);
export const perfCycleUpdateSchema = z.strictObject({
  ...perfCycleFields,
  version: perfVersion,
});
export const perfCycleActionSchema = z.strictObject({
  version: perfVersion,
  note: perfNote.optional(),
});
export const perfCycleOpenedSchema = z.strictObject({
  cycle: perfCycleSchema,
  // Reviews generated, and people in scope skipped because they have no current manager.
  generated: z.number().int(),
  skippedNoManager: z.number().int(),
});
export type PerfCycleOpened = z.infer<typeof perfCycleOpenedSchema>;

export const perfReviewEntrySchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["self", "manager"]),
  authorEmployeeId: z.uuid(),
  authorName: z.string(),
  ratings: perfRatingsSchema,
  // Plain average of the five ratings; not a computed score of the person.
  overall: z.number(),
  comment: z.string().nullable(),
  submittedAt: z.string(),
});
export type PerfReviewEntry = z.infer<typeof perfReviewEntrySchema>;
export const perfReviewSchema = z.strictObject({
  id: z.uuid(),
  cycleId: z.uuid(),
  cycleName: z.string(),
  cycleStatus: perfCycleStatusSchema,
  selfDue: z.string(),
  managerDue: z.string(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  managerId: z.uuid(),
  managerName: z.string(),
  status: perfReviewStatusSchema,
  selfSubmittedAt: z.string().nullable(),
  managerSubmittedAt: z.string().nullable(),
  finalRating: z.number().int().nullable(),
  finalReason: z.string().nullable(),
  finalisedBy: z.string().nullable(),
  finalisedAt: z.string().nullable(),
  mine: z.boolean(),
  iAmManager: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
  canSubmitSelf: z.boolean(),
  canSubmitManager: z.boolean(),
  canFinalise: z.boolean(),
});
export type PerfReview = z.infer<typeof perfReviewSchema>;
export const perfReviewDetailSchema = z.strictObject({
  review: perfReviewSchema,
  // Only the entries the caller may see (blind rules apply).
  entries: z.array(perfReviewEntrySchema),
  // True while the caller is the manager and has not submitted: the self-review stays hidden.
  blind: z.boolean(),
});
export type PerfReviewDetail = z.infer<typeof perfReviewDetailSchema>;
export const perfReviewListSchema = z.strictObject({
  items: z.array(perfReviewSchema),
  ...perfPage,
  counts: z.record(perfReviewStatusSchema, z.number().int()),
});
export type PerfReviewList = z.infer<typeof perfReviewListSchema>;
export const perfReviewQuerySchema = z.strictObject({
  ...perfPaging,
  q: perfQ,
  status: perfReviewStatusSchema.optional(),
  cycleId: z.uuid().optional(),
  // mine: my own review; team: reviews I write as manager; all: everything visible to me.
  view: z.enum(["mine", "team", "all"]).default("all"),
});
export const perfReviewSubmitSchema = z.strictObject({
  version: perfVersion,
  ratings: perfRatingsSchema,
  comment: z.string().trim().min(1).max(2000).nullable().optional(),
});
export const perfReviewFinaliseSchema = z.strictObject({
  version: perfVersion,
  finalRating: perfRating,
  reason: z.string().trim().min(10).max(500),
});

export * from "./helpdesk";
export * from "./engage";
export * from "./learn";
export * from "./shift";
