import type { CandidateDraft } from "./index";
export const onboardingStarter = [
  {
    label: "Share a fictional collaboration preference",
    owner: "candidate",
    required: true,
    dueOffsetDays: -2,
    prerequisite: null,
  },
  {
    label: "Record a fictional readiness check",
    owner: "hr",
    required: true,
    dueOffsetDays: -1,
    prerequisite: 0,
  },
  {
    label: "Prepare a fictional equipment plan",
    owner: "it",
    required: false,
    dueOffsetDays: 0,
    prerequisite: 1,
  },
  {
    label: "Plan the fictional induction",
    owner: "administration",
    required: true,
    dueOffsetDays: 1,
    prerequisite: 1,
  },
  {
    label: "Arrange a fictional team introduction",
    owner: "manager",
    required: false,
    dueOffsetDays: 2,
    prerequisite: 1,
  },
] as const;
export function submissionChanges(
  before: CandidateDraft,
  after: CandidateDraft,
) {
  const fields = [
    { key: "preferredName", label: "Preferred name" },
    { key: "introduction", label: "Professional introduction" },
    { key: "acknowledged", label: "Preview acknowledgement" },
  ] as const;
  return fields
    .filter((f) => before[f.key] !== after[f.key])
    .map((f) => ({
      field: f.key,
      label: f.label,
      before: before[f.key],
      after: after[f.key],
    }));
}
