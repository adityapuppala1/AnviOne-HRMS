import { describe, it, expect } from "vitest";
import {
  candidateTaskCreateSchema,
  candidateTaskUpdateSchema,
  candidateTaskAssignmentSchema,
  assignedTaskUpdateSchema,
  localReviewDecisionSchema,
  localReviewProposalSchema,
  candidateDocumentReviewSchema,
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
  it("keeps task assignment and assignee updates identity-free and strict", () => {
    const employeeId = crypto.randomUUID();
    expect(
      candidateTaskAssignmentSchema.safeParse({
        caseVersion: 4,
        assignmentVersion: null,
        employeeId,
        reason: "Assign this fictional coordination task to a named owner.",
      }).success,
    ).toBe(true);
    expect(
      candidateTaskAssignmentSchema.safeParse({
        caseVersion: 4,
        assignmentVersion: null,
        employeeId,
        actorId: crypto.randomUUID(),
        reason: "Attempt to forge the assigning identity in the request.",
      }).success,
    ).toBe(false);
    expect(
      assignedTaskUpdateSchema.safeParse({
        taskVersion: 2,
        state: "completed",
        reason: "Completed the fictional preparation and recorded its outcome.",
      }).success,
    ).toBe(true);
    expect(
      assignedTaskUpdateSchema.safeParse({
        taskVersion: 2,
        caseVersion: 9,
        state: "completed",
        reason: "The assignee cannot claim or control the parent case version.",
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
  it("validates candidate document review schema and requires reason on rejection", () => {
    expect(
      candidateDocumentReviewSchema.safeParse({
        decision: "verified",
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      candidateDocumentReviewSchema.safeParse({
        decision: "rejected",
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      candidateDocumentReviewSchema.safeParse({
        decision: "rejected",
        reason: "Too short",
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      candidateDocumentReviewSchema.safeParse({
        decision: "rejected",
        reason: "Document is unreadable and edges are cropped.",
        version: 1,
      }).success,
    ).toBe(true);
  });
  it("evaluates document gate in activation readiness", () => {
    // Missing documents blocks document gate
    const missingDocs = activationReadiness("approved", [], []);
    expect(missingDocs.controls.find((c) => c.id === "documents")).toMatchObject({
      status: "blocked",
      detail: "0 of 3 mandatory documents verified.",
    });

    // Partial documents (e.g. 2 of 3 verified)
    const partialDocs = activationReadiness("approved", [], [
      { category: "government_id", status: "verified" },
      { category: "proof_of_address", status: "verified" },
      { category: "education_certificate", status: "pending" },
    ]);
    expect(partialDocs.controls.find((c) => c.id === "documents")).toMatchObject({
      status: "blocked",
      detail: "2 of 3 mandatory documents verified.",
    });

    // All 3 mandatory verified passes document gate even if optional previous_employment is missing
    const passedDocs = activationReadiness("approved", [], [
      { category: "government_id", status: "verified" },
      { category: "proof_of_address", status: "verified" },
      { category: "education_certificate", status: "verified" },
    ]);
    expect(passedDocs.controls.find((c) => c.id === "documents")).toMatchObject({
      status: "passed",
      detail: "All mandatory candidate documents are verified.",
    });
  });
});
