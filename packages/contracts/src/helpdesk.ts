import { z } from "zod";

// ---- HR helpdesk (HLP-01) ----
// Employees raise cases for themselves; HR agents work them. Visibility: the requester sees their
// own cases (managers do not see their team's); agents see the entity's cases; a confidential case
// only its requester, its assigned agent and helpdesk.manage. Internal notes never reach the
// requester. Service targets are wall-clock hours (no business hours, no pause); breach is derived
// when read. Article suggestions are plain keyword matches, not AI. Every list is paginated: page
// (default 1), limit (default 25, max 100), and returns { items, total, page, limit, counts }.
const hdVersion = z.number().int().positive();
const hdPaging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const hdPage = {
  total: z.number().int(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
};
const hdQ = z.string().trim().max(80).default("");
const hdText = (min: number, max: number) =>
  z.string().trim().min(min).max(max);
export const hdPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const hdCaseStatusSchema = z.enum([
  "open",
  "in_progress",
  "waiting_on_employee",
  "resolved",
  "closed",
  "cancelled",
]);
export const hdArticleStatusSchema = z.enum(["draft", "published", "archived"]);
export const hdCommentKindSchema = z.enum(["comment", "internal"]);

export const hdCategorySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  // Cases in a confidential category are confidential.
  confidential: z.boolean(),
  active: z.boolean(),
  sort: z.number().int(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type HdCategory = z.infer<typeof hdCategorySchema>;
export const hdCategoryListSchema = z.strictObject({
  items: z.array(hdCategorySchema),
  canManage: z.boolean(),
});
export type HdCategoryList = z.infer<typeof hdCategoryListSchema>;
export const hdCategoryCreateSchema = z.strictObject({
  name: hdText(2, 60),
  confidential: z.boolean().default(false),
  sort: z.number().int().min(0).max(1000).default(100),
});
export const hdCategoryUpdateSchema = z.strictObject({
  name: hdText(2, 60),
  confidential: z.boolean(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(1000),
  version: hdVersion,
});

export const hdSlaTargetSchema = z.strictObject({
  priority: hdPrioritySchema,
  responseHours: z.number().int(),
  resolveHours: z.number().int(),
  // 0 while the built-in default applies (no target saved for this entity yet).
  version: z.number().int(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export const hdSlaListSchema = z.strictObject({
  items: z.array(hdSlaTargetSchema),
  canManage: z.boolean(),
  // Targets are wall-clock hours: no business hours, holidays or pause.
  basis: z.literal("wall_clock_hours"),
});
export type HdSlaList = z.infer<typeof hdSlaListSchema>;
export const hdSlaUpdateSchema = z
  .strictObject({
    responseHours: z.number().int().min(1).max(720),
    resolveHours: z.number().int().min(1).max(2160),
    // 0 when saving a target for the first time.
    version: z.number().int().min(0),
  })
  .refine((v) => v.resolveHours >= v.responseHours, {
    message: "The resolution target is at least the response target",
    path: ["resolveHours"],
  });

export const hdArticleSchema = z.strictObject({
  id: z.uuid(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  keywords: z.array(z.string()),
  status: hdArticleStatusSchema,
  publishedAt: z.string().nullable(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
});
export type HdArticle = z.infer<typeof hdArticleSchema>;
export const hdArticleListSchema = z.strictObject({
  items: z.array(hdArticleSchema),
  ...hdPage,
  counts: z.record(hdArticleStatusSchema, z.number().int()),
  canManage: z.boolean(),
});
export type HdArticleList = z.infer<typeof hdArticleListSchema>;
export const hdArticleQuerySchema = z.strictObject({
  ...hdPaging,
  q: hdQ,
  status: hdArticleStatusSchema.optional(),
  categoryId: z.uuid().optional(),
});
const hdArticleFields = {
  categoryId: z.uuid().nullable().optional(),
  title: hdText(3, 160),
  body: hdText(10, 8000),
  keywords: z.array(hdText(2, 40)).max(20).default([]),
};
export const hdArticleCreateSchema = z.strictObject(hdArticleFields);
export const hdArticleUpdateSchema = z.strictObject({
  ...hdArticleFields,
  version: hdVersion,
});
export const hdArticleActionSchema = z.strictObject({ version: hdVersion });
export const hdSuggestQuerySchema = z.strictObject({
  categoryId: z.uuid().optional(),
  q: z.string().trim().max(160).default(""),
});
export const hdSuggestionListSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.uuid(),
      title: z.string(),
      categoryName: z.string().nullable(),
      // How many words of the text matched the article's keywords or title words.
      matchedWords: z.number().int(),
    }),
  ),
  // Suggestions are rule-based keyword matches, never AI output.
  method: z.literal("keyword_match"),
});
export type HdSuggestionList = z.infer<typeof hdSuggestionListSchema>;

export const hdCaseSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  requesterEmployeeId: z.uuid(),
  requesterName: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  subject: z.string(),
  description: z.string(),
  priority: hdPrioritySchema,
  confidential: z.boolean(),
  status: hdCaseStatusSchema,
  assigneeEmployeeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  firstResponseDue: z.string(),
  resolveDue: z.string(),
  firstRespondedAt: z.string().nullable(),
  // Derived on read: the first agent reply (or the resolution) came, or has not yet come, after the due time.
  responseBreached: z.boolean(),
  resolveBreached: z.boolean(),
  breached: z.boolean(),
  lastActivityAt: z.string(),
  statusChangedAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  // The requester may reopen until this time (7 days after resolution).
  reopenUntil: z.string().nullable(),
  closedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  reopenCount: z.number().int(),
  satisfaction: z.number().int().nullable(),
  mine: z.boolean(),
  assignedToMe: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canComment: z.boolean(),
  canAddInternalNote: z.boolean(),
  canAssign: z.boolean(),
  canTake: z.boolean(),
  canStart: z.boolean(),
  canWait: z.boolean(),
  canResume: z.boolean(),
  canResolve: z.boolean(),
  canReopen: z.boolean(),
  canClose: z.boolean(),
  canCancel: z.boolean(),
  canChangePriority: z.boolean(),
  canChangeConfidential: z.boolean(),
  canLinkArticle: z.boolean(),
});
export type HdCase = z.infer<typeof hdCaseSchema>;
export const hdCommentSchema = z.strictObject({
  id: z.uuid(),
  // internal: visible only to HR agents, never to the requester.
  kind: hdCommentKindSchema,
  body: z.string(),
  authorRole: z.enum(["requester", "agent"]),
  authorLabel: z.string(),
  mine: z.boolean(),
  at: z.string(),
});
export const hdHistorySchema = z.strictObject({
  id: z.uuid(),
  fromStatus: hdCaseStatusSchema.nullable(),
  toStatus: hdCaseStatusSchema,
  assigneeName: z.string().nullable(),
  assigneeChanged: z.boolean(),
  priority: hdPrioritySchema,
  priorityChanged: z.boolean(),
  confidential: z.boolean(),
  confidentialChanged: z.boolean(),
  byLabel: z.string(),
  at: z.string(),
});
export const hdLinkedArticleSchema = z.strictObject({
  articleId: z.uuid(),
  // Null when the article is no longer published and the caller cannot see unpublished ones.
  title: z.string().nullable(),
  linkedBy: z.string(),
  at: z.string(),
});
export const hdCaseDetailSchema = z.strictObject({
  case: hdCaseSchema,
  comments: z.array(hdCommentSchema),
  history: z.array(hdHistorySchema),
  articles: z.array(hdLinkedArticleSchema),
});
export type HdCaseDetail = z.infer<typeof hdCaseDetailSchema>;
export const hdCaseListSchema = z.strictObject({
  items: z.array(hdCaseSchema),
  ...hdPage,
  counts: z.record(hdCaseStatusSchema, z.number().int()),
  // True when the caller works the queue (helpdesk.agent or helpdesk.manage).
  canWork: z.boolean(),
});
export type HdCaseList = z.infer<typeof hdCaseListSchema>;
export const hdCaseQuerySchema = z.strictObject({
  ...hdPaging,
  q: hdQ,
  status: hdCaseStatusSchema.optional(),
  priority: hdPrioritySchema.optional(),
  categoryId: z.uuid().optional(),
  breached: z.enum(["true", "false"]).optional(),
  // mine: cases I raised; assigned: assigned to me; unassigned: the unassigned queue; all: everything visible.
  view: z.enum(["mine", "assigned", "unassigned", "all"]).default("all"),
});
export const hdCaseCreateSchema = z.strictObject({
  categoryId: z.uuid(),
  subject: hdText(3, 160),
  description: hdText(10, 4000),
  priority: hdPrioritySchema.default("normal"),
  confidential: z.boolean().default(false),
});
export const hdCommentCreateSchema = z.strictObject({
  kind: hdCommentKindSchema.default("comment"),
  body: hdText(1, 4000),
});
export const hdAssignSchema = z.strictObject({
  version: hdVersion,
  assigneeEmployeeId: z.uuid(),
});
export const hdPrioritySetSchema = z.strictObject({
  version: hdVersion,
  priority: hdPrioritySchema,
});
export const hdConfidentialSetSchema = z.strictObject({
  version: hdVersion,
  confidential: z.boolean(),
});
// start, wait, resume, resolve, reopen, cancel. A note is added to the thread as a public comment.
export const hdCaseActionSchema = z.strictObject({
  version: hdVersion,
  note: hdText(1, 4000).optional(),
});
export const hdCaseCloseSchema = z.strictObject({
  version: hdVersion,
  // Only the requester rates, and only when closing.
  satisfaction: z.number().int().min(1).max(5).optional(),
});
export const hdArticleLinkSchema = z.strictObject({ articleId: z.uuid() });
export const hdAgentListSchema = z.strictObject({
  items: z.array(z.strictObject({ employeeId: z.uuid(), name: z.string() })),
});
export type HdAgentList = z.infer<typeof hdAgentListSchema>;
