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
  BadgeWithDot,
  Button,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
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
import { attendanceCopy as text } from "../lib/copy/attendance";
import { usePreferences } from "../lib/preferences";
import { useWorkspace } from "./workspace";
// Shared form, card and list styles come from the leave screen.
import "./leave.css";
import "./attendance.css";

const dayLabels: Record<AttendanceDayStatus, string> = text.dayLabels;
const presenceLabels: Record<
  AttendanceTeam["people"][number]["status"],
  string
> = text.presenceLabels;
const correctionLabels: Record<AttendanceCorrection["state"], string> =
  text.correctionLabels;
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
  const { reduceMotion } = usePreferences();
  if (!canSelf && !canReview) return <ErrorState message={text.noAccess} />;
  const refresh = () => client.invalidateQueries({ queryKey: ["attendance"] });
  const send: Send = (path, body) =>
    api(path, z.unknown(), {
      method: "POST",
      headers: { "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify(body),
    });
  const waiting = team.data?.pending.filter((c) => c.canDecide).length;
  const stats =
    canSelf && mine.data
      ? {
          present: mine.data.days.filter((d) => d.status === "present").length,
          missing: mine.data.days.filter((d) => d.status === "incomplete")
            .length,
          pending: mine.data.corrections.filter((c) => c.state === "pending")
            .length,
        }
      : null;
  return (
    <div className="page-enter attendance-page">
      <PageHeader
        title={text.hero.title}
        description={canSelf ? text.hero.selfIntro : text.hero.reviewerIntro}
      />
      {(stats || waiting !== undefined) && (
        <div className="leave-stats">
          {stats ? (
            <>
              <StatCard
                label={text.stats.present}
                value={stats.present}
                hint={text.stats.presentHint}
                icon={Check}
                animate={!reduceMotion}
              />
              <StatCard
                label={text.stats.missing}
                value={stats.missing}
                hint={text.stats.missingHint}
                icon={Clock}
                animate={!reduceMotion}
              />
              <StatCard
                label={text.stats.pending}
                value={stats.pending}
                hint={text.stats.pendingHint}
                icon={UsersThree}
                animate={!reduceMotion}
              />
            </>
          ) : (
            <StatCard
              label={text.stats.waiting}
              value={waiting ?? 0}
              hint={text.stats.waitingHint}
              icon={UsersThree}
              animate={!reduceMotion}
            />
          )}
        </div>
      )}
      {canSelf && canReview ? (
        <Tabs className="leave-tabs">
          <TabList aria-label={text.tabs.label} className="tabs-list">
            <Tab id="mine" className="tab">
              <Clock size={18} />
              {text.tabs.mine}
            </Tab>
            <Tab id="team" className="tab">
              <UsersThree size={18} />
              {text.tabs.team}
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
      setError(cause instanceof Error ? cause.message : text.errors.save);
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
      setError(cause instanceof Error ? cause.message : text.errors.cancel);
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
            <h2 id="month">{text.month.title}</h2>
            <p>{text.month.hint}</p>
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
                aria-label={text.month.cellLabel(
                  longDate(d.date),
                  dayLabels[d.status],
                  d.correctionPending,
                )}
                onClick={() => setSelected(d.date)}
              >
                <span>{at(d.date).getUTCDate()}</span>
                {d.correctionPending && <i aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ol>
        <ul className="attendance-legend" aria-label={text.month.legend}>
          {(
            [
              "present",
              "leave",
              "holiday",
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
            <h2 id="corrections">{text.corrections.title}</h2>
            <p>{text.corrections.hint}</p>
          </div>
        </div>
        {data.corrections.length === 0 ? (
          <EmptyBlock
            icon={Check}
            title={text.corrections.emptyTitle}
            description={text.corrections.emptyHint}
          />
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
            ? text.thread.dayComplete(duration(worked))
            : record
              ? text.thread.checkedInAt(record.checkIn)
              : today.status === "leave"
                ? text.thread.onLeave
                : today.status === "holiday"
                  ? text.thread.holiday(today.holiday)
                  : text.thread.ready}
        </h2>
        <p>
          {record && !record.checkOut
            ? text.thread.soFar(duration(worked))
            : record
              ? text.thread.range(record.checkIn, record.checkOut)
              : text.thread.serverClock}
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
          {busy
            ? text.thread.saving
            : record
              ? text.thread.checkOut
              : text.thread.checkIn}
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
    day.status !== "holiday" &&
    day.status !== "weekend";
  return (
    <div className={`attendance-detail attendance-detail-${day.status}`}>
      <div>
        <h3>{longDate(day.date)}</h3>
        <p>
          {text.detail.summary({
            label: dayLabels[day.status],
            leaveType: day.leaveType,
            holiday: day.holiday,
            checkIn: day.checkIn,
            checkOut: day.checkOut,
            duration: day.minutes !== null ? duration(day.minutes) : null,
            corrected: day.source === "correction",
          })}
        </p>
        {day.status === "unaccounted" && (
          <p className="attendance-flag">{text.detail.flagged}</p>
        )}
        {day.correctionPending && (
          <p className="attendance-flag">{text.detail.pending}</p>
        )}
      </div>
      {correctable && (
        <Button variant="secondary" onPress={onCorrect}>
          {text.detail.request}
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
            {showPerson
              ? c.employeeName
              : text.item.range(c.checkIn, c.checkOut)}
          </strong>
          <BadgeWithDot
            size="sm"
            color={
              c.state === "approved"
                ? "success"
                : c.state === "pending"
                  ? "warning"
                  : c.state === "rejected"
                    ? "error"
                    : "gray"
            }
          >
            {correctionLabels[c.state]}
          </BadgeWithDot>
        </div>
        <p>
          {text.item.meta(
            showPerson
              ? text.item.personWhen(
                  shortDate(c.workDate),
                  c.checkIn,
                  c.checkOut,
                )
              : shortDate(c.workDate),
            c.approver,
          )}
        </p>
        <p className="leave-reason">{c.reason}</p>
        {c.decidedBy && c.state !== "cancelled" && (
          <p className="leave-decision">
            {text.item.decidedBy(
              correctionLabels[c.state],
              c.decidedBy,
              c.decisionNote,
            )}
          </p>
        )}
      </div>
      {c.canCancel && onCancel && (
        <Button
          variant="secondary"
          onPress={onCancel}
          aria-label={text.item.cancelLabel(shortDate(c.workDate))}
        >
          {text.item.cancel}
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
      setError(cause instanceof Error ? cause.message : text.errors.send);
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
      title={text.dialog.title}
      className="leave-modal"
    >
      {day && (
        <form className="leave-form" onSubmit={(event) => void submit(event)}>
          <p>{text.dialog.intro(longDate(day.date))}</p>
          <div className="leave-dates">
            <label>
              {text.dialog.checkedIn}
              <input
                type="time"
                name="checkIn"
                required
                defaultValue={day.checkIn ?? "09:30"}
                autoFocus
              />
            </label>
            <label>
              {text.dialog.checkedOut}
              <input
                type="time"
                name="checkOut"
                required
                defaultValue={day.checkOut ?? "18:00"}
              />
            </label>
          </div>
          <label>
            {text.dialog.reason}
            <textarea name="reason" required minLength={3} maxLength={300} />
          </label>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="leave-actions">
            <Button variant="secondary" isDisabled={busy} onPress={close}>
              {text.dialog.cancel}
            </Button>
            <Button type="submit" isDisabled={busy}>
              {busy ? text.dialog.sending : text.dialog.send}
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
      setError(cause instanceof Error ? cause.message : text.errors.decision);
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
            <h2 id="board">{text.team.boardTitle(longDate(date))}</h2>
            <p>
              {text.team.summary(
                counts.in,
                counts.done,
                counts.leave,
                people.length,
              )}
            </p>
          </div>
        </div>
        {people.length === 0 ? (
          <EmptyBlock icon={UsersThree} title={text.team.nobody} />
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
          {text.team.awaitingTitle}
        </h2>
        {pending.length === 0 ? (
          <div className="panel">
            <EmptyBlock
              icon={Check}
              title={text.team.noneTitle}
              description={text.team.noneHint}
            />
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
                      aria-label={text.team.approveLabel(c.employeeName)}
                    >
                      <Check size={17} weight="bold" />
                      {busy === c.id ? text.team.saving : text.team.approve}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy === c.id}
                      onPress={() => {
                        setError("");
                        setDeclining(c);
                      }}
                      aria-label={text.team.declineLabel(c.employeeName)}
                    >
                      <X size={17} />
                      {text.team.decline}
                    </Button>
                  </div>
                ) : (
                  <p className="leave-routed">
                    {c.approver === "manager"
                      ? text.team.routedManager
                      : text.team.routedHr}
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
              <h2 id="decided-c">{text.team.decidedTitle}</h2>
              <p>{text.team.decidedHint}</p>
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
        title={text.team.declineDialogTitle}
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
              {text.team.declineIntro(
                declining.employeeName,
                declining.checkIn,
                declining.checkOut,
                longDate(declining.workDate),
              )}
            </p>
            <label>
              {text.team.declineWhy}
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
                {text.team.goBack}
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy ? text.team.saving : text.team.declineSubmit}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}
