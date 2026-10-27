import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { SealCheck } from "@phosphor-icons/react/dist/csr/SealCheck";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { Tray } from "@phosphor-icons/react/dist/csr/Tray";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Avatar,
  Button,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import type { ApprovalItem } from "@anvi/contracts";
import { api, useApprovals } from "../lib/api";
import { approvalsCopy as text } from "../lib/copy/approvals";
import { usePreferences } from "../lib/preferences";
import { useWorkspace } from "./workspace";
// Shared card, form and list styles come from the leave screen.
import "./leave.css";
import "./approvals.css";

type Decision = "approve" | "reject";
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (iso: string) =>
  at(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const person = (item: ApprovalItem) =>
  item.kind === "readiness_review" ? item.candidateName : item.employeeName;
const subject = (item: ApprovalItem) => text.subject[item.kind];
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? text.sizeKb(Math.max(1, Math.round(bytes / 1024)))
    : text.sizeMb((bytes / 1024 / 1024).toFixed(1));
// What the requester said, or for documents what was uploaded.
const summary = (item: ApprovalItem) =>
  item.kind === "document_review"
    ? text.fileSummary(item.fileName, size(item.sizeBytes))
    : item.reason;

// Each module keeps its own versioned decision endpoint and body.
function decisionRequest(
  item: ApprovalItem,
  decision: Decision,
  note: string | null,
) {
  if (item.kind === "document_review")
    return {
      path: `/documents/${item.id}/decision`,
      body: {
        version: item.version,
        decision: decision === "approve" ? "verify" : "reject",
        note,
      },
    };
  if (item.kind === "readiness_review")
    return {
      path: `/candidates/${item.caseId}/local-reviews/${item.id}`,
      body: {
        caseVersion: item.caseVersion,
        reviewVersion: item.version,
        decision: decision === "approve" ? "approved" : "rejected",
        reason: note ?? "",
      },
    };
  return {
    path:
      item.kind === "leave"
        ? `/leave/requests/${item.id}/decision`
        : `/attendance/corrections/${item.id}/decision`,
    body: { version: item.version, decision, note },
  };
}

export default function Approvals() {
  const { me } = useWorkspace();
  const allowed = [
    "leave.approve",
    "attendance.review",
    "onboarding.manage",
    "document.review",
  ].some((p) => me.permissions.includes(p as (typeof me.permissions)[number]));
  const query = useApprovals(allowed);
  const client = useQueryClient();
  const { reduceMotion } = usePreferences();
  // A note dialog: always for declines, and for readiness approvals (which need a reason).
  const [noting, setNoting] = useState<{
    item: ApprovalItem;
    decision: Decision;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!allowed) return <ErrorState message={text.errors.notAllowed} />;
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  const mine = query.data.items.filter((i) => i.canDecide);
  const others = query.data.items.filter((i) => !i.canDecide);
  async function decide(
    item: ApprovalItem,
    decision: Decision,
    note: string | null,
  ) {
    const { path, body } = decisionRequest(item, decision, note);
    setBusy(item.id);
    setError("");
    try {
      await api(path, z.unknown(), {
        method: "POST",
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body),
      });
      setNoting(null);
      // Module screens and the nav count read the same records.
      await Promise.all(
        ["approvals", "leave", "attendance", "candidates", "documents"].map(
          (key) => client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.errors.decision);
    } finally {
      setBusy(null);
    }
  }
  function start(item: ApprovalItem, decision: Decision) {
    setError("");
    if (decision === "approve" && item.kind !== "readiness_review")
      void decide(item, decision, null);
    else setNoting({ item, decision });
  }
  const minimum = noting?.item.kind === "readiness_review" ? 10 : 3;
  return (
    <div className="page-enter approvals-page">
      <PageHeader title={text.hero.title} description={text.hero.body} />
      <p className="loom-date">
        <Tray size={16} />
        {mine.length === 0 ? text.hero.none : text.hero.waiting(mine.length)}
      </p>
      <div className="leave-stats">
        <StatCard
          label={text.stats.waiting}
          value={mine.length}
          hint={text.stats.waitingHint}
          icon={Tray}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.others}
          value={others.length}
          hint={text.stats.othersHint}
          icon={SealCheck}
          animate={!reduceMotion}
        />
      </div>
      {error && !noting && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section aria-labelledby="yours">
        <h2 id="yours" className="leave-section-title">
          {text.sections.yours}
        </h2>
        {mine.length === 0 ? (
          <div className="panel">
            <EmptyBlock
              icon={Check}
              title={text.empty.title}
              description={text.empty.body}
            />
          </div>
        ) : (
          <ul className="leave-cards">
            {mine.map((item) => (
              <ApprovalCard
                key={`${item.kind}-${item.id}`}
                item={item}
                busy={busy === item.id}
                onDecide={(decision) => start(item, decision)}
              />
            ))}
          </ul>
        )}
      </section>
      {others.length > 0 && (
        <section aria-labelledby="others">
          <h2 id="others" className="leave-section-title">
            {text.sections.others}
          </h2>
          <ul className="leave-cards">
            {others.map((item) => (
              <ApprovalCard key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </ul>
        </section>
      )}
      <DialogPanel
        open={Boolean(noting)}
        onOpenChange={(open) => {
          if (!open && !busy) setNoting(null);
        }}
        title={
          noting?.decision === "approve"
            ? text.dialog.approveTitle
            : text.dialog.declineTitle
        }
      >
        {noting && (
          <form
            className="leave-form"
            onSubmit={(event) => {
              event.preventDefault();
              const note = String(
                new FormData(event.currentTarget).get("note") ?? "",
              );
              void decide(noting.item, noting.decision, note);
            }}
          >
            <p>
              {noting.decision === "approve"
                ? text.dialog.approveNote(person(noting.item))
                : text.dialog.declineNote(
                    person(noting.item),
                    subject(noting.item),
                  )}
            </p>
            <TextArea
              label={
                noting.decision === "approve"
                  ? text.dialog.approveLabel
                  : text.dialog.declineLabel
              }
              name="note"
              isRequired
              hideRequiredIndicator
              minLength={minimum}
              maxLength={300}
              autoFocus
            />
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="leave-actions">
              <Button
                variant="secondary"
                isDisabled={Boolean(busy)}
                onPress={() => setNoting(null)}
              >
                {text.dialog.back}
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy
                  ? text.actions.saving
                  : noting.decision === "approve"
                    ? text.actions.approve
                    : text.actions.decline}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}

function KindLabel({ item }: { item: ApprovalItem }) {
  if (item.kind === "leave")
    return (
      <>
        <AirplaneTilt size={16} />
        {item.leaveType}
      </>
    );
  if (item.kind === "attendance_correction")
    return (
      <>
        <CalendarDots size={16} />
        {text.kind.attendance}
      </>
    );
  if (item.kind === "document_review")
    return (
      <>
        <FileText size={16} />
        {text.kind.document}
      </>
    );
  return (
    <>
      <SealCheck size={16} />
      {text.kind.readiness}
    </>
  );
}

function When({ item }: { item: ApprovalItem }) {
  if (item.kind === "leave")
    return (
      <>
        <strong>
          {item.startDate === item.endDate
            ? day(item.startDate)
            : text.when.range(day(item.startDate), day(item.endDate))}
        </strong>
        <span>{text.when.away(text.days(item.days))}</span>
      </>
    );
  if (item.kind === "attendance_correction")
    return (
      <>
        <strong>{text.when.times(item.checkIn, item.checkOut)}</strong>
        <span>{text.when.proposedTimes(day(item.workDate))}</span>
      </>
    );
  if (item.kind === "document_review")
    return (
      <>
        <strong>{item.title}</strong>
        <span>{text.when.documentCategory(item.category)}</span>
      </>
    );
  return (
    <>
      <strong>{text.when.proposedBy(item.proposerLabel)}</strong>
      <span>
        {item.evidenceReady
          ? text.when.evidenceReady
          : text.when.evidenceIncomplete}
      </span>
    </>
  );
}

function ApprovalCard({
  item,
  busy = false,
  onDecide,
}: {
  item: ApprovalItem;
  busy?: boolean;
  onDecide?: (decision: Decision) => void;
}) {
  const name = person(item);
  const blocked = item.kind === "readiness_review" && !item.evidenceReady;
  return (
    <li className={`panel leave-card approval-${item.kind}`}>
      <div className="approval-kind">
        <KindLabel item={item} />
      </div>
      <div className="leave-card-person">
        <Avatar initials={item.initials} />
        <div>
          <strong>{name}</strong>
          <span>
            {item.kind === "readiness_review"
              ? text.card.candidate(item.candidateTitle, item.department)
              : item.department}
          </span>
        </div>
      </div>
      <div className="leave-card-when">
        <When item={item} />
      </div>
      <p className="leave-reason">{summary(item)}</p>
      {item.kind === "document_review" && (
        <a
          className="text-link"
          href={`/api/v1/documents/${item.id}/content`}
          download
        >
          {text.actions.viewFile}
        </a>
      )}
      {item.canDecide && onDecide ? (
        <div className="leave-actions">
          <Button
            isDisabled={busy || blocked}
            onPress={() => onDecide("approve")}
            aria-label={text.actions.approveLabel(subject(item), name)}
          >
            <Check size={17} weight="bold" />
            {busy ? text.actions.saving : text.actions.approve}
          </Button>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => onDecide("reject")}
            aria-label={text.actions.declineLabel(subject(item), name)}
          >
            <X size={17} />
            {text.actions.decline}
          </Button>
        </div>
      ) : (
        <StatusBadge color="gray" size="sm">
          {item.kind === "readiness_review"
            ? text.card.proposedByYou
            : item.approver === "manager"
              ? text.card.managerDecides
              : text.card.hrDecides}
        </StatusBadge>
      )}
    </li>
  );
}
