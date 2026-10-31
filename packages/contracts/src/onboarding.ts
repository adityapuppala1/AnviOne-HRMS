import type { CandidateDraft } from "./index";
import { activationReadinessSchema } from "./index";

type ReadinessTask = {
  required: boolean;
  state: "pending" | "blocked" | "completed";
};

export function activationReadiness(
  state:
    | "draft"
    | "invited"
    | "in_progress"
    | "submitted"
    | "changes_requested"
    | "approved"
    | "cancelled",
  tasks: ReadinessTask[],
) {
  const required = tasks.filter((task) => task.required);
  const completed = required.filter(
    (task) => task.state === "completed",
  ).length;
  const remaining = required.length - completed;
  const controls = [
    {
      id: "form",
      label: "Candidate form review",
      status: state === "approved" ? "passed" : "blocked",
      source: "preview",
      detail:
        state === "approved"
          ? "The latest synthetic form submission is approved."
          : "The latest synthetic form submission still needs approval.",
    },
    {
      id: "checklist",
      label: "Required onboarding tasks",
      status: required.length > 0 && remaining === 0 ? "passed" : "blocked",
      source: "preview",
      detail:
        required.length === 0
          ? "No required checklist is configured. Start one before local readiness can complete."
          : remaining === 0
            ? `${completed} of ${required.length} required tasks are complete.`
            : `${remaining} required task${remaining === 1 ? "" : "s"} remain before local readiness is complete.`,
    },
    {
      id: "email_ownership",
      label: "Nominated address ownership",
      status: "blocked",
      source: "external",
      detail: "Local OTP preview is not evidence of delivered-email ownership.",
    },
    {
      id: "identity",
      label: "Identity and official account",
      status: "blocked",
      source: "external",
      detail:
        "Identity evidence and a verified official email are not connected.",
    },
    {
      id: "documents",
      label: "Required documents and checks",
      status: "blocked",
      source: "external",
      detail:
        "Private upload, scanning and authorized verification are not available.",
    },
    {
      id: "privacy",
      label: "Privacy and policy approval",
      status: "blocked",
      source: "external",
      detail:
        "Approved notices, purposes and retention controls remain a release gate.",
    },
  ];
  return activationReadinessSchema.parse({
    activationReady: controls.every((control) => control.status === "passed"),
    controls,
  });
}
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
