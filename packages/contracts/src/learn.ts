import { z } from "zod";

// ---- Learning (LRN-01) ----
// Course catalogue (HR-managed), assignments to a person or a department/location audience
// (snapshotted at assign time), self-enrolment in published non-mandatory courses, and completion
// tracking with an append-only history. Overdue and renewal are derived. The completion record is
// the only "certificate": no file upload and no certificate generation. No content hosting, quizzes,
// notifications or AI.
// Lists are paginated: page (default 1), limit (default 25, max 100) and return { items, total, page, limit }.
const lrnVersion = z.number().int().positive();
const lrnPaging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const lrnPage = {
  total: z.number().int(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
};
const lrnText = (min: number, max: number) =>
  z.string().trim().min(min).max(max);
const lrnDate = z.iso.date();
export const LRN_RENEWAL_WINDOW_DAYS = 30;
export const lrnDeliveryModeSchema = z.enum([
  "online",
  "classroom",
  "self_study",
]);
export const lrnCourseStatusSchema = z.enum(["draft", "published", "archived"]);
export const lrnAssignmentStatusSchema = z.enum([
  "assigned",
  "in_progress",
  "completed",
  "waived",
]);
// current: valid; due: expires within 30 days; expired: past its expiry date.
export const lrnRenewalSchema = z.enum(["current", "due", "expired"]);
export const lrnAudienceSchema = z.enum([
  "employee",
  "department",
  "location",
  "self",
]);

// ---- Courses ----
const lrnCourseFields = {
  title: lrnText(3, 120),
  description: lrnText(0, 2000).default(""),
  category: lrnText(2, 60),
  deliveryMode: lrnDeliveryModeSchema,
  durationMinutes: z.number().int().min(1).max(10000),
  externalUrl: z
    .string()
    .trim()
    .max(500)
    // Same rule as lrn_url_ok (067): plain host, no userinfo, quotes, backslashes or control characters.
    .regex(
      /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::[0-9]{1,5})?(?:[/?#][\]A-Za-z0-9!#$%&()*+,./:;=?@[_~-]*)?$/,
      "Links must be https:// with a plain web address",
    )
    .nullable()
    .default(null),
  mandatory: z.boolean().default(false),
  validityMonths: z.number().int().min(1).max(120).nullable().default(null),
};
export const lrnCourseCreateSchema = z.strictObject(lrnCourseFields);
export const lrnCourseUpdateSchema = z.strictObject({
  ...lrnCourseFields,
  version: lrnVersion,
});
export const lrnVersionSchema = z.strictObject({ version: lrnVersion });
export const lrnCourseSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  deliveryMode: lrnDeliveryModeSchema,
  durationMinutes: z.number().int(),
  externalUrl: z.string().nullable(),
  status: lrnCourseStatusSchema,
  mandatory: z.boolean(),
  validityMonths: z.number().int().nullable(),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  // The caller's own open assignment for this course, if any.
  myOpenAssignmentId: z.uuid().nullable(),
  canEnrol: z.boolean(),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
  canArchive: z.boolean(),
  canAssign: z.boolean(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type LrnCourse = z.infer<typeof lrnCourseSchema>;
export const lrnCourseListSchema = z.strictObject({
  items: z.array(lrnCourseSchema),
  ...lrnPage,
  counts: z.record(lrnCourseStatusSchema, z.number().int()),
  canManage: z.boolean(),
});
export type LrnCourseList = z.infer<typeof lrnCourseListSchema>;
export const lrnCourseQuerySchema = z.strictObject({
  ...lrnPaging,
  q: z.string().trim().max(80).default(""),
  status: lrnCourseStatusSchema.optional(),
  category: z.string().trim().max(60).optional(),
});

// ---- Assignments ----
export const lrnAssignTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("employee"), employeeId: z.uuid() }),
  z.strictObject({ kind: z.literal("department"), unitId: z.uuid() }),
  z.strictObject({ kind: z.literal("location"), unitId: z.uuid() }),
]);
export const lrnAssignSchema = z.strictObject({
  target: lrnAssignTargetSchema,
  dueOn: lrnDate,
  // Defaults to the course's mandatory flag.
  mandatory: z.boolean().optional(),
});
export const lrnAssignResultSchema = z.strictObject({
  // Set for department and location audiences.
  batchId: z.uuid().nullable(),
  assigned: z.number().int(),
  // People in the audience who already had an open assignment for the course.
  skipped: z.number().int(),
  assignmentIds: z.array(z.uuid()),
});
export type LrnAssignResult = z.infer<typeof lrnAssignResultSchema>;
export const lrnCompleteSchema = z.strictObject({
  version: lrnVersion,
  note: lrnText(0, 280).optional(),
});
export const lrnReasonSchema = z.strictObject({
  version: lrnVersion,
  reason: lrnText(3, 500),
});
export const lrnAssignmentSchema = z.strictObject({
  id: z.uuid(),
  courseId: z.uuid(),
  courseCode: z.string(),
  courseTitle: z.string(),
  courseStatus: lrnCourseStatusSchema,
  employeeId: z.uuid(),
  employeeName: z.string(),
  source: z.enum(["assigned", "self_enrolled"]),
  audience: lrnAudienceSchema,
  batchId: z.uuid().nullable(),
  dueOn: z.string().nullable(),
  mandatory: z.boolean(),
  status: lrnAssignmentStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  waivedAt: z.string().nullable(),
  expiresOn: z.string().nullable(),
  // Derived: open and past its due date.
  overdue: z.boolean(),
  // Derived for completed assignments of courses with a validity; null otherwise.
  renewal: lrnRenewalSchema.nullable(),
  mine: z.boolean(),
  canStart: z.boolean(),
  canComplete: z.boolean(),
  // HR on behalf of someone else (never for their own assignment).
  canRecord: z.boolean(),
  canWaive: z.boolean(),
  assignedBy: z.string(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type LrnAssignment = z.infer<typeof lrnAssignmentSchema>;
export const lrnCompletionSchema = z.strictObject({
  id: z.uuid(),
  outcome: z.enum(["completed", "waived"]),
  recordedBy: z.enum(["self", "hr"]),
  // The learner's note, or HR's reason.
  note: z.string().nullable(),
  byLabel: z.string(),
  at: z.string(),
  expiresOn: z.string().nullable(),
});
export const lrnAssignmentDetailSchema = z.strictObject({
  assignment: lrnAssignmentSchema,
  history: z.array(lrnCompletionSchema),
});
export type LrnAssignmentDetail = z.infer<typeof lrnAssignmentDetailSchema>;
export const lrnAssignmentViewSchema = z.enum(["mine", "team", "all"]);
export const lrnAssignmentListSchema = z.strictObject({
  items: z.array(lrnAssignmentSchema),
  ...lrnPage,
  view: lrnAssignmentViewSchema,
  canManage: z.boolean(),
  canSeeTeam: z.boolean(),
});
export type LrnAssignmentList = z.infer<typeof lrnAssignmentListSchema>;
const lrnFlag = z.enum(["true", "false"]).transform((v) => v === "true");
export const lrnAssignmentQuerySchema = z.strictObject({
  ...lrnPaging,
  view: lrnAssignmentViewSchema.default("mine"),
  status: lrnAssignmentStatusSchema.optional(),
  courseId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  overdue: lrnFlag.optional(),
  renewal: lrnRenewalSchema.optional(),
});

// ---- Compliance report (HR; counts only) ----
export const lrnComplianceRowSchema = z.strictObject({
  courseId: z.uuid(),
  courseCode: z.string(),
  courseTitle: z.string(),
  courseStatus: lrnCourseStatusSchema,
  mandatory: z.boolean(),
  // Open and not past due, split by whether started.
  notStarted: z.number().int(),
  inProgress: z.number().int(),
  overdue: z.number().int(),
  completed: z.number().int(),
  waived: z.number().int(),
  dueForRenewal: z.number().int(),
  expired: z.number().int(),
});
export const lrnComplianceSchema = z.strictObject({
  items: z.array(lrnComplianceRowSchema),
  ...lrnPage,
  asOf: z.string(),
});
export type LrnCompliance = z.infer<typeof lrnComplianceSchema>;
export const lrnComplianceQuerySchema = z.strictObject({
  ...lrnPaging,
  status: lrnCourseStatusSchema.optional(),
});
