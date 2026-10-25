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
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@anvi/ui";
import {
  leaveRequestSchema,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveState,
} from "@anvi/contracts";
import { api, useLeave, useLeaveApprovals } from "../lib/api";
import { useWorkspace } from "./workspace";
import "./leave.css";

const stateLabels: Record<LeaveState, string> = {
  pending: "Awaiting decision",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};
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
function workingDays(start: string, end: string) {
  if (!start || !end || end < start) return 0;
  let count = 0;
  for (let d = at(start); d <= at(end); d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() % 6 !== 0) count += 1;
  return count;
}
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

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
    return (
      <ErrorState message="Leave is available in employee, manager and HR workspaces. Switch role to continue." />
    );
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
          <h1>Time away, planned together.</h1>
          <p>
            {canRequest
              ? "See what you have left, ask for time off and follow each decision."
              : "Decide the requests routed to you and keep an eye on what is coming up."}
          </p>
        </div>
        {canRequest && (
          <Button onPress={() => setComposing(true)}>
            <Plus size={18} weight="bold" />
            Request leave
          </Button>
        )}
      </header>
      {canRequest && canApprove ? (
        <Tabs className="leave-tabs">
          <TabList aria-label="Leave views" className="tabs-list">
            <Tab id="mine" className="tab">
              <AirplaneTilt size={18} />
              Your leave
            </Tab>
            <Tab id="team" className="tab">
              <CalendarCheck size={18} />
              Team requests
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
        cause instanceof Error ? cause.message : "Could not cancel this leave.",
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
            <h2 id="balances">Your {year} balance</h2>
            <p>
              Approved leave is used; requests awaiting a decision are held.
            </p>
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
            <h2 id="requests">Your requests</h2>
            <p>Coming up first, then everything already decided.</p>
          </div>
        </div>
        {requests.length === 0 ? (
          <div className="leave-empty">
            <AirplaneTilt size={34} weight="duotone" />
            <h3>No leave requested yet</h3>
            <p>Use Request leave to plan your first time away.</p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <RequestList
                title="Coming up"
                items={upcoming}
                onCancel={askCancel}
              />
            )}
            {history.length > 0 && (
              <RequestList
                title="History"
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
        title="Cancel this leave?"
      >
        {cancelling && (
          <div className="leave-form">
            <p>
              {cancelling.leaveType.name},{" "}
              {range(cancelling.startDate, cancelling.endDate)} (
              {plural(cancelling.days)}).{" "}
              {cancelling.state === "approved"
                ? "The days return to your balance."
                : "Your approver will no longer see it."}
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
                Keep it
              </Button>
              <Button isDisabled={busy} onPress={() => void cancel()}>
                {busy ? "Cancelling…" : "Cancel leave"}
              </Button>
            </div>
          </div>
        )}
      </DialogPanel>
    </div>
  );
}

function BalanceThread({ balance }: { balance: LeaveBalance }) {
  if (balance.annualDays === null || balance.available === null)
    return (
      <li className="leave-thread leave-thread-open">
        <div className="leave-thread-head">
          <strong>{balance.name}</strong>
          <span>{balance.paid ? "Paid" : "Unpaid"}, no annual limit</span>
        </div>
        <p className="leave-thread-note">
          {balance.used + balance.pending > 0
            ? `${plural(balance.used)} taken, ${plural(balance.pending)} awaiting a decision this year.`
            : "Nothing taken this year."}
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
          <b>{balance.available}</b> of {total} days left
        </span>
      </div>
      <div
        className="leave-rail"
        role="img"
        aria-label={`${balance.name}: ${balance.used} used, ${balance.pending} awaiting a decision, ${balance.available} available of ${total}`}
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
        {plural(balance.used)} used
        {balance.pending > 0 && `, ${plural(balance.pending)} on hold`}
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
                {range(r.startDate, r.endDate)}, {plural(r.days)}.{" "}
                {r.approver === "manager"
                  ? "Your manager decides."
                  : "HR decides."}
              </p>
              <p className="leave-reason">{r.reason}</p>
              {r.decidedBy && r.state !== "cancelled" && (
                <p className="leave-decision">
                  {stateLabels[r.state]} by {r.decidedBy}
                  {r.decisionNote ? `: ${r.decisionNote}` : "."}
                </p>
              )}
            </div>
            {r.canCancel && (
              <Button
                variant="secondary"
                onPress={() => onCancel(r)}
                aria-label={`Cancel ${r.leaveType.name}, ${range(r.startDate, r.endDate)}`}
              >
                Cancel
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
  return <Badge tone={tone}>{stateLabels[state]}</Badge>;
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
        cause instanceof Error ? cause.message : "Could not save the decision.",
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
          Awaiting a decision
        </h2>
        {pending.length === 0 ? (
          <div className="panel leave-empty">
            <CalendarCheck size={34} weight="duotone" />
            <h3>You're all caught up</h3>
            <p>New requests routed to you will appear here.</p>
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
                    {r.leaveType.name}, {plural(r.days)}
                  </span>
                </div>
                <p className="leave-reason">{r.reason}</p>
                {r.canDecide ? (
                  <div className="leave-actions">
                    <Button
                      isDisabled={busy === r.id}
                      onPress={() => void decide(r, "approve", null)}
                      aria-label={`Approve leave for ${r.employeeName}`}
                    >
                      <Check size={17} weight="bold" />
                      {busy === r.id ? "Saving…" : "Approve"}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy === r.id}
                      onPress={() => {
                        setError("");
                        setDeclining(r);
                      }}
                      aria-label={`Decline leave for ${r.employeeName}`}
                    >
                      <X size={17} />
                      Decline
                    </Button>
                  </div>
                ) : (
                  <p className="leave-routed">
                    {r.approver === "manager"
                      ? "Their manager decides this request."
                      : "Another HR colleague decides this request."}
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
              <h2 id="decided">Recently decided</h2>
              <p>The latest 20 decisions and cancellations you can see.</p>
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
                    {r.leaveType.name}, {range(r.startDate, r.endDate)},{" "}
                    {plural(r.days)}
                  </p>
                  {r.decidedBy && (
                    <p className="leave-decision">
                      By {r.decidedBy}
                      {r.decisionNote ? `: ${r.decisionNote}` : "."}
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
              {declining.employeeName} asked for{" "}
              {declining.leaveType.name.toLowerCase()},{" "}
              {range(declining.startDate, declining.endDate)}. They will see
              your note.
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
                {busy ? "Saving…" : "Decline request"}
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
  today,
  send,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  balances: LeaveBalance[];
  today: string;
  send: Send;
  refresh: () => Promise<void>;
}) {
  const [type, setType] = useState(balances[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const days = useMemo(() => workingDays(start, end), [start, end]);
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
      setError(
        cause instanceof Error ? cause.message : "Could not send this request.",
      );
    } finally {
      setBusy(false);
    }
  }
  let count = `${plural(days)} of leave, weekends excluded.`;
  if (days === 0)
    count =
      start && end
        ? "These dates fall on a weekend. Choose at least one working day."
        : "Pick your dates to see how many working days this uses.";
  else if (short)
    count = `${plural(days)}, more than the ${plural(left)} you have left.`;
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Request leave"
      className="leave-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <label>
          Leave type
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
                  ? " (no limit)"
                  : ` (${plural(b.available)} left)`}
              </option>
            ))}
          </select>
        </label>
        <div className="leave-dates">
          <label>
            First day
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
            Last day
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
          Reason
          <textarea name="reason" required minLength={3} maxLength={300} />
        </label>
        <p className="leave-hint">
          Your approver sees this. Keep medical details private.
        </p>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="leave-actions">
          <Button variant="secondary" isDisabled={busy} onPress={close}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={busy || days === 0 || short}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
