import { describe, it, expect } from "vitest";
import {
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  onboardingStarter,
  submissionChanges,
} from "./index";
describe("onboarding checklist contracts", () => {
  it("bounds task creation and rejects privilege-bearing extra fields", () => {
    const task = {
      caseVersion: 1,
      label: "Synthetic task",
      owner: "it",
      required: true,
      dueOffsetDays: 0,
      dependsOn: null,
    };
    expect(candidateTaskCreateSchema.safeParse(task).success).toBe(true);
    for (const extra of [
      { ...task, owner: "platform_admin" },
      { ...task, dueOffsetDays: 91 },
      { ...task, tenantId: "other" },
    ])
      expect(candidateTaskCreateSchema.safeParse(extra).success).toBe(false);
    expect(
      candidateTaskUpdateSchema.safeParse({
        caseVersion: 1,
        version: 1,
        state: "completed",
        reason: "done",
      }).success,
    ).toBe(false);
  });
  it("starter dependencies refer only to earlier tasks and cover coordinating owners", () => {
    onboardingStarter.forEach((t, i) =>
      expect(t.prerequisite === null || t.prerequisite < i).toBe(true),
    );
    expect(new Set(onboardingStarter.map((t) => t.owner)).size).toBe(5);
  });
  it("compares named fields without mutating or silently replacing history", () => {
    const before = {
      preferredName: "Avery",
      introduction: "Original introduction",
      acknowledged: false,
    };
    const after = {
      ...before,
      introduction: "Updated introduction",
      acknowledged: true,
    };
    expect(submissionChanges(before, after)).toEqual([
      {
        field: "introduction",
        label: "Professional introduction",
        before: "Original introduction",
        after: "Updated introduction",
      },
      {
        field: "acknowledged",
        label: "Preview acknowledgement",
        before: false,
        after: true,
      },
    ]);
    expect(submissionChanges(before, before)).toEqual([]);
    expect(before.acknowledged).toBe(false);
  });
});
