import { ForbiddenException } from "@nestjs/common";
import { scopeFor, type Principal } from "@anvi/authz";
import type { ApprovalInbox, ApprovalItem } from "@anvi/contracts";
import type { PlatformStore } from "./platform.store";
import { LeaveStore } from "./leave.store";
import { AttendanceStore } from "./attendance.store";
import { OnboardingStore } from "./onboarding.store";
import { DocumentStore } from "./document.store";

// One inbox over every module's pending decisions. Each module still owns its
// reads (and their RLS scope) and its decision endpoint; this only merges them.
export class ApprovalsStore {
  private readonly leave;
  private readonly attendance;
  private readonly onboarding;
  private readonly documents;
  constructor(platform: PlatformStore) {
    this.leave = new LeaveStore(platform);
    this.attendance = new AttendanceStore(platform);
    this.onboarding = new OnboardingStore(platform);
    this.documents = new DocumentStore(platform);
  }

  async inbox(actor: Principal): Promise<ApprovalInbox> {
    const leave = Boolean(scopeFor(actor, "leave.approve"));
    const attendance = Boolean(scopeFor(actor, "attendance.review"));
    const onboarding = Boolean(scopeFor(actor, "onboarding.manage"));
    const documents = Boolean(scopeFor(actor, "document.review"));
    if (!leave && !attendance && !onboarding && !documents)
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
    const [requests, corrections, reviews, uploads] = await Promise.all([
      leave ? this.leave.approvals(actor) : null,
      attendance ? this.attendance.pendingCorrections(actor) : [],
      onboarding ? this.onboarding.pendingReviews(actor) : [],
      documents ? this.documents.pendingForInbox(actor) : [],
    ]);
    const items: ApprovalItem[] = [
      ...(requests?.pending ?? []).map((r): ApprovalItem => ({
        kind: "leave",
        id: r.id,
        version: r.version,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        initials: r.initials,
        department: r.department,
        reason: r.reason,
        submittedAt: r.createdAt,
        approver: r.approver,
        canDecide: r.canDecide,
        leaveType: r.leaveType.name,
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
      })),
      ...corrections.map((c): ApprovalItem => ({
        kind: "attendance_correction",
        id: c.id,
        version: c.version,
        employeeId: c.employeeId,
        employeeName: c.employeeName,
        initials: c.initials,
        department: c.department,
        reason: c.reason,
        submittedAt: c.createdAt,
        approver: c.approver,
        canDecide: c.canDecide,
        workDate: c.workDate,
        checkIn: c.checkIn,
        checkOut: c.checkOut,
      })),
      ...uploads.map((d): ApprovalItem => ({
        kind: "document_review",
        id: d.id,
        version: d.version,
        employeeId: d.employeeId,
        employeeName: d.employeeName,
        initials: d.initials,
        department: d.department,
        category: d.category,
        title: d.title,
        fileName: d.fileName,
        sizeBytes: d.sizeBytes,
        submittedAt: d.uploadedAt,
        approver: "hr",
        canDecide: d.canReview,
      })),
      ...reviews.map((r): ApprovalItem => ({
        kind: "readiness_review",
        approver: "hr",
        ...r,
      })),
    ];
    // Decisions for this person first, oldest waiting first.
    items.sort(
      (a, b) =>
        Number(b.canDecide) - Number(a.canDecide) ||
        a.submittedAt.localeCompare(b.submittedAt),
    );
    return { waiting: items.filter((i) => i.canDecide).length, items };
  }
}
