import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { DoorOpen } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import {
  Button,
  Checkbox,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  RangeInput,
  Select,
  StatCard,
  StatusBadge,
  TextArea,
  UAvatar,
} from "@anvi/ui";
import {
  exitDetailSchema,
  myExitSchema,
  type ExitCase,
  type ExitClearance,
  type ExitDetail,
  type ExitKind,
  type ExitStatus,
} from "@anvi/contracts";
import {
  ApiError,
  mutate,
  useDirectory,
  useExit,
  useExits,
  useMyExit,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { exitCopy as text } from "../lib/copy/exit";
import { useWorkspace } from "./workspace";
// Shared dialog form styles come from the leave screen.
import "./leave.css";
import "./exit.css";

const dateFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
const utcDate = dateFormat("UTC");
const istDate = dateFormat("Asia/Kolkata");
/** Plain YYYY-MM-DD dates are shown as written; ISO timestamps in India time. */
const day = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? utcDate.format(new Date(`${value}T00:00:00Z`))
    : istDate.format(new Date(value));
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
const addDays = (value: string, days: number) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const statusColor: Record<
  ExitStatus,
  "gray" | "brand" | "error" | "warning" | "success"
> = {
  submitted: "warning",
  accepted: "brand",
  completed: "success",
  withdrawn: "gray",
  rejected: "error",
};
const itemOrder = [
  "assets",
  "finance",
  "it_access",
  "manager_handover",
  "hr_documents",
] as const;
const statusKeys = Object.keys(text.statusNames) as ExitStatus[];
const kindKeys = Object.keys(text.kinds) as ExitKind[];

function StatusPill({ status }: { status: ExitStatus }) {
  return (
    <StatusBadge color={statusColor[status]} size="sm" type="pill-color">
      {text.statusNames[status]}
    </StatusBadge>
  );
}

export default function Exit() {
  const { me } = useWorkspace();
  if (me.permissions.includes("exit.manage")) return <ManageView />;
  if (me.permissions.includes("exit.self")) return <EmployeeView />;
  return <ErrorState message={text.denied} />;
}

/* Shared helpers --------------------------------------------------------- */

function useExitRequest() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(
    path: string,
    schema: z.ZodType<T>,
    body: unknown,
    fallback: string,
    method: "POST" | "PUT" = "POST",
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return schema.parse(await mutate(path, me.csrfToken, body, method));
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(
          cause.status === 403 && me.permissions.includes("exit.manage")
            ? text.errors.ownCase
            : cause.message ||
                (cause.status === 403 ? text.errors.forbidden : fallback),
        );
        // A stale version means someone else changed it: show the latest.
        if (cause.status === 409)
          void client.invalidateQueries({ queryKey: ["exits"] });
      } else setError(fallback);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError, client };
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function FormActions({
  busy,
  submit,
  saving,
  onCancel,
  disabled = false,
}: {
  busy: boolean;
  submit: string;
  saving: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {text.form.cancel}
      </Button>
      <Button type="submit" isDisabled={busy || disabled}>
        {busy ? saving : submit}
      </Button>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="inline-error">
      {message}
    </p>
  ) : null;
}

/** A required or optional note, 3 to 500 characters, with a live count. */
function NoteField({
  label,
  hint,
  required,
  autoFocus = false,
}: {
  id: string;
  label: string;
  hint: string;
  required: boolean;
  autoFocus?: boolean;
}) {
  const [length, setLength] = useState(0);
  return (
    <TextArea
      label={label}
      hint={`${hint} ${text.form.count(length)}`}
      name="note"
      textAreaClassName="exit-note-input"
      isRequired={required}
      hideRequiredIndicator
      minLength={3}
      maxLength={500}
      autoFocus={autoFocus}
      onChange={(value: string) => setLength(value.length)}
    />
  );
}

/** Where the case is on its way: Submitted, Accepted, Clearances, Completed. */
function Timeline({ item }: { item: ExitCase }) {
  const { status } = item;
  const acceptedDone =
    status === "accepted" ||
    status === "completed" ||
    (status === "withdrawn" && Boolean(item.decidedAt));
  const steps: { key: string; label: string; state: string }[] = [
    { key: "submitted", label: text.steps.submitted, state: "done" },
    {
      key: "accepted",
      label: text.steps.accepted,
      state: acceptedDone
        ? "done"
        : status === "submitted"
          ? "current"
          : "next",
    },
    {
      key: "clearances",
      label: text.steps.clearances,
      state:
        status === "completed"
          ? "done"
          : status === "accepted"
            ? "current"
            : "next",
    },
    {
      key: "completed",
      label: text.steps.completed,
      state: status === "completed" ? "done" : "next",
    },
  ];
  const stopped = status === "rejected" || status === "withdrawn";
  return (
    <div className="exit-progress">
      <ol className="exit-steps" aria-label={text.steps.heading}>
        {steps.map((step, index) => {
          const state =
            stopped && step.state === "current" ? "next" : step.state;
          return (
            <li
              key={step.key}
              className="exit-step"
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="exit-marker" aria-hidden="true">
                {state === "done" ? (
                  <Check size={14} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="exit-step-text">
                <strong>{step.label}</strong>
                <small>
                  {state === "done"
                    ? text.steps.done
                    : state === "current"
                      ? text.steps.current
                      : text.steps.next}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
      {stopped && (
        <p className="exit-stopped">
          {text.steps.stopped(text.statusNames[status])}
        </p>
      )}
    </div>
  );
}

function sortedClearances(clearances: ExitClearance[]) {
  return [...clearances].sort(
    (a, b) => itemOrder.indexOf(a.item) - itemOrder.indexOf(b.item),
  );
}

function ClearedLine({
  clearance,
  mine,
}: {
  clearance: ExitClearance;
  mine: boolean;
}) {
  const copy = mine ? text.mine : text.details;
  if (clearance.status === "pending")
    return <small className="exit-due">{copy.pendingNow}</small>;
  const who = clearance.clearedBy ?? "HR";
  const when = clearance.clearedAt ? day(clearance.clearedAt) : "";
  return (
    <small className="exit-muted">
      {clearance.status === "cleared"
        ? copy.clearedBy(who, when)
        : copy.waivedBy(who, when)}
    </small>
  );
}

function ClearanceBadge({ status }: { status: ExitClearance["status"] }) {
  return (
    <StatusBadge
      color={
        status === "cleared"
          ? "success"
          : status === "waived"
            ? "gray"
            : "warning"
      }
      size="sm"
      type="pill-color"
    >
      {text.clearanceStatus[status]}
    </StatusBadge>
  );
}

/* Employee view ---------------------------------------------------------- */

function EmployeeView() {
  const query = useMyExit(true);
  const [resigning, setResigning] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const header = (
    <PageHeader title={text.mine.title} description={text.mine.subtitle} />
  );
  if (query.error)
    return (
      <div className="page-enter exit-page">
        {header}
        <ErrorState
          message={query.error.message || text.mine.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  if (!query.data)
    return (
      <div className="page-enter exit-page">
        {header}
        <LoadingState />
      </div>
    );
  const { current, history } = query.data;
  return (
    <div className="page-enter exit-page">
      {header}
      {current ? (
        <MineCase detail={current} onWithdraw={() => setWithdrawing(true)} />
      ) : (
        <section
          className="panel exit-panel exit-intro"
          aria-labelledby="exit-intro-heading"
        >
          <div className="exit-intro-icon" aria-hidden="true">
            <DoorOpen size={28} />
          </div>
          <div className="exit-intro-body">
            <h2 id="exit-intro-heading">{text.mine.emptyTitle}</h2>
            <p>{text.mine.emptyBody}</p>
            <h3>{text.mine.whatHappens}</h3>
            <ol className="exit-how">
              {text.mine.stepsList.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <div className="exit-actions">
              <Button onPress={() => setResigning(true)}>
                {text.mine.submit}
              </Button>
            </div>
          </div>
        </section>
      )}
      <HelpNote />
      {history.length > 0 && (
        <section
          className="panel exit-panel"
          aria-labelledby="exit-history-heading"
        >
          <div className="panel-heading">
            <h2 id="exit-history-heading">{text.mine.historyHeading}</h2>
          </div>
          <ul className="exit-history">
            {history.map((item) => (
              <li key={item.id}>
                <div className="exit-history-main">
                  <strong>
                    {text.mine.historyEntry(
                      text.kinds[item.kind],
                      day(item.noticeGivenOn),
                    )}
                  </strong>
                  {item.decisionNote && (
                    <small className="exit-muted">
                      {text.mine.hrNote}: {item.decisionNote}
                    </small>
                  )}
                </div>
                <StatusPill status={item.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <ResignDialog open={resigning} onClose={() => setResigning(false)} />
      {current && (
        <WithdrawMineDialog
          item={current.case}
          open={withdrawing}
          onClose={() => setWithdrawing(false)}
        />
      )}
    </div>
  );
}

function HelpNote() {
  return (
    <aside className="exit-help" aria-labelledby="exit-help-heading">
      <h2 id="exit-help-heading">{text.help.title}</h2>
      <p>{text.help.body}</p>
    </aside>
  );
}

function MineCase({
  detail,
  onWithdraw,
}: {
  detail: ExitDetail;
  onWithdraw: () => void;
}) {
  const item = detail.case;
  return (
    <>
      <section
        className="panel exit-panel exit-current"
        aria-labelledby="exit-current-heading"
      >
        <div className="panel-heading exit-heading">
          <h2 id="exit-current-heading">{text.mine.currentHeading}</h2>
          <StatusPill status={item.status} />
        </div>
        <div className="exit-body">
          <Timeline item={item} />
          <dl className="exit-facts">
            <div>
              <dt>{text.mine.noticeOn}</dt>
              <dd>{day(item.noticeGivenOn)}</dd>
            </div>
            <div>
              <dt>{text.mine.lastDay}</dt>
              <dd>
                {item.lastWorkingDay
                  ? day(item.lastWorkingDay)
                  : text.mine.lastDayPending}
              </dd>
            </div>
            <div>
              <dt>{text.mine.reasonLabel}</dt>
              <dd>{item.reason}</dd>
            </div>
          </dl>
          {item.decisionNote && (
            <p className="exit-note">
              <strong>{text.mine.hrNote}</strong>
              {item.decisionNote}
            </p>
          )}
          {item.status === "submitted" ? (
            <div className="exit-actions">
              <Button variant="secondary" onPress={onWithdraw}>
                {text.mine.withdraw}
              </Button>
            </div>
          ) : (
            item.status === "accepted" && (
              <p className="exit-muted exit-ask">{text.mine.askHr}</p>
            )
          )}
        </div>
      </section>
      <section
        className="panel exit-panel"
        aria-labelledby="exit-checklist-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="exit-checklist-heading">{text.mine.clearancesHeading}</h2>
            <p>
              {item.status === "submitted"
                ? text.mine.clearancesWaiting
                : text.mine.clearancesIntro}
            </p>
          </div>
        </div>
        <ul className="exit-clearances">
          {sortedClearances(detail.clearances).map((clearance) => (
            <li key={clearance.id}>
              <div className="exit-clearance-main">
                <strong>{text.items[clearance.item].label}</strong>
                <small className="exit-muted">
                  {text.items[clearance.item].help}
                </small>
                {item.status !== "submitted" && (
                  <ClearedLine clearance={clearance} mine />
                )}
              </div>
              {item.status !== "submitted" && (
                <ClearanceBadge status={clearance.status} />
              )}
            </li>
          ))}
          {detail.clearances.length === 0 &&
            itemOrder.map((key) => (
              <li key={key}>
                <div className="exit-clearance-main">
                  <strong>{text.items[key].label}</strong>
                  <small className="exit-muted">{text.items[key].help}</small>
                </div>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

function ResignDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { run, busy, error, setError, client } = useExitRequest();
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(
      new FormData(event.currentTarget).get("reason") ?? "",
    ).trim();
    const next = await run(
      "/exits/mine",
      myExitSchema,
      { reason },
      text.resign.failed,
    );
    if (!next) return;
    client.setQueryData(["exits", "mine"], next);
    void client.invalidateQueries({ queryKey: ["exits", "list"] });
    onClose();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.resign.title}
      className="leave-modal exit-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.resign.intro}</p>
        <ReasonField
          id="exit-resign-reason"
          label={text.resign.reason}
          hint={text.resign.reasonHint}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.resign.submit}
          saving={text.resign.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

function ReasonField({
  label,
  hint,
}: {
  id: string;
  label: string;
  hint: string;
}) {
  const [length, setLength] = useState(0);
  return (
    <TextArea
      label={label}
      hint={`${hint} ${text.form.count(length)}`}
      name="reason"
      textAreaClassName="exit-note-input"
      isRequired
      hideRequiredIndicator
      minLength={3}
      maxLength={500}
      autoFocus
      onChange={(value: string) => setLength(value.length)}
    />
  );
}

function WithdrawMineDialog({
  item,
  open,
  onClose,
}: {
  item: ExitCase;
  open: boolean;
  onClose: () => void;
}) {
  const { run, busy, error, setError, client } = useExitRequest();
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const next = await run(
      `/exits/mine/${item.id}/withdraw`,
      myExitSchema,
      { version: item.version, ...(note ? { note } : {}) },
      text.withdrawMine.failed,
    );
    if (!next) return;
    client.setQueryData(["exits", "mine"], next);
    void client.invalidateQueries({ queryKey: ["exits", "list"] });
    onClose();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.withdrawMine.title}
      className="leave-modal exit-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.withdrawMine.intro}</p>
        <NoteField
          id="exit-withdraw-mine-note"
          label={text.withdrawMine.note}
          hint={text.form.noteOptionalHint}
          required={false}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.withdrawMine.submit}
          saving={text.withdrawMine.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

/* HR view ---------------------------------------------------------------- */

function ManageView() {
  const { reduceMotion } = usePreferences();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ExitStatus | "">("");
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, isPending, refetch } = useExits(true);
  const term = search.trim().toLowerCase();
  const filtered = Boolean(term || status);
  const items = (data?.items ?? []).filter(
    (item) =>
      (!status || item.status === status) &&
      (!term ||
        item.employeeName.toLowerCase().includes(term) ||
        item.employeeCode.toLowerCase().includes(term) ||
        item.reason.toLowerCase().includes(term)),
  );
  const counts = data?.counts;
  return (
    <div className="page-enter exit-page">
      <PageHeader
        title={text.title}
        description={text.subtitle}
        actions={
          <Button onPress={() => setStarting(true)}>
            <Plus size={18} weight="bold" />
            {text.start}
          </Button>
        }
      />
      <div className="exit-stats">
        <StatCard
          label={text.stats.open}
          value={(counts?.submitted ?? 0) + (counts?.accepted ?? 0)}
          hint={text.stats.openHint}
          icon={DoorOpen}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.awaiting}
          value={counts?.submitted ?? 0}
          hint={text.stats.awaitingHint}
          icon={Hourglass}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.clearance}
          value={counts?.accepted ?? 0}
          hint={text.stats.clearanceHint}
          icon={ListChecks}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.completed}
          value={counts?.completed ?? 0}
          hint={text.stats.completedHint}
          icon={SignOut}
          animate={!reduceMotion}
        />
      </div>
      <section className="panel exit-panel" aria-labelledby="exit-list-heading">
        <div className="panel-heading">
          <div>
            <h2 id="exit-list-heading">{text.list.heading}</h2>
            {data && <p aria-live="polite">{text.list.total(items.length)}</p>}
          </div>
        </div>
        <div className="directory-toolbar exit-toolbar">
          <Input
            aria-label={text.toolbar.searchLabel}
            placeholder={text.toolbar.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={search}
            onChange={setSearch}
            className="exit-search"
          />
          <div
            className="exit-chips"
            role="group"
            aria-label={text.toolbar.statusLabel}
          >
            <button
              type="button"
              className="exit-chip"
              aria-pressed={status === ""}
              onClick={() => setStatus("")}
            >
              {text.toolbar.all}
            </button>
            {statusKeys.map((key) => (
              <button
                key={key}
                type="button"
                className="exit-chip"
                aria-pressed={status === key}
                onClick={() => setStatus(status === key ? "" : key)}
              >
                {text.statusNames[key]}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <ErrorState
            message={error.message || text.list.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyBlock
              icon={DoorOpen}
              title={text.list.noMatchTitle}
              description={text.list.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    setSearch("");
                    setStatus("");
                  }}
                >
                  {text.list.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              icon={DoorOpen}
              title={text.list.emptyTitle}
              description={text.list.emptyBody}
            />
          )
        ) : (
          <ul className="exit-list">
            {items.map((item) => (
              <CaseRow
                key={item.id}
                item={item}
                onOpen={() => setOpenId(item.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <HelpNote />
      <StartDialog
        open={starting}
        onClose={() => setStarting(false)}
        onStarted={(detail) => {
          setStarting(false);
          setOpenId(detail.case.id);
        }}
      />
      <DetailsDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function CaseRow({ item, onOpen }: { item: ExitCase; onOpen: () => void }) {
  return (
    <li className="exit-row">
      <div className="exit-main">
        <div className="exit-title">
          <strong>{item.employeeName}</strong>
          <small className="exit-muted">{item.employeeCode}</small>
        </div>
        {item.department && (
          <small className="exit-muted">{item.department}</small>
        )}
        <div className="exit-meta">
          <StatusPill status={item.status} />
          <small>{text.kinds[item.kind]}</small>
          <small>{text.list.noticeOn(day(item.noticeGivenOn))}</small>
          <small>
            {item.lastWorkingDay
              ? text.list.lastDay(day(item.lastWorkingDay))
              : text.list.lastDayNone}
          </small>
        </div>
      </div>
      <Button
        variant="secondary"
        onPress={onOpen}
        aria-label={text.list.openLabel(item.employeeName)}
      >
        {text.list.open}
      </Button>
    </li>
  );
}

/* Start an exit ---------------------------------------------------------- */

function StartDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (detail: ExitDetail) => void;
}) {
  const { run, busy, error, setError, client } = useExitRequest();
  const [term, setTerm] = useState("");
  const [chosen, setChosen] = useState<{
    id: string;
    name: string;
    title: string;
  } | null>(null);
  const [kind, setKind] = useState<ExitKind>("resignation");
  const [missing, setMissing] = useState(false);
  const search = term.trim();
  const people = useDirectory(`q=${encodeURIComponent(search)}&limit=6`);
  const today = todayIso();
  function reset() {
    setTerm("");
    setChosen(null);
    setKind("resignation");
    setMissing(false);
    setError("");
  }
  function close() {
    if (busy) return;
    reset();
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) {
      setMissing(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    const detail = await run(
      "/exits",
      exitDetailSchema,
      {
        employeeId: chosen.id,
        kind,
        reason: String(form.get("reason") ?? "").trim(),
        noticeGivenOn: String(form.get("notice") ?? ""),
      },
      text.startDialog.failed,
    );
    if (!detail) return;
    client.setQueryData(["exits", "detail", detail.case.id], detail);
    await client.invalidateQueries({ queryKey: ["exits", "list"] });
    reset();
    onStarted(detail);
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.startDialog.title}
      className="leave-modal exit-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.startDialog.intro}</p>
        {chosen ? (
          <div className="exit-chosen">
            <span>
              <small>{text.startDialog.selected}</small>
              <strong>{chosen.name}</strong>
              <small>{chosen.title}</small>
            </span>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => setChosen(null)}
            >
              {text.startDialog.change}
            </Button>
          </div>
        ) : (
          <>
            <Input
              label={text.startDialog.find}
              hint={text.startDialog.findHint}
              autoComplete="off"
              maxLength={80}
              value={term}
              onChange={(value: string) => {
                setTerm(value);
                setMissing(false);
              }}
              autoFocus
            />
            {search && people.data && (
              <ul className="exit-people" aria-label={text.startDialog.results}>
                {people.data.items.length === 0 ? (
                  <li className="exit-muted">{text.startDialog.none}</li>
                ) : (
                  people.data.items.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setChosen({
                            id: person.id,
                            name: person.name,
                            title: person.title,
                          })
                        }
                      >
                        <UAvatar
                          size="sm"
                          initials={initialsOf(person.name)}
                          alt=""
                        />
                        <span className="exit-person-text">
                          <strong>{person.name}</strong>
                          <small>
                            {person.title} · {person.department}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            {missing && (
              <p role="alert" className="inline-error">
                {text.startDialog.needPerson}
              </p>
            )}
          </>
        )}
        <Select
          label={text.startDialog.kind}
          selectedKey={kind}
          onSelectionChange={(key) => setKind(String(key) as ExitKind)}
        >
          {kindKeys.map((key) => (
            <Select.Item key={key} id={key} label={text.kinds[key]} />
          ))}
        </Select>
        {open && (
          <>
            <ReasonField
              id="exit-start-reason"
              label={text.startDialog.reason}
              hint={text.startDialog.reasonHint}
            />
            <RangeInput
              label={text.startDialog.notice}
              hint={text.startDialog.noticeHint}
              name="notice"
              type="date"
              isRequired
              hideRequiredIndicator
              defaultValue={today}
              min={addDays(today, -90)}
              max={today}
            />
          </>
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.startDialog.submit}
          saving={text.startDialog.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

/* Details ---------------------------------------------------------------- */

type Action =
  | { kind: "accept" | "reject" | "withdraw" | "complete" }
  | { kind: "waive"; clearance: ExitClearance };

function DetailsDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, error, refetch } = useExit(id);
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const detail = data && data.case.id === id ? data : null;
  function close() {
    setAction(null);
    onClose();
  }
  // Called by every action after a successful save.
  function saved(next: ExitDetail) {
    client.setQueryData(["exits", "detail", next.case.id], next);
    void client.invalidateQueries({ queryKey: ["exits", "list"] });
    if (next.case.status === "completed") {
      // The person is now inactive, so people lists are out of date.
      void client.invalidateQueries({ queryKey: ["directory"] });
      void client.invalidateQueries({ queryKey: ["employee"] });
    }
    setAction(null);
  }
  return (
    <>
      <DialogPanel
        open={Boolean(id) && !action}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={text.details.title}
        className="leave-modal exit-modal"
      >
        {error ? (
          <ErrorState
            message={error.message || text.details.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : detail ? (
          <DetailBody detail={detail} onAction={setAction} onSaved={saved} />
        ) : (
          <LoadingState />
        )}
      </DialogPanel>
      {detail && (
        <ActionDialog
          detail={detail}
          action={action}
          onSaved={saved}
          onCancel={() => setAction(null)}
        />
      )}
    </>
  );
}

function DetailBody({
  detail,
  onAction,
  onSaved,
}: {
  detail: ExitDetail;
  onAction: (action: Action) => void;
  onSaved: (detail: ExitDetail) => void;
}) {
  const item = detail.case;
  const { run, busy, error } = useExitRequest();
  const [working, setWorking] = useState("");
  const clearances = sortedClearances(detail.clearances);
  const open = item.status === "accepted";
  const done = clearances.filter((c) => c.status !== "pending").length;
  const allDone = clearances.length === 5 && done === 5;
  const canComplete = open && allDone && detail.openAssets === 0;
  async function update(
    clearance: ExitClearance,
    status: "cleared" | "pending",
  ) {
    setWorking(clearance.id);
    const next = await run(
      `/exits/${item.id}/clearances/${clearance.id}`,
      exitDetailSchema,
      { version: clearance.version, status },
      text.details.clearFailed,
      "PUT",
    );
    setWorking("");
    if (next) onSaved(next);
  }
  return (
    <div className="exit-detail">
      <header className="exit-detail-head">
        <div className="exit-title">
          <strong>{item.employeeName}</strong>
          <small className="exit-muted">{item.employeeCode}</small>
        </div>
        <div className="exit-meta">
          <StatusPill status={item.status} />
          <small>{text.kinds[item.kind]}</small>
          {item.department && <small>{item.department}</small>}
        </div>
      </header>

      <Timeline item={item} />

      <section aria-labelledby="exit-facts" className="exit-section">
        <h3 id="exit-facts">{text.details.facts}</h3>
        <dl className="exit-facts">
          <div>
            <dt>{text.details.notice}</dt>
            <dd>{day(item.noticeGivenOn)}</dd>
          </div>
          <div>
            <dt>{text.details.lastDay}</dt>
            <dd>
              {item.lastWorkingDay
                ? day(item.lastWorkingDay)
                : text.details.lastDayNone}
            </dd>
          </div>
          <div>
            <dt>{text.details.submittedBy}</dt>
            <dd>{item.submittedBy}</dd>
          </div>
          <div className="exit-wide">
            <dt>{text.details.reason}</dt>
            <dd>{item.reason}</dd>
          </div>
          {item.decisionNote && (
            <div className="exit-wide">
              <dt>{text.details.decisionNote}</dt>
              <dd>{item.decisionNote}</dd>
            </div>
          )}
        </dl>
        {item.decidedAt && item.decidedBy && (
          <small className="exit-muted">
            {text.details.decidedBy(item.decidedBy, day(item.decidedAt))}
          </small>
        )}
        {item.closedAt && item.closedBy && (
          <small className="exit-muted">
            {text.details.closedBy(item.closedBy, day(item.closedAt))}
          </small>
        )}
      </section>

      <section aria-labelledby="exit-assets" className="exit-section">
        <h3 id="exit-assets">{text.details.assetsHeading}</h3>
        {detail.openAssets > 0 ? (
          <div className="exit-assets-open" role="status">
            <strong className="exit-assets-count">{detail.openAssets}</strong>
            <span>
              <strong>{text.details.assetsOpen(detail.openAssets)}</strong>
              <span id="exit-assets-blocked">{text.details.assetsBlocked}</span>
              <Link className="exit-link" to="/assets">
                {text.details.assetsLink}
              </Link>
            </span>
          </div>
        ) : (
          <p className="exit-muted">{text.details.assetsNone}</p>
        )}
      </section>

      <section aria-labelledby="exit-clearances" className="exit-section">
        <h3 id="exit-clearances">{text.details.clearances}</h3>
        {clearances.length === 0 ? (
          <p className="exit-muted">{text.details.clearancesWaiting}</p>
        ) : (
          <>
            <p className="exit-muted" aria-live="polite">
              {text.details.progress(done, clearances.length)}
              {!open && ` · ${text.details.clearancesLocked}`}
            </p>
            <ul className="exit-clearances">
              {clearances.map((clearance) => {
                const label = text.items[clearance.item].label;
                const blocked =
                  clearance.item === "assets" && detail.openAssets > 0;
                const rowBusy = busy && working === clearance.id;
                return (
                  <li key={clearance.id}>
                    <div className="exit-clearance-main">
                      <span className="exit-clearance-name">
                        <strong>{label}</strong>
                        <ClearanceBadge status={clearance.status} />
                      </span>
                      <small className="exit-muted">
                        {text.items[clearance.item].help}
                      </small>
                      <ClearedLine clearance={clearance} mine={false} />
                      {clearance.note && (
                        <small className="exit-muted">
                          {text.details.noteLabel(clearance.note)}
                        </small>
                      )}
                      {blocked && (
                        <small
                          className="exit-due"
                          id={`exit-blocked-${clearance.id}`}
                        >
                          {text.details.blockedReason}
                        </small>
                      )}
                    </div>
                    {open && (
                      <div className="exit-clearance-actions">
                        {clearance.status === "pending" ? (
                          <>
                            <Button
                              variant="secondary"
                              isDisabled={busy || blocked}
                              aria-label={text.details.clearLabel(label)}
                              aria-describedby={
                                blocked
                                  ? `exit-blocked-${clearance.id}`
                                  : undefined
                              }
                              onPress={() => void update(clearance, "cleared")}
                            >
                              {rowBusy ? "…" : text.details.clear}
                            </Button>
                            <Button
                              variant="secondary"
                              isDisabled={busy || blocked}
                              aria-label={text.details.waiveLabel(label)}
                              aria-describedby={
                                blocked
                                  ? `exit-blocked-${clearance.id}`
                                  : undefined
                              }
                              onPress={() =>
                                onAction({ kind: "waive", clearance })
                              }
                            >
                              {text.details.waive}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            isDisabled={busy}
                            aria-label={text.details.reopenLabel(label)}
                            onPress={() => void update(clearance, "pending")}
                          >
                            {rowBusy ? "…" : text.details.reopen}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <FormError message={error} />

      {(item.status === "submitted" || item.status === "accepted") && (
        <section aria-labelledby="exit-decide" className="exit-section">
          <h3 id="exit-decide">{text.details.actions}</h3>
          <div className="exit-actions">
            {item.status === "submitted" && (
              <>
                <Button onPress={() => onAction({ kind: "accept" })}>
                  {text.details.accept}
                </Button>
                <Button
                  variant="secondary"
                  onPress={() => onAction({ kind: "reject" })}
                >
                  {text.details.reject}
                </Button>
              </>
            )}
            {item.status === "accepted" && (
              <Button
                isDisabled={!canComplete}
                aria-describedby="exit-complete-why"
                onPress={() => onAction({ kind: "complete" })}
              >
                {text.details.complete}
              </Button>
            )}
            <Button
              variant="secondary"
              onPress={() => onAction({ kind: "withdraw" })}
            >
              {text.details.withdraw}
            </Button>
          </div>
          {item.status === "accepted" && !canComplete && (
            <p className="exit-hint" id="exit-complete-why">
              {detail.openAssets > 0
                ? text.details.completeBlockedAssets
                : text.details.completeBlocked}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/* Action dialogs --------------------------------------------------------- */

function ActionDialog({
  detail,
  action,
  onSaved,
  onCancel,
}: {
  detail: ExitDetail;
  action: Action | null;
  onSaved: (detail: ExitDetail) => void;
  onCancel: () => void;
}) {
  const item = detail.case;
  const title =
    action?.kind === "accept"
      ? text.accept.title
      : action?.kind === "reject"
        ? text.reject.title
        : action?.kind === "withdraw"
          ? text.withdrawHr.title
          : action?.kind === "complete"
            ? text.complete.title
            : action?.kind === "waive"
              ? text.waiveDialog.title
              : "";
  return (
    <DialogPanel
      open={Boolean(action)}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title}
      className="leave-modal exit-modal"
    >
      {action?.kind === "accept" && (
        <AcceptForm item={item} onSaved={onSaved} onCancel={onCancel} />
      )}
      {action?.kind === "reject" && (
        <NoteForm
          path={`/exits/${item.id}/reject`}
          version={item.version}
          intro={text.reject.intro(item.employeeName)}
          label={text.reject.note}
          hint={text.reject.noteHint}
          required
          submit={text.reject.submit}
          saving={text.reject.saving}
          failed={text.reject.failed}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
      {action?.kind === "withdraw" && (
        <NoteForm
          path={`/exits/${item.id}/withdraw`}
          version={item.version}
          intro={
            item.status === "accepted"
              ? text.withdrawHr.introAccepted
              : text.withdrawHr.introSubmitted
          }
          label={
            item.status === "accepted"
              ? text.withdrawHr.note
              : text.form.noteOptional
          }
          hint={
            item.status === "accepted"
              ? text.withdrawHr.noteHint
              : text.form.noteOptionalHint
          }
          required={item.status === "accepted"}
          differFrom={item.status === "accepted" ? item.decisionNote : null}
          submit={text.withdrawHr.submit}
          saving={text.withdrawHr.saving}
          failed={text.withdrawHr.failed}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
      {action?.kind === "waive" && (
        <NoteForm
          path={`/exits/${item.id}/clearances/${action.clearance.id}`}
          method="PUT"
          version={action.clearance.version}
          extra={{ status: "waived" }}
          intro={text.waiveDialog.intro(
            text.items[action.clearance.item].label,
          )}
          label={text.waiveDialog.note}
          hint={text.waiveDialog.noteHint}
          required
          maxLength={300}
          submit={text.waiveDialog.submit}
          saving={text.waiveDialog.saving}
          failed={text.waiveDialog.failed}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
      {action?.kind === "complete" && (
        <CompleteForm item={item} onSaved={onSaved} onCancel={onCancel} />
      )}
    </DialogPanel>
  );
}

type FormProps = {
  onSaved: (detail: ExitDetail) => void;
  onCancel: () => void;
};

/** One note, then one request. Used to reject, withdraw and waive. */
function NoteForm({
  path,
  method = "POST",
  version,
  extra,
  intro,
  label,
  hint,
  required,
  maxLength = 500,
  differFrom = null,
  submit,
  saving,
  failed,
  onSaved,
  onCancel,
}: FormProps & {
  differFrom?: string | null;
  path: string;
  method?: "POST" | "PUT";
  version: number;
  extra?: Record<string, string>;
  intro: string;
  label: string;
  hint: string;
  required: boolean;
  maxLength?: number;
  submit: string;
  saving: string;
  failed: string;
}) {
  const { run, busy, error, setError } = useExitRequest();
  const [length, setLength] = useState(0);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    if (differFrom && note.toLowerCase() === differFrom.trim().toLowerCase()) {
      setError(text.errors.sameNote);
      return;
    }
    const next = await run(
      path,
      exitDetailSchema,
      { version, ...extra, ...(note ? { note } : {}) },
      failed,
      method,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void send(event)}>
      <p>{intro}</p>
      <TextArea
        label={label}
        hint={`${hint} ${length} of ${maxLength} characters.`}
        name="note"
        textAreaClassName="exit-note-input"
        isRequired={required}
        hideRequiredIndicator
        minLength={3}
        maxLength={maxLength}
        autoFocus
        onChange={(value: string) => setLength(value.length)}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={submit}
        saving={saving}
        onCancel={onCancel}
      />
    </form>
  );
}

function AcceptForm({
  item,
  onSaved,
  onCancel,
}: FormProps & { item: ExitCase }) {
  const { run, busy, error } = useExitRequest();
  const min = item.noticeGivenOn;
  const max = addDays(item.noticeGivenOn, 180);
  const suggested = addDays(item.noticeGivenOn, 30);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = String(form.get("note") ?? "").trim();
    const next = await run(
      `/exits/${item.id}/accept`,
      exitDetailSchema,
      {
        version: item.version,
        lastWorkingDay: String(form.get("lastDay") ?? ""),
        ...(note ? { note } : {}),
      },
      text.accept.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.accept.intro(item.employeeName)}</p>
      <RangeInput
        label={text.accept.lastDay}
        hint={text.accept.lastDayHint(day(min), day(max))}
        name="lastDay"
        type="date"
        isRequired
        hideRequiredIndicator
        defaultValue={suggested}
        min={min}
        max={max}
        autoFocus
      />
      <NoteField
        id="exit-accept-note"
        label={text.accept.note}
        hint={text.form.noteOptionalHint}
        required={false}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.accept.submit}
        saving={text.accept.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

function CompleteForm({
  item,
  onSaved,
  onCancel,
}: FormProps & { item: ExitCase }) {
  const { run, busy, error } = useExitRequest();
  const [early, setEarly] = useState(false);
  const before =
    item.lastWorkingDay !== null && todayIso() < item.lastWorkingDay;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const next = await run(
      `/exits/${item.id}/complete`,
      exitDetailSchema,
      early && before
        ? { version: item.version, earlyRelease: true, note }
        : { version: item.version },
      text.complete.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.complete.intro(item.employeeName)}</p>
      <p className="exit-muted">{text.complete.external}</p>
      {before && item.lastWorkingDay && (
        <>
          <Checkbox
            isSelected={early}
            onChange={setEarly}
            label={text.complete.early}
            hint={text.complete.earlyHint(day(item.lastWorkingDay))}
          />
          {early && (
            <NoteField
              id="exit-early-note"
              label={text.complete.earlyNote}
              hint={text.complete.earlyNoteHint}
              required
              autoFocus
            />
          )}
        </>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.complete.submit}
        saving={text.complete.saving}
        onCancel={onCancel}
      />
    </form>
  );
}
