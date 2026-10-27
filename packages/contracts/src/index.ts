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
export {
  activationReadiness,
  onboardingStarter,
  submissionChanges,
} from "./onboarding";
