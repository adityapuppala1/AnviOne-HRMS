import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Avatar,
  Button,
  CollectionView,
  DetailFields,
  StatusBadge,
  type CollectionDetail,
  type Column,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  LoadingState,
  NumberTicker,
  PageHeader,
  StatCard,
  BadgeWithDot,
  RangeInput,
  Select,
  TextArea,
  UTabs,
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
  const { reduceMotion } = usePreferences();
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
  const stats =
    canRequest && mine.data
      ? {
          available: mine.data.balances.reduce(
            (sum, b) => sum + (b.available ?? 0),
            0,
          ),
          pending: mine.data.requests.filter((r) => r.state === "pending")
            .length,
          upcoming: mine.data.requests.filter(
            (r) => r.state === "approved" && r.endDate >= mine.data.today,
          ).length,
        }
      : null;
  return (
    <div className="page-enter leave-page">
      <PageHeader
        title={text.hero.title}
        description={
          canRequest ? text.hero.requesterIntro : text.hero.approverIntro
        }
        actions={
          canRequest && (
            <Button onPress={() => setComposing(true)}>
              <Plus size={18} weight="bold" />
              {text.hero.requestLeave}
            </Button>
          )
        }
      />
      {(stats || waiting !== undefined) && (
        <div className="leave-stats">
          {stats && (
            <>
              <StatCard
                label={text.stats.available}
                value={stats.available}
                suffix={text.stats.daysUnit}
                hint={text.stats.availableHint}
                icon={AirplaneTilt}
                animate={!reduceMotion}
              />
              <StatCard
                label={text.stats.pending}
                value={stats.pending}
                hint={text.stats.pendingHint}
                icon={CalendarCheck}
                animate={!reduceMotion}
              />
              <StatCard
                label={text.stats.upcoming}
                value={stats.upcoming}
                hint={text.stats.upcomingHint}
                icon={Check}
                animate={!reduceMotion}
              />
            </>
          )}
          {!stats && waiting !== undefined && (
            <StatCard
              label={text.stats.waiting}
              value={waiting}
              hint={text.stats.waitingHint}
              icon={CalendarCheck}
              animate={!reduceMotion}
            />
          )}
        </div>
      )}
      {canRequest && canApprove ? (
        <UTabs className="leave-tabs" keyboardActivation="automatic">
          <UTabs.List type="underline" aria-label={text.tabs.label}>
            <UTabs.Item id="mine">
              <AirplaneTilt size={18} />
              {text.tabs.mine}
            </UTabs.Item>
            <UTabs.Item id="team">
              <CalendarCheck size={18} />
              {text.tabs.team}
              {Boolean(waiting) && <span className="tab-count">{waiting}</span>}
            </UTabs.Item>
          </UTabs.List>
          <UTabs.Panel id="mine" className="tab-panel">
            <MyLeave query={mine} send={send} refresh={refresh} />
          </UTabs.Panel>
          <UTabs.Panel id="team" className="tab-panel">
            <Approvals query={approvals} send={send} refresh={refresh} />
          </UTabs.Panel>
        </UTabs>
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
          <EmptyBlock
            icon={AirplaneTilt}
            title={text.mine.emptyTitle}
            description={text.mine.emptyBody}
          />
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

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
const stateColor = (state: LeaveState) =>
  state === "approved"
    ? "success"
    : state === "pending"
      ? "warning"
      : state === "rejected"
        ? "error"
        : "gray";
const requestDetail: CollectionDetail<LeaveRequest> = {
  title: (r) => `${r.leaveType.name}, ${range(r.startDate, r.endDate)}`,
  subtitle: (r) => (
    <StatusBadge color={stateColor(r.state)} size="sm" type="pill-color">
      {text.states[r.state]}
    </StatusBadge>
  ),
  body: (r) => (
    <>
      <DetailFields
        title="Request"
        fields={[
          { label: "Person", value: r.employeeName },
          { label: "Department", value: r.department },
          { label: "Leave type", value: r.leaveType.name },
          { label: "From", value: range(r.startDate, r.startDate) },
          { label: "To", value: range(r.endDate, r.endDate) },
          { label: "Days", value: String(r.days) },
          { label: "Reason", value: r.reason },
          {
            label: "Decided by",
            value: r.approver === "manager" ? "Team manager" : "HR",
          },
        ]}
      />
      <DetailFields
        title="History"
        fields={[
          { label: "Requested", value: stamp(r.createdAt) },
          { label: "Status", value: text.states[r.state] },
          { label: "Decided by", value: r.decidedBy },
          { label: "Decided", value: r.decidedAt && stamp(r.decidedAt) },
          { label: "Note", value: r.decisionNote },
        ]}
      />
    </>
  ),
};
const requestColumns = (
  onCancel?: (r: LeaveRequest) => void,
  showPerson = false,
): Column<LeaveRequest>[] => [
  {
    id: "type",
    label: showPerson ? "Person and type" : "Leave type",
    isRowHeader: true,
    sortValue: (r) => (showPerson ? r.employeeName : r.leaveType.name),
    render: (r) => (
      <span className="flex flex-col">
        <strong className="text-sm text-primary">
          {showPerson ? r.employeeName : r.leaveType.name}
        </strong>
        {showPerson && (
          <span className="text-sm text-tertiary">{r.leaveType.name}</span>
        )}
      </span>
    ),
  },
  {
    id: "dates",
    label: "Dates",
    sortValue: (r) => r.startDate,
    render: (r) => (
      <span className="text-sm">{range(r.startDate, r.endDate)}</span>
    ),
  },
  {
    id: "days",
    label: "Days",
    sortValue: (r) => r.days,
    render: (r) => <span className="text-sm">{r.days}</span>,
  },
  {
    id: "state",
    label: "Status",
    sortValue: (r) => r.state,
    render: (r) => <StateBadge state={r.state} />,
  },
  {
    id: "actions",
    label: "",
    render: (r) =>
      onCancel && r.canCancel ? (
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
      ) : null,
  },
];

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
      <CollectionView
        id="leave-requests"
        label={title}
        noun="requests"
        items={items}
        getKey={(r) => r.id}
        columns={requestColumns(onCancel)}
        detail={requestDetail}
        defaultView="cards"
        renderCard={(r) => (
          <div className={`leave-item leave-${r.state}`}>
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
          </div>
        )}
      />
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
  const color =
    state === "approved"
      ? "success"
      : state === "pending"
        ? "warning"
        : state === "rejected"
          ? "error"
          : "gray";
  return (
    <BadgeWithDot color={color} size="sm">
      {text.states[state]}
    </BadgeWithDot>
  );
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
          <div className="panel">
            <EmptyBlock
              icon={CalendarCheck}
              title={text.approvals.caughtUpTitle}
              description={text.approvals.caughtUpBody}
            />
          </div>
        ) : (
          <CollectionView
            id="leave-pending"
            label={text.approvals.awaitingTitle}
            noun="requests"
            items={pending}
            getKey={(r) => r.id}
            columns={requestColumns(undefined, true)}
            detail={requestDetail}
            defaultView="cards"
            renderCard={(r) => (
              <div className="leave-card">
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
              </div>
            )}
          />
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
          <CollectionView
            id="leave-decided"
            label={text.approvals.decidedTitle}
            noun="decisions"
            items={decided}
            getKey={(r) => r.id}
            columns={requestColumns(undefined, true)}
            detail={requestDetail}
            defaultView="table"
            renderCard={(r) => (
              <div className={`leave-item leave-${r.state}`}>
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
              </div>
            )}
          />
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
            <TextArea
              label={text.declineDialog.reasonLabel}
              name="note"
              isRequired
              hideRequiredIndicator
              minLength={3}
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
        <Select
          label={text.request.typeLabel}
          name="type"
          selectedKey={type}
          onSelectionChange={(key) => setType(String(key))}
          autoFocus
        >
          {balances.map((b) => (
            <Select.Item
              key={b.id}
              id={b.id}
              label={`${b.name}${
                b.available === null
                  ? text.request.optionNoLimit
                  : text.request.optionLeft(b.available)
              }`}
            />
          ))}
        </Select>
        <div className="leave-dates">
          <RangeInput
            type="date"
            name="start"
            label={text.request.firstDay}
            isRequired
            value={start}
            onChange={(value) => {
              setStart(value);
              if (!end || value > end) setEnd(value);
            }}
          />
          <RangeInput
            type="date"
            name="end"
            label={text.request.lastDay}
            isRequired
            min={start || today}
            value={end}
            onChange={setEnd}
          />
        </div>
        <p
          className={`leave-count ${short ? "leave-count-short" : ""}`}
          aria-live="polite"
        >
          {count}
        </p>
        <TextArea
          label={text.request.reasonLabel}
          name="reason"
          isRequired
          hideRequiredIndicator
          minLength={3}
          maxLength={300}
        />
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
