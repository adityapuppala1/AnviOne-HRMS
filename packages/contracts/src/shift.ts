import { z } from "zod";

// ---- Shifts and rosters (SHF-01) ----
// Shift templates (HR), shifts per person and date (HR for anyone, managers for direct reports),
// entity-wide published roster weeks (HR), swaps with an approver who is neither person, open
// shifts that people claim, and derived planned hours. Conflicts (overlap, minimum rest, approved
// leave) are refused by the database. No payroll or overtime, no automatic scheduling, no AI, and
// attendance is shown next to a shift by date only (never matched).
// Times are local wall-clock times in the entity's time zone: "HH:MM" and "YYYY-MM-DDTHH:MM".
// Lists are paginated: page (default 1), limit (default 25, max 100) and return { items, total, page, limit }.
const shfVersion = z.number().int().positive();
const shfPaging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const shfPage = {
  total: z.number().int(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
};
const shfReason = z.string().trim().min(3).max(300);
const shfDate = z.iso.date();
const shfTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time");
export const SHF_DEFAULT_MIN_REST_HOURS = 11;
export const SHF_MAX_RANGE_DAYS = 62;
export const shfColourSchema = z.enum([
  "teal",
  "indigo",
  "amber",
  "rose",
  "slate",
  "green",
  "violet",
  "sky",
]);
export const shfAssignmentStatusSchema = z.enum(["active", "cancelled"]);
export const shfSourceSchema = z.enum(["assigned", "swap", "open_shift"]);
export const shfSwapStatusSchema = z.enum([
  "proposed",
  "accepted",
  "declined",
  "cancelled",
  "approved",
  "rejected",
]);
export const shfOpenStatusSchema = z.enum(["open", "filled", "withdrawn"]);
export const shfClaimStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "not_selected",
]);
export const shfChangeKindSchema = z.enum([
  "assigned",
  "claimed",
  "cancelled",
  "swapped_in",
  "swapped_out",
]);
export const shfVersionSchema = z.strictObject({ version: shfVersion });
export const shfReasonSchema = z.strictObject({
  version: shfVersion,
  reason: shfReason,
});
// Cancel: a reason is required when the week is published.
export const shfCancelSchema = z.strictObject({
  version: shfVersion,
  reason: shfReason.optional(),
});

// ---- Settings ----
export const shfSettingsSchema = z.strictObject({
  minRestHours: z.number().int(),
  // 0 until HR first saves the settings (the default applies).
  version: z.number().int(),
  canManage: z.boolean(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type ShfSettings = z.infer<typeof shfSettingsSchema>;
export const shfSettingsUpdateSchema = z.strictObject({
  minRestHours: z.number().int().min(0).max(24),
  // 0 when saving for the first time.
  version: z.number().int().min(0),
});

// ---- Templates ----
const shfTemplateFields = {
  name: z.string().trim().min(2).max(60),
  startTime: shfTime,
  endTime: shfTime,
  breakMinutes: z.number().int().min(0).max(180),
  colour: shfColourSchema,
};
export const shfTemplateCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,11}$/, "Use 2 to 12 letters, digits or -"),
  ...shfTemplateFields,
});
export const shfTemplateUpdateSchema = z.strictObject({
  ...shfTemplateFields,
  active: z.boolean(),
  version: shfVersion,
});
export const shfTemplateSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  // Derived: the end is at or before the start.
  crossesMidnight: z.boolean(),
  breakMinutes: z.number().int(),
  // Shift length minus the unpaid break.
  paidMinutes: z.number().int(),
  colour: shfColourSchema,
  active: z.boolean(),
  canEdit: z.boolean(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type ShfTemplate = z.infer<typeof shfTemplateSchema>;
export const shfTemplateListSchema = z.strictObject({
  items: z.array(shfTemplateSchema),
  ...shfPage,
  canManage: z.boolean(),
});
export type ShfTemplateList = z.infer<typeof shfTemplateListSchema>;
const shfFlag = z.enum(["true", "false"]).transform((v) => v === "true");
export const shfTemplateQuerySchema = z.strictObject({
  ...shfPaging,
  q: z.string().trim().max(60).default(""),
  active: shfFlag.optional(),
});

// ---- Roster (shifts) ----
export const shfAssignSchema = z
  .strictObject({
    employeeId: z.uuid(),
    templateId: z.uuid(),
    from: shfDate,
    // Defaults to from (a single date). Up to 62 days.
    to: shfDate.optional(),
    // ISO weekdays to include (1 = Monday ... 7 = Sunday); all when omitted.
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    // Required when any date falls in a published week.
    reason: shfReason.optional(),
  })
  .refine((v) => !v.to || v.to >= v.from, {
    message: "The end date is before the start date",
    path: ["to"],
  });
export const shfAssignResultSchema = z.strictObject({
  // Set when more than one shift was created.
  batchId: z.uuid().nullable(),
  created: z.number().int(),
  assignmentIds: z.array(z.uuid()),
});
export type ShfAssignResult = z.infer<typeof shfAssignResultSchema>;
export const shfAssignmentSchema = z.strictObject({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  templateId: z.uuid(),
  templateCode: z.string(),
  templateName: z.string(),
  colour: shfColourSchema,
  workDate: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  crossesMidnight: z.boolean(),
  breakMinutes: z.number().int(),
  plannedMinutes: z.number().int(),
  status: shfAssignmentStatusSchema,
  source: shfSourceSchema,
  batchId: z.uuid().nullable(),
  // Whether the week is published.
  published: z.boolean(),
  // Changed (assigned, cancelled, swapped or filled) after the week was published.
  afterPublish: z.boolean(),
  // Derived: approved leave covers this date (leave approved after planning is not blocked).
  onLeave: z.boolean(),
  // Read-only attendance for this person and date, when the caller can see it. Never compared.
  attendanceCheckIn: z.string().nullable(),
  attendanceCheckOut: z.string().nullable(),
  mine: z.boolean(),
  canCancel: z.boolean(),
  // Whether the caller may propose swapping this shift.
  canSwap: z.boolean(),
  assignedBy: z.string(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  version: z.number().int(),
});
export type ShfAssignment = z.infer<typeof shfAssignmentSchema>;
export const shfChangeSchema = z.strictObject({
  id: z.uuid(),
  kind: shfChangeKindSchema,
  employeeId: z.uuid(),
  afterPublish: z.boolean(),
  // The reason given for a change in a published week.
  reason: z.string().nullable(),
  swapId: z.uuid().nullable(),
  byLabel: z.string(),
  at: z.string(),
});
export const shfAssignmentDetailSchema = z.strictObject({
  assignment: shfAssignmentSchema,
  history: z.array(shfChangeSchema),
});
export type ShfAssignmentDetail = z.infer<typeof shfAssignmentDetailSchema>;
export const shfViewSchema = z.enum(["mine", "team", "all"]);
export const shfRosterSchema = z.strictObject({
  items: z.array(shfAssignmentSchema),
  ...shfPage,
  view: shfViewSchema,
  from: z.string(),
  to: z.string(),
  canPlan: z.boolean(),
  canPublish: z.boolean(),
});
export type ShfRoster = z.infer<typeof shfRosterSchema>;
export const shfRosterQuerySchema = z
  .strictObject({
    ...shfPaging,
    view: shfViewSchema.default("mine"),
    // Defaults to the current week (Monday to Sunday). Up to 62 days.
    from: shfDate.optional(),
    to: shfDate.optional(),
    employeeId: z.uuid().optional(),
    status: shfAssignmentStatusSchema.default("active"),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: "The end date is before the start date",
    path: ["to"],
  });

// ---- Weeks ----
export const shfWeekSchema = z.strictObject({
  weekStart: z.string(),
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
  canPublish: z.boolean(),
});
export type ShfWeek = z.infer<typeof shfWeekSchema>;
export const shfWeekListSchema = z.strictObject({
  items: z.array(shfWeekSchema),
  ...shfPage,
});
export type ShfWeekList = z.infer<typeof shfWeekListSchema>;
export const shfWeekQuerySchema = z.strictObject({ ...shfPaging });
export const shfWeekStartSchema = shfDate;

// ---- Planned hours (derived) ----
export const shfHoursRowSchema = z.strictObject({
  employeeId: z.uuid(),
  employeeName: z.string(),
  shifts: z.number().int(),
  plannedMinutes: z.number().int(),
  breakMinutes: z.number().int(),
});
export const shfHoursSchema = z.strictObject({
  items: z.array(shfHoursRowSchema),
  ...shfPage,
  weekStart: z.string(),
  view: shfViewSchema,
});
export type ShfHours = z.infer<typeof shfHoursSchema>;
export const shfHoursQuerySchema = z.strictObject({
  ...shfPaging,
  // A Monday; defaults to the current week.
  weekStart: shfDate.optional(),
  view: shfViewSchema.default("mine"),
});

// ---- Swaps ----
export const shfSwapCreateSchema = z.strictObject({
  // One of my own upcoming shifts in a published week.
  assignmentId: z.uuid(),
  // The colleague whose shift on the same date I take in exchange.
  colleagueId: z.uuid(),
});
const shfSwapSide = z.strictObject({
  employeeId: z.uuid(),
  employeeName: z.string(),
  assignmentId: z.uuid(),
  templateCode: z.string(),
  templateName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});
export const shfSwapSchema = z.strictObject({
  id: z.uuid(),
  workDate: z.string(),
  requester: shfSwapSide,
  colleague: shfSwapSide,
  status: shfSwapStatusSchema,
  // Derived: still undecided after its date.
  expired: z.boolean(),
  // The approver's reason for a rejection (only the people in the swap and approvers see it).
  decisionReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  canAccept: z.boolean(),
  canDecline: z.boolean(),
  canCancel: z.boolean(),
  canApprove: z.boolean(),
  canReject: z.boolean(),
  version: z.number().int(),
});
export type ShfSwap = z.infer<typeof shfSwapSchema>;
export const shfSwapViewSchema = z.enum(["mine", "approvals"]);
export const shfSwapListSchema = z.strictObject({
  items: z.array(shfSwapSchema),
  ...shfPage,
  view: shfSwapViewSchema,
});
export type ShfSwapList = z.infer<typeof shfSwapListSchema>;
export const shfSwapQuerySchema = z.strictObject({
  ...shfPaging,
  view: shfSwapViewSchema.default("mine"),
  status: shfSwapStatusSchema.optional(),
});
export const shfDecisionSchema = z.strictObject({
  version: shfVersion,
  // Required to reject.
  reason: shfReason.optional(),
});

// ---- Open shifts and claims ----
export const shfOpenCreateSchema = z.strictObject({
  templateId: z.uuid(),
  workDate: shfDate,
});
export const shfOpenShiftSchema = z.strictObject({
  id: z.uuid(),
  templateId: z.uuid(),
  templateCode: z.string(),
  templateName: z.string(),
  colour: shfColourSchema,
  workDate: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  breakMinutes: z.number().int(),
  plannedMinutes: z.number().int(),
  // entity: posted by HR, anyone may claim; team: posted by a manager for their direct reports.
  audience: z.enum(["entity", "team"]),
  status: shfOpenStatusSchema,
  postedBy: z.string(),
  // The caller's own claim, if any.
  myClaimId: z.uuid().nullable(),
  myClaimStatus: shfClaimStatusSchema.nullable(),
  pendingClaims: z.number().int(),
  canClaim: z.boolean(),
  canWithdraw: z.boolean(),
  canDecide: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type ShfOpenShift = z.infer<typeof shfOpenShiftSchema>;
export const shfClaimSchema = z.strictObject({
  id: z.uuid(),
  openShiftId: z.uuid(),
  workDate: z.string(),
  templateCode: z.string(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  status: shfClaimStatusSchema,
  decisionReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  mine: z.boolean(),
  canWithdraw: z.boolean(),
  canApprove: z.boolean(),
  canReject: z.boolean(),
  version: z.number().int(),
});
export type ShfClaim = z.infer<typeof shfClaimSchema>;
export const shfOpenShiftDetailSchema = z.strictObject({
  openShift: shfOpenShiftSchema,
  // Claims the caller may see: their own, or every claim for HR and the posting manager.
  claims: z.array(shfClaimSchema),
});
export type ShfOpenShiftDetail = z.infer<typeof shfOpenShiftDetailSchema>;
export const shfOpenListSchema = z.strictObject({
  items: z.array(shfOpenShiftSchema),
  ...shfPage,
  canPost: z.boolean(),
});
export type ShfOpenList = z.infer<typeof shfOpenListSchema>;
export const shfOpenQuerySchema = z.strictObject({
  ...shfPaging,
  status: shfOpenStatusSchema.optional(),
  from: shfDate.optional(),
  to: shfDate.optional(),
});
export const shfClaimListSchema = z.strictObject({
  items: z.array(shfClaimSchema),
  ...shfPage,
  view: shfSwapViewSchema,
});
export type ShfClaimList = z.infer<typeof shfClaimListSchema>;
export const shfClaimQuerySchema = z.strictObject({
  ...shfPaging,
  view: shfSwapViewSchema.default("mine"),
  status: shfClaimStatusSchema.optional(),
});
