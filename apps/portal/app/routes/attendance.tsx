import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { SignIn } from "@phosphor-icons/react/dist/csr/SignIn";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Avatar,
  Badge,
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@anvi/ui";
import type {
  AttendanceCorrection,
  AttendanceDay,
  AttendanceDayStatus,
  AttendanceOverview,
  AttendanceTeam,
} from "@anvi/contracts";
import { api, useAttendance, useAttendanceTeam } from "../lib/api";
import { useWorkspace } from "./workspace";
// Shared form, card and list styles come from the leave screen.
import "./leave.css";
import "./attendance.css";

const dayLabels: Record<AttendanceDayStatus, string> = {
  present: "Present",
  in_progress: "Checked in",
  incomplete: "Missing check-out",
  leave: "On leave",
  weekend: "Weekend",
  unaccounted: "Unaccounted (provisional LOP)",
  not_started: "Not checked in yet",
};
const presenceLabels: Record<
  AttendanceTeam["people"][number]["status"],
  string
> = {
  in: "In now",
  done: "Day complete",
  leave: "On leave",
  not_in: "Not in yet",
  weekend: "Weekend",
};
const correctionLabels: Record<AttendanceCorrection["state"], string> = {
  pending: "Awaiting decision",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const longDate = (iso: string) =>
  at(iso).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const shortDate = (iso: string) =>
  at(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const toMinutes = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h! * 60 + m!;
};
const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

type Send = (path: string, body: unknown) => Promise<unknown>;

export default function Attendance() {
  const { me } = useWorkspace();
  const canSelf = me.permissions.includes("attendance.self");
  const canReview = me.permissions.includes("attendance.review");
  const mine = useAttendance(canSelf);
  const team = useAttendanceTeam(canReview);
  const client = useQueryClient();
  if (!canSelf && !canReview)
    return (
      <ErrorState message="Attendance is available in employee, manager and HR workspaces. Switch role to continue." />
    );
  const refresh = () => client.invalidateQueries({ queryKey: ["attendance"] });
  const send: Send = (path, body) =>
    api(path, z.unknown(), {
      method: "POST",
      headers: { "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify(body),
    });
  const waiting = team.data?.pending.filter((c) => c.canDecide).length;
  return (
    <div className="page-enter attendance-page">
      <header className="leave-hero">
        <div>
          <h1>Your day, on the record.</h1>
          <p>
            {canSelf
              ? "Check in when you start, check out when you finish, and fix any day that went unrecorded."
              : "See who is in today and decide the corrections routed to you."}
          </p>
        </div>
      </header>
      {canSelf && canReview ? (
        <Tabs className="leave-tabs">
          <TabList aria-label="Attendance views" className="tabs-list">
            <Tab id="mine" className="tab">
              <Clock size={18} />
              Your attendance
            </Tab>
            <Tab id="team" className="tab">
              <UsersThree size={18} />
              Team today
              {Boolean(waiting) && <span className="tab-count">{waiting}</span>}
            </Tab>
          </TabList>
          <TabPanel id="mine" className="tab-panel">
            <MyAttendance query={mine} send={send} refresh={refresh} />
          </TabPanel>
          <TabPanel id="team" className="tab-panel">
            <TeamToday query={team} send={send} refresh={refresh} />
          </TabPanel>
        </Tabs>
      ) : canSelf ? (
        <MyAttendance query={mine} send={send} refresh={refresh} />
      ) : (
        <TeamToday query={team} send={send} refresh={refresh} />
      )}
    </div>
  );
}

function MyAttendance({
  query,
  send,
  refresh,
}: {
  query: ReturnType<typeof useAttendance>;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<AttendanceDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  const data = query.data;
  const day = data.days.find((d) => d.date === (selected ?? data.today))!;
  async function punch() {
    setBusy(true);
    setError("");
    try {
      if (data.record)
        await send("/attendance/check-out", { version: data.record.version });
      else await send("/attendance/check-in", {});
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel(correction: AttendanceCorrection) {
    setError("");
    try {
      await send(`/attendance/corrections/${correction.id}/cancel`, {
        version: correction.version,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel.");
    }
  }
  return (
    <div className="attendance-layout">
      <DayThread data={data} busy={busy} onPunch={() => void punch()} />
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section className="panel attendance-month" aria-labelledby="month">
        <div className="panel-heading">
          <div>
            <h2 id="month">The last 30 days</h2>
            <p>Select a day to see its times or ask for a correction.</p>
          </div>
        </div>
        <ol className="attendance-grid">
          {[...data.days].reverse().map((d) => (
            <li key={d.date}>
              <button
                type="button"
                className={`attendance-cell attendance-${d.status} ${
                  d.date === day.date ? "is-selected" : ""
                }`}
                aria-pressed={d.date === day.date}
                aria-label={`${longDate(d.date)}: ${dayLabels[d.status]}${
                  d.correctionPending ? ", correction awaiting a decision" : ""
                }`}
                onClick={() => setSelected(d.date)}
              >
                <span>{at(d.date).getUTCDate()}</span>
                {d.correctionPending && <i aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ol>
        <ul className="attendance-legend" aria-label="Legend">
          {(
            [
              "present",
              "leave",
              "unaccounted",
              "incomplete",
              "weekend",
            ] as const
          ).map((status) => (
            <li key={status}>
              <span className={`attendance-swatch attendance-${status}`} />
              {dayLabels[status]}
            </li>
          ))}
        </ul>
        <DayDetail
          day={day}
          today={data.today}
          onCorrect={() => setCorrecting(day)}
        />
      </section>
      <section className="panel leave-requests" aria-labelledby="corrections">
        <div className="panel-heading">
          <div>
            <h2 id="corrections">Your corrections</h2>
            <p>Requests to fix a past day, newest first.</p>
          </div>
        </div>
        {data.corrections.length === 0 ? (
          <div className="leave-empty">
            <Check size={34} weight="duotone" />
            <h3>No corrections requested</h3>
            <p>If a day was recorded wrongly, select it and request one.</p>
          </div>
        ) : (
          <ol className="leave-list attendance-corrections">
            {data.corrections.map((c) => (
              <CorrectionItem
                key={c.id}
                correction={c}
                onCancel={() => void cancel(c)}
              />
            ))}
          </ol>
        )}
      </section>
      <CorrectionDialog
        day={correcting}
        onClose={() => setCorrecting(null)}
        send={send}
        refresh={refresh}
      />
    </div>
  );
}

// The day thread runs 06:00–22:00; the marigold span is the time worked.
function DayThread({
  data,
  busy,
  onPunch,
}: {
  data: AttendanceOverview;
  busy: boolean;
  onPunch: () => void;
}) {
  const startOfThread = 6 * 60;
  const span = 16 * 60;
  const place = (clock: string) =>
    `${Math.max(0, Math.min(100, ((toMinutes(clock) - startOfThread) / span) * 100))}%`;
  const record = data.record;
  const end = record?.checkOut ?? data.now;
  const worked = record ? toMinutes(end) - toMinutes(record.checkIn) : 0;
  const today = data.days[0]!;
  return (
    <section className="attendance-thread" aria-labelledby="today">
      <div className="attendance-thread-copy">
        <p className="loom-date">{longDate(data.today)}</p>
        <h2 id="today">
          {record?.checkOut
            ? `Day complete, ${duration(worked)}`
            : record
              ? `Checked in at ${record.checkIn}`
              : today.status === "leave"
                ? "You're on leave today"
                : "Ready when you are"}
        </h2>
        <p>
          {record && !record.checkOut
            ? `${duration(worked)} so far. Check out when you finish.`
            : record
              ? `${record.checkIn} to ${record.checkOut}.`
              : "Your check-in time comes from the server clock."}
        </p>
      </div>
      <div className="attendance-track" aria-hidden="true">
        {[6, 9, 12, 15, 18, 21].map((h) => (
          <span
            key={h}
            className="attendance-hour"
            style={{ left: `${((h * 60 - startOfThread) / span) * 100}%` }}
          >
            {String(h).padStart(2, "0")}:00
          </span>
        ))}
        {record && (
          <span
            className={`attendance-span ${record.checkOut ? "" : "is-live"}`}
            style={{
              left: place(record.checkIn),
              width: `calc(${place(end)} - ${place(record.checkIn)})`,
            }}
          />
        )}
        <span className="attendance-now" style={{ left: place(data.now) }} />
      </div>
      {!record?.checkOut && (
        <Button
          className="attendance-punch"
          isDisabled={busy}
          onPress={onPunch}
        >
          {record ? <SignOut size={19} /> : <SignIn size={19} />}
          {busy ? "Saving…" : record ? "Check out" : "Check in"}
        </Button>
      )}
    </section>
  );
}

function DayDetail({
  day,
  today,
  onCorrect,
}: {
  day: AttendanceDay;
  today: string;
  onCorrect: () => void;
}) {
  const correctable =
    day.date < today &&
    !day.correctionPending &&
    day.status !== "leave" &&
    day.status !== "weekend";
  return (
    <div className={`attendance-detail attendance-detail-${day.status}`}>
      <div>
        <h3>{longDate(day.date)}</h3>
        <p>
          {dayLabels[day.status]}
          {day.leaveType ? `: ${day.leaveType}` : ""}
          {day.checkIn
            ? `. ${day.checkIn}${day.checkOut ? ` to ${day.checkOut}` : ", no check-out"}`
            : ""}
          {day.minutes !== null ? ` (${duration(day.minutes)})` : ""}
          {day.source === "correction" ? ", corrected" : ""}.
        </p>
        {day.status === "unaccounted" && (
          <p className="attendance-flag">
            Flagged for review only. Nothing is deducted from pay.
          </p>
        )}
        {day.correctionPending && (
          <p className="attendance-flag">
            A correction is awaiting a decision.
          </p>
        )}
      </div>
      {correctable && (
        <Button variant="secondary" onPress={onCorrect}>
          Request a correction
        </Button>
      )}
    </div>
  );
}

function CorrectionItem({
  correction: c,
  onCancel,
  showPerson = false,
}: {
  correction: AttendanceCorrection;
  onCancel?: () => void;
  showPerson?: boolean;
}) {
  return (
    <li className={`leave-item leave-${c.state}`}>
      <div className="leave-date" aria-hidden="true">
        <strong>{at(c.workDate).getUTCDate()}</strong>
        <span>
          {at(c.workDate).toLocaleDateString("en-IN", {
            month: "short",
            timeZone: "UTC",
          })}
        </span>
      </div>
      <div className="leave-item-body">
        <div className="leave-item-head">
          <strong>
            {showPerson ? c.employeeName : `${c.checkIn} to ${c.checkOut}`}
          </strong>
          <Badge
            tone={
              c.state === "approved"
                ? "green"
                : c.state === "pending"
                  ? "amber"
                  : "neutral"
            }
          >
            {correctionLabels[c.state]}
          </Badge>
        </div>
        <p>
          {showPerson
            ? `${shortDate(c.workDate)}, ${c.checkIn} to ${c.checkOut}`
            : shortDate(c.workDate)}
          . {c.approver === "manager" ? "Manager decides." : "HR decides."}
        </p>
        <p className="leave-reason">{c.reason}</p>
        {c.decidedBy && c.state !== "cancelled" && (
          <p className="leave-decision">
            {correctionLabels[c.state]} by {c.decidedBy}
            {c.decisionNote ? `: ${c.decisionNote}` : "."}
          </p>
        )}
      </div>
      {c.canCancel && onCancel && (
        <Button
          variant="secondary"
          onPress={onCancel}
          aria-label={`Cancel correction for ${shortDate(c.workDate)}`}
        >
          Cancel
        </Button>
      )}
    </li>
  );
}

function CorrectionDialog({
  day,
  onClose,
  send,
  refresh,
}: {
  day: AttendanceDay | null;
  onClose: () => void;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!day) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await send("/attendance/corrections", {
        workDate: day.date,
        checkIn: String(form.get("checkIn")),
        checkOut: String(form.get("checkOut")),
        reason: String(form.get("reason")),
      });
      await refresh();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send the request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open={Boolean(day)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Request a correction"
      className="leave-modal"
    >
      {day && (
        <form className="leave-form" onSubmit={(event) => void submit(event)}>
          <p>
            {longDate(day.date)}. Enter the times you actually worked; your
            approver sees your reason.
          </p>
          <div className="leave-dates">
            <label>
              Checked in at
              <input
                type="time"
                name="checkIn"
                required
                defaultValue={day.checkIn ?? "09:30"}
                autoFocus
              />
            </label>
            <label>
              Checked out at
              <input
                type="time"
                name="checkOut"
                required
                defaultValue={day.checkOut ?? "18:00"}
              />
            </label>
          </div>
          <label>
            What happened?
            <textarea name="reason" required minLength={3} maxLength={300} />
          </label>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="leave-actions">
            <Button variant="secondary" isDisabled={busy} onPress={close}>
              Cancel
            </Button>
            <Button type="submit" isDisabled={busy}>
              {busy ? "Sending…" : "Send correction"}
            </Button>
          </div>
        </form>
      )}
    </DialogPanel>
  );
}

function TeamToday({
  query,
  send,
  refresh,
}: {
  query: ReturnType<typeof useAttendanceTeam>;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [declining, setDeclining] = useState<AttendanceCorrection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  const { people, pending, decided, date } = query.data;
  const counts = {
    in: people.filter((p) => p.status === "in").length,
    done: people.filter((p) => p.status === "done").length,
    leave: people.filter((p) => p.status === "leave").length,
  };
  async function decide(
    c: AttendanceCorrection,
    decision: "approve" | "reject",
    note: string | null,
  ) {
    setBusy(c.id);
    setError("");
    try {
      await send(`/attendance/corrections/${c.id}/decision`, {
        version: c.version,
        decision,
        note,
      });
      setDeclining(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the decision.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="leave-approvals">
      {error && !declining && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section className="panel attendance-board" aria-labelledby="board">
        <div className="panel-heading">
          <div>
            <h2 id="board">Who's in, {longDate(date)}</h2>
            <p>
              {counts.in} in now, {counts.done} finished, {counts.leave} on
              leave, of {people.length} people you can see.
            </p>
          </div>
        </div>
        {people.length === 0 ? (
          <p className="leave-empty">Nobody reports to you yet.</p>
        ) : (
          <ul className="attendance-people">
            {people.map((p) => (
              <li key={p.employeeId} className={`presence-${p.status}`}>
                <Avatar initials={p.initials} size="small" />
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.department}</small>
                </span>
                <span className="presence-pill">
                  {presenceLabels[p.status]}
                  {p.checkIn ? ` · ${p.checkIn}` : ""}
                  {p.checkOut ? `–${p.checkOut}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="awaiting-corrections">
        <h2 id="awaiting-corrections" className="leave-section-title">
          Corrections awaiting a decision
        </h2>
        {pending.length === 0 ? (
          <div className="panel leave-empty">
            <Check size={34} weight="duotone" />
            <h3>No corrections to review</h3>
            <p>Requests routed to you will appear here.</p>
          </div>
        ) : (
          <ul className="leave-cards">
            {pending.map((c) => (
              <li key={c.id} className="panel leave-card">
                <div className="leave-card-person">
                  <Avatar initials={c.initials} />
                  <div>
                    <strong>{c.employeeName}</strong>
                    <span>{c.department}</span>
                  </div>
                </div>
                <div className="leave-card-when">
                  <strong>
                    {c.checkIn} to {c.checkOut}
                  </strong>
                  <span>{longDate(c.workDate)}</span>
                </div>
                <p className="leave-reason">{c.reason}</p>
                {c.canDecide ? (
                  <div className="leave-actions">
                    <Button
                      isDisabled={busy === c.id}
                      onPress={() => void decide(c, "approve", null)}
                      aria-label={`Approve correction for ${c.employeeName}`}
                    >
                      <Check size={17} weight="bold" />
                      {busy === c.id ? "Saving…" : "Approve"}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy === c.id}
                      onPress={() => {
                        setError("");
                        setDeclining(c);
                      }}
                      aria-label={`Decline correction for ${c.employeeName}`}
                    >
                      <X size={17} />
                      Decline
                    </Button>
                  </div>
                ) : (
                  <p className="leave-routed">
                    {c.approver === "manager"
                      ? "Their manager decides this correction."
                      : "Another HR colleague decides this correction."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {decided.length > 0 && (
        <section className="panel leave-decided" aria-labelledby="decided-c">
          <div className="panel-heading">
            <div>
              <h2 id="decided-c">Recently decided</h2>
              <p>The latest 20 corrections you can see.</p>
            </div>
          </div>
          <ol className="leave-list">
            {decided.map((c) => (
              <CorrectionItem key={c.id} correction={c} showPerson />
            ))}
          </ol>
        </section>
      )}
      <DialogPanel
        open={Boolean(declining)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeclining(null);
        }}
        title="Decline this correction?"
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
              {declining.employeeName} asked to record {declining.checkIn}–
              {declining.checkOut} on {longDate(declining.workDate)}. They will
              see your note.
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
                {busy ? "Saving…" : "Decline correction"}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}
