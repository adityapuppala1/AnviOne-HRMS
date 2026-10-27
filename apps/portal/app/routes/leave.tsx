import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Avatar,
  Badge,
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
  NumberTicker,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@anvi/ui";
import {
  leaveRequestSchema,
  type LeaveBalance,
  type LeaveRequest,
  type PersonalCalendar,
  type LeaveState,
} from "@anvi/contracts";
import { api, useLeave, useLeaveApprovals } from "../lib/api";
import { useWorkspace } from "./workspace";
import { usePreferences } from "../lib/preferences";
import { leaveCopy as text } from "../lib/copy/leave";
import "./leave.css";

const day = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
function range(start: string, end: string) {
  return start === end
    ? day.format(at(start))
    : `${day.format(at(start))} – ${day.format(at(end))}`;
}
// Mirrors the server's business-day count: the work week minus holidays.
function workingDays(start: string, end: string, calendar: PersonalCalendar) {
  if (!start || !end || end < start) return 0;
  const holidays = new Set(calendar.holidays.map((h) => h.date));
  let count = 0;
  for (let d = at(start); d <= at(end); d.setUTCDate(d.getUTCDate() + 1))
    if (
      calendar.workDays.includes(d.getUTCDay() || 7) &&
      !holidays.has(d.toISOString().slice(0, 10))
    )
      count += 1;
  return count;
}

type Send = (path: string, body: unknown) => Promise<LeaveRequest>;

export default function Leave() {
  const { me } = useWorkspace();
  const canRequest = me.permissions.includes("leave.request");
  const canApprove = me.permissions.includes("leave.approve");
  const mine = useLeave(canRequest);
  const approvals = useLeaveApprovals(canApprove);
  const client = useQueryClient();
  const [composing, setComposing] = useState(false);
  if (!canRequest && !canApprove)
    return <ErrorState message={text.unavailable} />;
  const refresh = () => client.invalidateQueries({ queryKey: ["leave"] });
  const send: Send = (path, body) =>
    api(path, leaveRequestSchema, {
      method: "POST",
      headers: { "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify(body),
    });
  const waiting = approvals.data?.pending.filter((r) => r.canDecide).length;
  return (
    <div className="page-enter leave-page">
      <header className="leave-hero">
        <div>
          <h1>{text.hero.title}</h1>
          <p>
            {canRequest ? text.hero.requesterIntro : text.hero.approverIntro}
          </p>
        </div>
        {canRequest && (
          <Button onPress={() => setComposing(true)}>
            <Plus size={18} weight="bold" />
            {text.hero.requestLeave}
          </Button>
        )}
      </header>
      {canRequest && canApprove ? (
        <Tabs className="leave-tabs">
          <TabList aria-label={text.tabs.label} className="tabs-list">
            <Tab id="mine" className="tab">
              <AirplaneTilt size={18} />
              {text.tabs.mine}
            </Tab>
            <Tab id="team" className="tab">
              <CalendarCheck size={18} />
              {text.tabs.team}
              {Boolean(waiting) && <span className="tab-count">{waiting}</span>}
            </Tab>
          </TabList>
          <TabPanel id="mine" className="tab-panel">
            <MyLeave query={mine} send={send} refresh={refresh} />
          </TabPanel>
          <TabPanel id="team" className="tab-panel">
            <Approvals query={approvals} send={send} refresh={refresh} />
          </TabPanel>
        </Tabs>
      ) : canRequest ? (
        <MyLeave query={mine} send={send} refresh={refresh} />
      ) : (
        <Approvals query={approvals} send={send} refresh={refresh} />
      )}
      {canRequest && mine.data && (
        <RequestDialog
          open={composing}
          onClose={() => setComposing(false)}
          balances={mine.data.balances}
          calendar={mine.data.calendar}
          today={mine.data.today}
          send={send}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function MyLeave({
  query,
  send,
  refresh,
}: {
  query: ReturnType<typeof useLeave>;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
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
  const { balances, requests, year, today } = query.data;
  const upcoming = requests.filter(
    (r) => r.endDate >= today && ["pending", "approved"].includes(r.state),
  );
  const history = requests.filter((r) => !upcoming.includes(r));
  const askCancel = (r: LeaveRequest) => {
    setError("");
    setCancelling(r);
  };
  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    setError("");
    try {
      await send(`/leave/requests/${cancelling.id}/cancel`, {
        version: cancelling.version,
      });
      setCancelling(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : text.cancelDialog.failed,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="leave-layout">
      <section className="panel leave-balances" aria-labelledby="balances">
        <div className="panel-heading">
          <div>
            <h2 id="balances">{text.mine.balanceTitle(year)}</h2>
            <p>{text.mine.balanceHint}</p>
          </div>
        </div>
        <ul className="leave-threads">
          {balances.map((b) => (
            <BalanceThread key={b.id} balance={b} />
          ))}
        </ul>
      </section>
      <section className="panel leave-requests" aria-labelledby="requests">
        <div className="panel-heading">
          <div>
            <h2 id="requests">{text.mine.requestsTitle}</h2>
            <p>{text.mine.requestsHint}</p>
          </div>
        </div>
        {requests.length === 0 ? (
          <div className="leave-empty">
            <AirplaneTilt size={34} weight="duotone" />
            <h3>{text.mine.emptyTitle}</h3>
            <p>{text.mine.emptyBody}</p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <RequestList
                title={text.mine.comingUp}
                items={upcoming}
                onCancel={askCancel}
              />
            )}
            {history.length > 0 && (
              <RequestList
                title={text.mine.history}
                items={history}
                onCancel={askCancel}
              />
            )}
          </>
        )}
      </section>
      <DialogPanel
        open={Boolean(cancelling)}
        onOpenChange={(open) => {
          if (!open && !busy) setCancelling(null);
        }}
        title={text.cancelDialog.title}
      >
        {cancelling && (
          <div className="leave-form">
            <p>
              {text.cancelDialog.summary(
                cancelling.leaveType.name,
                range(cancelling.startDate, cancelling.endDate),
                cancelling.days,
                cancelling.state === "approved",
              )}
            </p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="leave-actions">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => setCancelling(null)}
              >
                {text.cancelDialog.keep}
              </Button>
              <Button isDisabled={busy} onPress={() => void cancel()}>
                {busy
                  ? text.cancelDialog.cancelling
                  : text.cancelDialog.confirm}
              </Button>
            </div>
          </div>
        )}
      </DialogPanel>
    </div>
  );
}

function BalanceThread({ balance }: { balance: LeaveBalance }) {
  const { reduceMotion } = usePreferences();
  if (balance.annualDays === null || balance.available === null)
    return (
      <li className="leave-thread leave-thread-open">
        <div className="leave-thread-head">
          <strong>{balance.name}</strong>
          <span>{text.balance.noLimit(balance.paid)}</span>
        </div>
        <p className="leave-thread-note">
          {text.balance.openNote(balance.used, balance.pending)}
        </p>
      </li>
    );
  const total = balance.annualDays;
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  return (
    <li className="leave-thread">
      <div className="leave-thread-head">
        <strong>{balance.name}</strong>
        <span>
          <b>
            <NumberTicker value={balance.available} disabled={reduceMotion} />
          </b>{" "}
          {text.balance.ofLeft(total)}
        </span>
      </div>
      <div
        className="leave-rail"
        role="img"
        aria-label={text.balance.railLabel(
          balance.name,
          balance.used,
          balance.pending,
          balance.available,
          total,
        )}
      >
        <span
          className="leave-rail-used"
          style={{ width: pct(balance.used) }}
        />
        <span
          className="leave-rail-pending"
          style={{ width: pct(balance.pending) }}
        />
      </div>
      <p className="leave-thread-note">
        {text.balance.usedNote(balance.used)}
        {balance.pending > 0 && text.balance.onHold(balance.pending)}
      </p>
    </li>
  );
}

function RequestList({
  title,
  items,
  onCancel,
}: {
  title: string;
  items: LeaveRequest[];
  onCancel: (r: LeaveRequest) => void;
}) {
  return (
    <div className="leave-group">
      <h3>{title}</h3>
      <ol className="leave-list">
        {items.map((r) => (
          <li key={r.id} className={`leave-item leave-${r.state}`}>
            <DateBlock request={r} />
            <div className="leave-item-body">
              <div className="leave-item-head">
                <strong>{r.leaveType.name}</strong>
                <StateBadge state={r.state} />
              </div>
              <p>
                {text.list.detail(
                  range(r.startDate, r.endDate),
                  r.days,
                  r.approver === "manager",
                )}
              </p>
              <p className="leave-reason">{r.reason}</p>
              {r.decidedBy && r.state !== "cancelled" && (
                <p className="leave-decision">
                  {text.list.decision(
                    text.states[r.state],
                    r.decidedBy,
                    r.decisionNote,
                  )}
                </p>
              )}
            </div>
            {r.canCancel && (
              <Button
                variant="secondary"
                onPress={() => onCancel(r)}
                aria-label={text.list.cancelAria(
                  r.leaveType.name,
                  range(r.startDate, r.endDate),
                )}
              >
                {text.list.cancel}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DateBlock({ request }: { request: LeaveRequest }) {
  const start = at(request.startDate);
  return (
    <div className="leave-date" aria-hidden="true">
      <strong>{start.getUTCDate()}</strong>
      <span>
        {start.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}
      </span>
    </div>
  );
}

function StateBadge({ state }: { state: LeaveState }) {
  const tone =
    state === "approved" ? "green" : state === "pending" ? "amber" : "neutral";
  return <Badge tone={tone}>{text.states[state]}</Badge>;
}

function Approvals({
  query,
  send,
  refresh,
}: {
  query: ReturnType<typeof useLeaveApprovals>;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [declining, setDeclining] = useState<LeaveRequest | null>(null);
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
  async function decide(
    r: LeaveRequest,
    decision: "approve" | "reject",
    note: string | null,
  ) {
    setBusy(r.id);
    setError("");
    try {
      await send(`/leave/requests/${r.id}/decision`, {
        version: r.version,
        decision,
        note,
      });
      setDeclining(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : text.approvals.saveFailed,
      );
    } finally {
      setBusy(null);
    }
  }
  const { pending, decided } = query.data;
  return (
    <div className="leave-approvals">
      {error && !declining && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section aria-labelledby="awaiting">
        <h2 id="awaiting" className="leave-section-title">
          {text.approvals.awaitingTitle}
        </h2>
        {pending.length === 0 ? (
          <div className="panel leave-empty">
            <CalendarCheck size={34} weight="duotone" />
            <h3>{text.approvals.caughtUpTitle}</h3>
            <p>{text.approvals.caughtUpBody}</p>
          </div>
        ) : (
          <ul className="leave-cards">
            {pending.map((r) => (
              <li key={r.id} className="panel leave-card">
                <div className="leave-card-person">
                  <Avatar initials={r.initials} />
                  <div>
                    <strong>{r.employeeName}</strong>
                    <span>{r.department}</span>
                  </div>
                </div>
                <div className="leave-card-when">
                  <strong>{range(r.startDate, r.endDate)}</strong>
                  <span>
                    {text.approvals.cardType(r.leaveType.name, r.days)}
                  </span>
                </div>
                <p className="leave-reason">{r.reason}</p>
                {r.canDecide ? (
                  <div className="leave-actions">
                    <Button
                      isDisabled={busy === r.id}
                      onPress={() => void decide(r, "approve", null)}
                      aria-label={text.approvals.approveAria(r.employeeName)}
                    >
                      <Check size={17} weight="bold" />
                      {busy === r.id
                        ? text.approvals.saving
                        : text.approvals.approve}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy === r.id}
                      onPress={() => {
                        setError("");
                        setDeclining(r);
                      }}
                      aria-label={text.approvals.declineAria(r.employeeName)}
                    >
                      <X size={17} />
                      {text.approvals.decline}
                    </Button>
                  </div>
                ) : (
                  <p className="leave-routed">
                    {text.approvals.routed(r.approver === "manager")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {decided.length > 0 && (
        <section className="panel leave-decided" aria-labelledby="decided">
          <div className="panel-heading">
            <div>
              <h2 id="decided">{text.approvals.decidedTitle}</h2>
              <p>{text.approvals.decidedHint}</p>
            </div>
          </div>
          <ol className="leave-list">
            {decided.map((r) => (
              <li key={r.id} className={`leave-item leave-${r.state}`}>
                <DateBlock request={r} />
                <div className="leave-item-body">
                  <div className="leave-item-head">
                    <strong>{r.employeeName}</strong>
                    <StateBadge state={r.state} />
                  </div>
                  <p>
                    {text.approvals.decidedDetail(
                      r.leaveType.name,
                      range(r.startDate, r.endDate),
                      r.days,
                    )}
                  </p>
                  {r.decidedBy && (
                    <p className="leave-decision">
                      {text.approvals.decidedBy(r.decidedBy, r.decisionNote)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <DialogPanel
        open={Boolean(declining)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeclining(null);
        }}
        title={text.declineDialog.title}
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
              {text.declineDialog.summary(
                declining.employeeName,
                declining.leaveType.name,
                range(declining.startDate, declining.endDate),
              )}
            </p>
            <label>
              {text.declineDialog.reasonLabel}
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
                {text.declineDialog.goBack}
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy ? text.declineDialog.saving : text.declineDialog.submit}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}

function RequestDialog({
  open,
  onClose,
  balances,
  calendar,
  today,
  send,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  balances: LeaveBalance[];
  calendar: PersonalCalendar;
  today: string;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [type, setType] = useState(balances[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const days = useMemo(
    () => workingDays(start, end, calendar),
    [start, end, calendar],
  );
  const left = balances.find((b) => b.id === type)?.available ?? null;
  const short = left !== null && days > left;
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason"));
    setBusy(true);
    setError("");
    try {
      await send("/leave/requests", {
        leaveTypeId: type,
        startDate: start,
        endDate: end,
        reason,
      });
      setStart("");
      setEnd("");
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.request.failed);
    } finally {
      setBusy(false);
    }
  }
  let count = text.request.countOk(days);
  if (days === 0)
    count = start && end ? text.request.countAllOff : text.request.countPick;
  else if (short) count = text.request.countShort(days, left);
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.request.title}
      className="leave-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <label>
          {text.request.typeLabel}
          <select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            autoFocus
          >
            {balances.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.available === null
                  ? text.request.optionNoLimit
                  : text.request.optionLeft(b.available)}
              </option>
            ))}
          </select>
        </label>
        <div className="leave-dates">
          <label>
            {text.request.firstDay}
            <input
              type="date"
              name="start"
              required
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
                if (!end || event.target.value > end)
                  setEnd(event.target.value);
              }}
            />
          </label>
          <label>
            {text.request.lastDay}
            <input
              type="date"
              name="end"
              required
              min={start || today}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <p
          className={`leave-count ${short ? "leave-count-short" : ""}`}
          aria-live="polite"
        >
          {count}
        </p>
        <label>
          {text.request.reasonLabel}
          <textarea name="reason" required minLength={3} maxLength={300} />
        </label>
        <p className="leave-hint">{text.request.hint}</p>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="leave-actions">
          <Button variant="secondary" isDisabled={busy} onPress={close}>
            {text.request.cancel}
          </Button>
          <Button type="submit" isDisabled={busy || days === 0 || short}>
            {busy ? text.request.sending : text.request.send}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
