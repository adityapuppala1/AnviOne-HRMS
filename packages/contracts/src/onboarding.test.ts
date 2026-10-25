import { describe, it, expect } from "vitest";
import {
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  localReviewDecisionSchema,
  localReviewProposalSchema,
  activationReadiness,
  onboardingStarter,
  submissionChanges,
} from "./index";
describe("onboarding checklist contracts", () => {
  it("keeps readiness workflow actors out of strict request bodies", () => {
    expect(
      localReviewProposalSchema.safeParse({
        caseVersion: 1,
        reason: "Request an independent synthetic readiness review.",
      }).success,
    ).toBe(true);
    expect(
      localReviewDecisionSchema.safeParse({
        caseVersion: 2,
        reviewVersion: 1,
        decision: "approved",
        reason: "Independently reviewed the synthetic local evidence.",
        decidedBy: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      localReviewDecisionSchema.safeParse({
        caseVersion: 2,
        reviewVersion: 1,
        decision: "withdrawn",
        reason: "Withdraw this synthetic proposal before review.",
      }).success,
    ).toBe(true);
  });
  it("denies activation until every local and external control passes", () => {
    const ready = activationReadiness("approved", [
      { required: true, state: "completed" },
      { required: false, state: "pending" },
    ]);
    expect(ready.activationReady).toBe(false);
    expect(
      ready.controls.map((control) => [control.id, control.status]),
    ).toEqual([
      ["form", "passed"],
      ["checklist", "passed"],
      ["email_ownership", "blocked"],
      ["identity", "blocked"],
      ["documents", "blocked"],
      ["privacy", "blocked"],
    ]);
    expect(ready.controls[1]?.detail).toContain("1 of 1");
  });
  it("reports required checklist blockers and ignores optional work", () => {
    const ready = activationReadiness("submitted", [
      { required: true, state: "pending" },
      { required: true, state: "blocked" },
      { required: false, state: "pending" },
    ]);
    expect(ready.controls[0]?.status).toBe("blocked");
    expect(ready.controls[1]).toMatchObject({ status: "blocked" });
    expect(ready.controls[1]?.detail).toContain("2 required tasks remain");
  });
  it("names an unconfigured required checklist without implying completion", () => {
    const ready = activationReadiness("approved", []);
    expect(ready.controls[1]).toMatchObject({ status: "blocked" });
    expect(ready.controls[1]?.detail).toBe(
      "No required checklist is configured. Start one before local readiness can complete.",
    );
  });
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
