import { z } from "zod";

// ---- Recognition and engagement (ENG-01) ----
// Recognition: thank a colleague in your entity (never yourself) for a company value with a
// message of up to 280 characters; at most 10 given per person per UTC day; one reaction per
// person per post from a fixed set of codes (no emoji). HR hides or restores posts with a reason.
// No cash value, points or redemption.
// Pulse surveys: answers are stored apart from who answered and are never linked to a person.
// HR sees aggregates only, released once the survey has closed and at least 5 people answered.
// No sentiment analysis, AI, benchmarks or notifications.
// Lists are paginated: page (default 1), limit (default 25, max 100) and return { items, total, page, limit }.
const engVersion = z.number().int().positive();
const engPaging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const engPage = {
  total: z.number().int(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
};
const engText = (min: number, max: number) =>
  z.string().trim().min(min).max(max);
export const ENG_DAILY_KUDOS_LIMIT = 10;
export const ENG_RESULTS_THRESHOLD = 5;
export const engReactionCodeSchema = z.enum([
  "thanks",
  "applause",
  "inspiring",
  "helpful",
  "celebrate",
]);
export type EngReactionCode = z.infer<typeof engReactionCodeSchema>;
export const engFeedViewSchema = z.enum([
  "feed",
  "received",
  "given",
  "hidden",
]);
export const engSurveyStatusSchema = z.enum(["draft", "published", "closed"]);
export const engQuestionKindSchema = z.enum(["rating", "choice", "text"]);

// ---- Values ----
export const engValueSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  sort: z.number().int(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type EngValue = z.infer<typeof engValueSchema>;
export const engValueListSchema = z.strictObject({
  items: z.array(engValueSchema),
  canManage: z.boolean(),
});
export type EngValueList = z.infer<typeof engValueListSchema>;
export const engValueCreateSchema = z.strictObject({
  name: engText(2, 40),
  sort: z.number().int().min(0).max(1000).default(100),
});
export const engValueUpdateSchema = z.strictObject({
  name: engText(2, 40),
  active: z.boolean(),
  sort: z.number().int().min(0).max(1000),
  version: engVersion,
});

// ---- Colleagues (recipient picker; names only) ----
export const engColleagueQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
});
export const engColleagueListSchema = z.strictObject({
  items: z.array(z.strictObject({ employeeId: z.uuid(), name: z.string() })),
});
export type EngColleagueList = z.infer<typeof engColleagueListSchema>;

// ---- Recognition posts ----
export const engKudosSchema = z.strictObject({
  id: z.uuid(),
  giverEmployeeId: z.uuid(),
  giverName: z.string(),
  recipientEmployeeId: z.uuid(),
  recipientName: z.string(),
  valueId: z.uuid(),
  valueName: z.string(),
  message: z.string(),
  // UTC date the post was given (the daily cap counts UTC days).
  givenOn: z.string(),
  createdAt: z.string(),
  // Only HR ever receives hidden posts.
  hidden: z.boolean(),
  hiddenAt: z.string().nullable(),
  reactions: z.record(engReactionCodeSchema, z.number().int()),
  myReaction: engReactionCodeSchema.nullable(),
  givenByMe: z.boolean(),
  toMe: z.boolean(),
  canReact: z.boolean(),
  canModerate: z.boolean(),
  version: z.number().int(),
});
export type EngKudos = z.infer<typeof engKudosSchema>;
export const engModerationSchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(["hide", "restore"]),
  reason: z.string(),
  byLabel: z.string(),
  at: z.string(),
});
export const engKudosDetailSchema = z.strictObject({
  kudos: engKudosSchema,
  // HR only; empty for everyone else.
  moderation: z.array(engModerationSchema),
});
export type EngKudosDetail = z.infer<typeof engKudosDetailSchema>;
export const engKudosListSchema = z.strictObject({
  items: z.array(engKudosSchema),
  ...engPage,
  view: engFeedViewSchema,
  givenToday: z.number().int(),
  dailyLimit: z.number().int(),
  canModerate: z.boolean(),
});
export type EngKudosList = z.infer<typeof engKudosListSchema>;
export const engKudosQuerySchema = z.strictObject({
  ...engPaging,
  view: engFeedViewSchema.default("feed"),
  valueId: z.uuid().optional(),
});
export const engKudosCreateSchema = z.strictObject({
  recipientEmployeeId: z.uuid(),
  valueId: z.uuid(),
  message: engText(1, 280),
});
export const engReactionSetSchema = z.strictObject({
  code: engReactionCodeSchema,
});
export const engModerateSchema = z.strictObject({
  version: engVersion,
  reason: engText(3, 500),
});

// ---- Pulse surveys ----
export const engQuestionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rating"), prompt: engText(3, 200) }),
  z.strictObject({
    kind: z.literal("choice"),
    prompt: engText(3, 200),
    options: z
      .array(engText(1, 80))
      .min(2)
      .max(8)
      .refine(
        (o) => new Set(o.map((x) => x.toLowerCase())).size === o.length,
        "Options must be different from each other",
      ),
  }),
  z.strictObject({ kind: z.literal("text"), prompt: engText(3, 200) }),
]);
const engSurveyFields = {
  title: engText(3, 120),
  opensAt: z.iso.datetime({ offset: true }),
  closesAt: z.iso.datetime({ offset: true }),
  questions: z.array(engQuestionInputSchema).min(1).max(12),
};
const engWindow = (v: { opensAt: string; closesAt: string }) =>
  Date.parse(v.closesAt) > Date.parse(v.opensAt) &&
  Date.parse(v.closesAt) - Date.parse(v.opensAt) <= 92 * 24 * 3600 * 1000;
const engWindowMessage = {
  message: "Close the survey after it opens and within 92 days",
  path: ["closesAt"],
};
export const engSurveyCreateSchema = z
  .strictObject(engSurveyFields)
  .refine(engWindow, engWindowMessage);
export const engSurveyUpdateSchema = z
  .strictObject({ ...engSurveyFields, version: engVersion })
  .refine(engWindow, engWindowMessage);
export const engSurveyActionSchema = z.strictObject({ version: engVersion });
export const engQuestionSchema = z.strictObject({
  id: z.uuid(),
  position: z.number().int(),
  kind: engQuestionKindSchema,
  prompt: z.string(),
  options: z.array(z.string()),
  // Rating and choice questions must be answered; text is optional.
  required: z.boolean(),
});
export const engSurveySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  opensAt: z.string(),
  closesAt: z.string(),
  status: engSurveyStatusSchema,
  // Published and inside its window.
  acceptingAnswers: z.boolean(),
  publishedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  questionCount: z.number().int(),
  // Whether the caller has answered (from their own participation row only).
  responded: z.boolean(),
  canRespond: z.boolean(),
  // HR only (null for everyone else): counts, never who answered.
  responseCount: z.number().int().nullable(),
  eligibleCount: z.number().int().nullable(),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
  canClose: z.boolean(),
  version: z.number().int(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type EngSurvey = z.infer<typeof engSurveySchema>;
export const engSurveyDetailSchema = z.strictObject({
  survey: engSurveySchema,
  questions: z.array(engQuestionSchema),
});
export type EngSurveyDetail = z.infer<typeof engSurveyDetailSchema>;
export const engSurveyListSchema = z.strictObject({
  items: z.array(engSurveySchema),
  ...engPage,
  counts: z.record(engSurveyStatusSchema, z.number().int()),
  canManage: z.boolean(),
});
export type EngSurveyList = z.infer<typeof engSurveyListSchema>;
export const engSurveyQuerySchema = z.strictObject({
  ...engPaging,
  status: engSurveyStatusSchema.optional(),
});
export const engAnswerSchema = z.strictObject({
  questionId: z.uuid(),
  rating: z.number().int().min(1).max(5).optional(),
  choice: z.number().int().min(0).max(7).optional(),
  text: z.string().trim().max(500).optional(),
});
export const engResponseCreateSchema = z.strictObject({
  answers: z.array(engAnswerSchema).max(12),
});
export const engResponseResultSchema = z.strictObject({
  responded: z.literal(true),
});
export const engResultQuestionSchema = z.strictObject({
  questionId: z.uuid(),
  position: z.number().int(),
  kind: engQuestionKindSchema,
  prompt: z.string(),
  answered: z.number().int(),
  // rating: count per score 1..5 (index 0 is score 1); choice: count per option.
  counts: z.array(z.number().int()).optional(),
  average: z.number().nullable().optional(),
  options: z.array(z.string()).optional(),
  // text: answers in random order, never submission order.
  texts: z.array(z.string()).optional(),
});
export const engSurveyResultsSchema = z.strictObject({
  surveyId: z.uuid(),
  responses: z.number().int(),
  eligible: z.number().int(),
  threshold: z.number().int(),
  released: z.boolean(),
  // Why results are withheld: still a draft, still open, or fewer than 5 answers.
  withheld: z.enum(["draft", "open", "too_few_responses"]).nullable(),
  questions: z.array(engResultQuestionSchema),
});
export type EngSurveyResults = z.infer<typeof engSurveyResultsSchema>;
