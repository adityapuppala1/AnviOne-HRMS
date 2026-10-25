import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { SealCheck } from "@phosphor-icons/react/dist/csr/SealCheck";
import { Tray } from "@phosphor-icons/react/dist/csr/Tray";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Avatar,
  Badge,
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
} from "@anvi/ui";
import type { ApprovalItem } from "@anvi/contracts";
import { api, useApprovals } from "../lib/api";
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
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const person = (item: ApprovalItem) =>
  item.kind === "readiness_review" ? item.candidateName : item.employeeName;
const subject = (item: ApprovalItem) =>
  ({
    leave: "leave",
    attendance_correction: "attendance correction",
    readiness_review: "readiness review",
  })[item.kind];

// Each module keeps its own versioned decision endpoint and body.
function decisionRequest(
  item: ApprovalItem,
  decision: Decision,
  note: string | null,
) {
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
  ].some((p) => me.permissions.includes(p as (typeof me.permissions)[number]));
  const query = useApprovals(allowed);
  const client = useQueryClient();
  // A note dialog: always for declines, and for readiness approvals (which need a reason).
  const [noting, setNoting] = useState<{
    item: ApprovalItem;
    decision: Decision;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!allowed)
    return (
      <ErrorState message="Approvals are for managers and HR. Switch role to continue." />
    );
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
        ["approvals", "leave", "attendance", "candidates"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the decision.",
      );
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
      <header className="approvals-hero">
        <div>
          <p className="loom-date">
            <Tray size={16} />
            {mine.length === 0
              ? "Nothing waiting"
              : `${mine.length} waiting for you`}
          </p>
          <h1>Decisions, in one place.</h1>
          <p>
            Leave, attendance corrections and onboarding readiness reviews
            routed to you, oldest first. Each decision is recorded with your
            name.
          </p>
        </div>
      </header>
      {error && !noting && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section aria-labelledby="yours">
        <h2 id="yours" className="leave-section-title">
          Needs your decision
        </h2>
        {mine.length === 0 ? (
          <div className="panel leave-empty">
            <Check size={34} weight="duotone" />
            <h3>You're all caught up</h3>
            <p>New requests routed to you will appear here.</p>
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
            Routed to someone else
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
            ? "Approve this readiness review?"
            : "Decline this request?"
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
                ? `Record why ${person(noting.item)}'s local readiness evidence is sufficient. This is a local review, not employee activation.`
                : `${person(noting.item)}'s ${subject(noting.item)} will show your note.`}
            </p>
            <label>
              {noting.decision === "approve"
                ? "Reason for approving"
                : "Why are you declining?"}
              <textarea
                name="note"
                required
                minLength={minimum}
                maxLength={300}
                autoFocus
              />
            </label>
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
                Go back
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy
                  ? "Saving…"
                  : noting.decision === "approve"
                    ? "Approve"
                    : "Decline"}
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
        Attendance correction
      </>
    );
  return (
    <>
      <SealCheck size={16} />
      Onboarding readiness review
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
            : `${day(item.startDate)} – ${day(item.endDate)}`}
        </strong>
        <span>{plural(item.days)} away</span>
      </>
    );
  if (item.kind === "attendance_correction")
    return (
      <>
        <strong>
          {item.checkIn} to {item.checkOut}
        </strong>
        <span>Proposed times for {day(item.workDate)}</span>
      </>
    );
  return (
    <>
      <strong>Proposed by {item.proposerLabel}</strong>
      <span>
        {item.evidenceReady
          ? "Form approved and required tasks complete"
          : "Evidence incomplete: approve the form and finish required tasks first"}
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
              ? `${item.candidateTitle}, ${item.department}`
              : item.department}
          </span>
        </div>
      </div>
      <div className="leave-card-when">
        <When item={item} />
      </div>
      <p className="leave-reason">{item.reason}</p>
      {item.canDecide && onDecide ? (
        <div className="leave-actions">
          <Button
            isDisabled={busy || blocked}
            onPress={() => onDecide("approve")}
            aria-label={`Approve ${subject(item)} for ${name}`}
          >
            <Check size={17} weight="bold" />
            {busy ? "Saving…" : "Approve"}
          </Button>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => onDecide("reject")}
            aria-label={`Decline ${subject(item)} for ${name}`}
          >
            <X size={17} />
            Decline
          </Button>
        </div>
      ) : (
        <Badge>
          {item.kind === "readiness_review"
            ? "You proposed this; another HR colleague checks it"
            : item.approver === "manager"
              ? "Their manager decides"
              : "Another HR colleague decides"}
        </Badge>
      )}
    </li>
  );
}
