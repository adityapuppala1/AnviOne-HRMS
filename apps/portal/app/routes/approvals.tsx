import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
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

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (iso: string) =>
  at(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const decisionPath = (item: ApprovalItem) =>
  item.kind === "leave"
    ? `/leave/requests/${item.id}/decision`
    : `/attendance/corrections/${item.id}/decision`;
const subject = (item: ApprovalItem) =>
  item.kind === "leave" ? "leave" : "attendance correction";

export default function Approvals() {
  const { me } = useWorkspace();
  const allowed =
    me.permissions.includes("leave.approve") ||
    me.permissions.includes("attendance.review");
  const query = useApprovals(allowed);
  const client = useQueryClient();
  const [declining, setDeclining] = useState<ApprovalItem | null>(null);
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
    decision: "approve" | "reject",
    note: string | null,
  ) {
    setBusy(item.id);
    setError("");
    try {
      await api(decisionPath(item), z.unknown(), {
        method: "POST",
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({ version: item.version, decision, note }),
      });
      setDeclining(null);
      // Module screens and the nav count read the same records.
      await Promise.all([
        client.invalidateQueries({ queryKey: ["approvals"] }),
        client.invalidateQueries({ queryKey: ["leave"] }),
        client.invalidateQueries({ queryKey: ["attendance"] }),
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the decision.",
      );
    } finally {
      setBusy(null);
    }
  }
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
            Leave requests and attendance corrections routed to you, oldest
            first. Each decision is recorded with your name.
          </p>
        </div>
      </header>
      {error && !declining && (
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
                onApprove={() => void decide(item, "approve", null)}
                onDecline={() => {
                  setError("");
                  setDeclining(item);
                }}
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
        open={Boolean(declining)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeclining(null);
        }}
        title="Decline this request?"
      >
        {declining && (
          <form
            className="leave-form"
            onSubmit={(event) => {
              event.preventDefault();
              const note = String(
                new FormData(event.currentTarget).get("note") ?? "",
              );
              void decide(declining, "reject", note);
            }}
          >
            <p>
              {declining.employeeName} will see your note on their{" "}
              {subject(declining)}.
            </p>
            <label>
              Why are you declining?
              <textarea
                name="note"
                required
                minLength={3}
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
                onPress={() => setDeclining(null)}
              >
                Go back
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy ? "Saving…" : "Decline"}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}

function ApprovalCard({
  item,
  busy = false,
  onApprove,
  onDecline,
}: {
  item: ApprovalItem;
  busy?: boolean;
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  const leave = item.kind === "leave";
  return (
    <li className={`panel leave-card approval-${item.kind}`}>
      <div className="approval-kind">
        {leave ? <AirplaneTilt size={16} /> : <CalendarDots size={16} />}
        {leave ? item.leaveType : "Attendance correction"}
      </div>
      <div className="leave-card-person">
        <Avatar initials={item.initials} />
        <div>
          <strong>{item.employeeName}</strong>
          <span>{item.department}</span>
        </div>
      </div>
      <div className="leave-card-when">
        {leave ? (
          <>
            <strong>
              {item.startDate === item.endDate
                ? day(item.startDate)
                : `${day(item.startDate)} – ${day(item.endDate)}`}
            </strong>
            <span>{plural(item.days)} away</span>
          </>
        ) : (
          <>
            <strong>
              {item.checkIn} to {item.checkOut}
            </strong>
            <span>Proposed times for {day(item.workDate)}</span>
          </>
        )}
      </div>
      <p className="leave-reason">{item.reason}</p>
      {item.canDecide && onApprove && onDecline ? (
        <div className="leave-actions">
          <Button
            isDisabled={busy}
            onPress={onApprove}
            aria-label={`Approve ${subject(item)} for ${item.employeeName}`}
          >
            <Check size={17} weight="bold" />
            {busy ? "Saving…" : "Approve"}
          </Button>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={onDecline}
            aria-label={`Decline ${subject(item)} for ${item.employeeName}`}
          >
            <X size={17} />
            Decline
          </Button>
        </div>
      ) : (
        <Badge>
          {item.approver === "manager"
            ? "Their manager decides"
            : "Another HR colleague decides"}
        </Badge>
      )}
    </li>
  );
}
