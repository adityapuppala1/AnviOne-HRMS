import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { IdentificationCard } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ProhibitInset } from "@phosphor-icons/react/dist/csr/ProhibitInset";
import { Timer } from "@phosphor-icons/react/dist/csr/Timer";
import {
  Button,
  CollectionView,
  DetailFields,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  RangeInput,
  StatCard,
  StatusBadge,
  UTabs,
  TextArea,
} from "@anvi/ui";
import {
  profileFieldFormats,
  type ProfileChangeRequest,
  type ProfileChangeStatus,
  type ProfileDetails,
  type ProfileField,
} from "@anvi/contracts";
import {
  ApiError,
  mutate,
  useMyProfile,
  useProfileRequest,
  useProfileRequests,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { detailsCopy as text } from "../lib/copy/details";
import { useWorkspace } from "./workspace";
// Shared dialog form styles come from the leave screen.
import "./leave.css";
import "./details.css";

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
  ProfileChangeStatus,
  "gray" | "brand" | "error" | "warning" | "success"
> = {
  submitted: "warning",
  approved: "brand",
  applied: "success",
  rejected: "error",
  withdrawn: "gray",
};
const statusKeys = Object.keys(text.statusNames) as ProfileChangeStatus[];

function StatusPill({ status }: { status: ProfileChangeStatus }) {
  return (
    <StatusBadge color={statusColor[status]} size="sm" type="pill-color">
      {text.statusNames[status]}
    </StatusBadge>
  );
}

const labelList = (fields: ProfileField[]) =>
  fields.map((field) => text.fields[field].label).join(", ");

export default function Details() {
  const { me } = useWorkspace();
  const canSelf = me.permissions.includes("profile.self");
  const canReview = me.permissions.includes("profile.review");
  const [tab, setTab] = useState<"mine" | "review">(
    canSelf ? "mine" : "review",
  );
  if (!canSelf && !canReview) return <ErrorState message={text.denied} />;
  if (canSelf && canReview)
    return (
      <UTabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key) as "mine" | "review")}
      >
        <UTabs.List
          type="underline"
          aria-label={text.tabs.label}
          className="details-tabs"
        >
          <UTabs.Item id="mine">{text.tabs.mine}</UTabs.Item>
          <UTabs.Item id="review">{text.tabs.review}</UTabs.Item>
        </UTabs.List>
        <UTabs.Panel id="mine">
          <MineView />
        </UTabs.Panel>
        <UTabs.Panel id="review">
          <ReviewView />
        </UTabs.Panel>
      </UTabs>
    );
  return canSelf ? <MineView /> : <ReviewView />;
}

/* Shared helpers --------------------------------------------------------- */

function useProfileRequestRunner() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Runs one write. Error text never includes anything the user typed. */
  async function run(
    path: string,
    body: unknown,
    fallback: string,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await mutate(path, me.csrfToken, body);
      await client.invalidateQueries({ queryKey: ["profile"] });
      return true;
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 403)
          setError(
            me.permissions.includes("profile.review")
              ? text.errors.ownRequest
              : text.errors.forbidden,
          );
        else if (cause.status === 409) {
          setError(text.errors.stale);
          // Show whatever is newest.
          void client.invalidateQueries({ queryKey: ["profile"] });
        } else
          setError(
            cause.status === 400 && cause.message ? cause.message : fallback,
          );
      } else setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}

function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="inline-error">
      {message}
    </p>
  ) : null;
}

function FormActions({
  busy,
  submit,
  saving,
  onCancel,
  cancelLabel = text.form.cancel,
}: {
  busy: boolean;
  submit: string;
  saving: string;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="submit" isDisabled={busy}>
        {busy ? saving : submit}
      </Button>
    </div>
  );
}

/** A note, 3 to 500 characters, with a live count. */
function NoteField({
  label,
  hint,
  required,
}: {
  label: string;
  hint: string;
  required: boolean;
}) {
  const [length, setLength] = useState(0);
  return (
    <TextArea
      label={label}
      hint={`${hint} ${text.form.count(length)}`}
      name="note"
      textAreaClassName="details-note-input"
      isRequired={required}
      hideRequiredIndicator
      minLength={3}
      maxLength={500}
      onChange={(value: string) => setLength(value.length)}
    />
  );
}

/* Employee view ---------------------------------------------------------- */

function MineView() {
  const query = useMyProfile(true);
  const [asking, setAsking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const header = (
    <PageHeader
      title={text.mine.title}
      description={text.mine.subtitle}
      actions={
        query.data && (
          <Button onPress={() => setAsking(true)}>{text.mine.request}</Button>
        )
      }
    />
  );
  if (query.error)
    return (
      <div className="page-enter details-page">
        {header}
        <ErrorState
          message={query.error.message || text.mine.loadFailed}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  if (!query.data)
    return (
      <div className="page-enter details-page">
        {header}
        <LoadingState />
      </div>
    );
  const { profile, open, requests, history } = query.data;
  const recent = requests.filter((item) => item.id !== open?.id);
  const changeText = (entry: (typeof history)[number]) =>
    entry.unavailable
      ? text.history.unavailable
      : text.history.changed(
          entry.oldValue ?? text.history.empty_value,
          entry.newValue ?? text.history.empty_value,
        );
  return (
    <div className="page-enter details-page">
      {header}
      {open && (
        <OpenRequest request={open} onWithdraw={() => setWithdrawing(true)} />
      )}
      <section aria-labelledby="details-now" className="details-section">
        <div className="details-section-head">
          <h2 id="details-now">{text.mine.currentHeading}</h2>
          <p className="details-muted">
            {profile.updatedAt
              ? text.mine.updated(day(profile.updatedAt), profile.updatedBy)
              : text.mine.neverUpdated}
          </p>
        </div>
        <div className="details-grid">
          {text.groups.map((group) => (
            <article
              key={group.key}
              className="panel details-card"
              aria-labelledby={`details-group-${group.key}`}
            >
              <h3 id={`details-group-${group.key}`}>{group.title}</h3>
              <dl className="details-list">
                {group.fields.map((field) => (
                  <ValueRow key={field} field={field} profile={profile} />
                ))}
              </dl>
            </article>
          ))}
        </div>
        <p className="details-note">{text.mine.privacy}</p>
      </section>
      {recent.length > 0 && (
        <section
          className="panel details-panel"
          aria-labelledby="details-recent"
        >
          <div className="panel-heading">
            <h2 id="details-recent">{text.recent.heading}</h2>
          </div>
          <CollectionView
            id="details-recent"
            label={text.recent.heading}
            noun="requests"
            items={recent}
            getKey={(item) => item.id}
            columns={[
              {
                id: "fields",
                label: "Changing",
                isRowHeader: true,
                render: (item) => labelList(item.fields),
              },
              {
                id: "sent",
                label: "Sent",
                sortValue: (item) => item.createdAt,
                render: (item) => day(item.createdAt),
              },
              {
                id: "effective",
                label: "Effective",
                sortValue: (item) => item.effectiveOn,
                render: (item) => day(item.effectiveOn),
              },
              {
                id: "status",
                label: "Status",
                render: (item) => <StatusPill status={item.status} />,
              },
            ]}
            renderCard={(item) => (
              <div className="details-row-main">
                <strong>{labelList(item.fields)}</strong>
                <small className="details-muted">
                  {text.recent.sent(day(item.createdAt))} ·{" "}
                  {text.recent.effective(day(item.effectiveOn))}
                </small>
                <StatusPill status={item.status} />
              </div>
            )}
            detail={{
              title: (item) => labelList(item.fields),
              subtitle: (item) => <StatusPill status={item.status} />,
              body: (item) => (
                <DetailFields
                  fields={[
                    { label: "Sent", value: day(item.createdAt) },
                    { label: "Effective", value: day(item.effectiveOn) },
                    {
                      label: text.open.note,
                      value:
                        item.status === "rejected" ||
                        item.status === "withdrawn"
                          ? item.decisionNote
                          : undefined,
                    },
                  ]}
                />
              ),
            }}
          />
        </section>
      )}
      <section
        className="panel details-panel"
        aria-labelledby="details-history"
      >
        <div className="panel-heading">
          <div>
            <h2 id="details-history">{text.history.heading}</h2>
            <p>{text.history.intro}</p>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="details-muted details-pad">{text.history.empty}</p>
        ) : (
          <CollectionView
            id="details-history"
            label={text.history.heading}
            noun="changes"
            items={history}
            getKey={(entry) => entry.id}
            columns={[
              {
                id: "field",
                label: "Field",
                isRowHeader: true,
                sortValue: (entry) => text.fields[entry.field].label,
                render: (entry) => text.fields[entry.field].label,
              },
              {
                id: "change",
                label: "Change",
                render: (entry) => changeText(entry),
              },
              {
                id: "effective",
                label: "Effective",
                sortValue: (entry) => entry.effectiveOn,
                render: (entry) => day(entry.effectiveOn),
              },
              {
                id: "applied",
                label: "Applied",
                sortValue: (entry) => entry.appliedAt,
                render: (entry) =>
                  text.history.applied(day(entry.appliedAt), entry.approvedBy),
              },
            ]}
            renderCard={(entry) => (
              <div className="details-row-main">
                <strong>{text.fields[entry.field].label}</strong>
                <span className="details-change">{changeText(entry)}</span>
                <small className="details-muted">
                  {text.history.effective(day(entry.effectiveOn))} ·{" "}
                  {text.history.applied(day(entry.appliedAt), entry.approvedBy)}
                </small>
              </div>
            )}
            detail={{
              title: (entry) => text.fields[entry.field].label,
              subtitle: (entry) => changeText(entry),
              body: (entry) => (
                <DetailFields
                  fields={[
                    { label: "Effective", value: day(entry.effectiveOn) },
                    {
                      label: "Applied",
                      value: text.history.applied(
                        day(entry.appliedAt),
                        entry.approvedBy,
                      ),
                    },
                  ]}
                />
              ),
            }}
          />
        )}
      </section>
      <RequestDialog
        open={asking}
        profile={profile}
        onClose={() => setAsking(false)}
      />
      {open && (
        <WithdrawDialog
          request={open}
          open={withdrawing}
          onClose={() => setWithdrawing(false)}
        />
      )}
    </div>
  );
}

function ValueRow({
  field,
  profile,
}: {
  field: ProfileField;
  profile: ProfileDetails;
}) {
  const value = profile[field];
  const unavailable = profile.unavailable.includes(field);
  return (
    <div>
      <dt>{text.fields[field].label}</dt>
      <dd>
        {unavailable ? (
          <span className="details-unavailable">{text.mine.unavailable}</span>
        ) : value ? (
          value
        ) : (
          <span className="details-empty">{text.mine.notProvided}</span>
        )}
      </dd>
    </div>
  );
}

function OpenRequest({
  request,
  onWithdraw,
}: {
  request: ProfileChangeRequest;
  onWithdraw: () => void;
}) {
  const approved = request.status === "approved";
  const steps = [
    { key: "submitted", label: text.open.steps.submitted, state: "done" },
    {
      key: "approved",
      label: text.open.steps.approved,
      state: approved ? "done" : "current",
    },
    {
      key: "applied",
      label: text.open.steps.applied,
      state: approved ? "current" : "next",
    },
  ];
  return (
    <section
      className="panel details-panel details-open"
      aria-labelledby="details-open"
    >
      <div className="panel-heading details-heading">
        <h2 id="details-open">{text.open.heading}</h2>
        <StatusPill status={request.status} />
      </div>
      <div className="details-body">
        <ol className="details-steps" aria-label={text.open.steps.heading}>
          {steps.map((step, index) => (
            <li
              key={step.key}
              className="details-step"
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span className="details-marker" aria-hidden="true">
                {step.state === "done" ? (
                  <Check size={14} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="details-step-text">
                <strong>{step.label}</strong>
                <small>
                  {step.state === "done"
                    ? text.open.steps.done
                    : step.state === "current"
                      ? text.open.steps.current
                      : text.open.steps.next}
                </small>
              </span>
            </li>
          ))}
        </ol>
        <p className="details-callout" role="status">
          {approved
            ? text.open.approvedWaiting(
                day(request.effectiveOn),
                request.decidedBy,
              )
            : text.open.waitingHr}
        </p>
        {approved && <p className="details-muted">{text.open.applyHow}</p>}
        {request.changes && (
          <div>
            <h3 className="details-subhead">{text.open.willChange}</h3>
            <ul className="details-rows details-inner">
              {request.changes.map((change) => (
                <li key={change.field}>
                  <div className="details-row-main">
                    <strong>{text.fields[change.field].label}</strong>
                    <span className="details-change">
                      {change.unavailable
                        ? text.mine.unavailable
                        : (change.value ?? text.open.cleared)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="details-facts">
          <div>
            <dt>{text.open.effective}</dt>
            <dd>{day(request.effectiveOn)}</dd>
          </div>
          <div>
            <dt>{text.open.submitted}</dt>
            <dd>{day(request.createdAt)}</dd>
          </div>
          {request.reason && (
            <div className="details-wide">
              <dt>{text.open.reason}</dt>
              <dd>{request.reason}</dd>
            </div>
          )}
        </dl>
        {request.canWithdraw && (
          <div className="details-actions">
            <Button variant="secondary" onPress={onWithdraw}>
              {text.open.withdraw}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/* Request a change ------------------------------------------------------- */

const allFields = text.groups.flatMap(
  (group) => group.fields,
) as ProfileField[];

function RequestDialog({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: ProfileDetails;
  onClose: () => void;
}) {
  const { run, busy, error, setError } = useProfileRequestRunner();
  const today = todayIso();
  const initial = () =>
    Object.fromEntries(
      allFields.map((field) => [field, profile[field] ?? ""]),
    ) as Record<ProfileField, string>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [problems, setProblems] = useState<
    Partial<Record<ProfileField | "reason" | "date", string>>
  >({});
  function reset() {
    setValues(initial());
    setReason("");
    setEffectiveOn(todayIso());
    setProblems({});
    setError("");
  }
  function close() {
    if (busy) return;
    reset();
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof problems = {};
    const changes: { field: ProfileField; value: string | null }[] = [];
    for (const field of allFields) {
      const next = values[field].trim();
      const current = profile[field];
      const unknown = profile.unavailable.includes(field);
      // An unreadable current value starts empty: empty means "unchanged".
      if (unknown && !next) continue;
      if (!unknown && next === (current ?? "")) continue;
      if (!next) {
        changes.push({ field, value: null });
        continue;
      }
      if (!profileFieldFormats[field].safeParse(next).success)
        found[field] = text.requestDialog.invalidField(
          text.fields[field].label,
        );
      else changes.push({ field, value: next });
    }
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) found.reason = text.requestDialog.reasonShort;
    if (effectiveOn < today || effectiveOn > addDays(today, 90))
      found.date = text.requestDialog.dateRange;
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setError(text.requestDialog.fieldsInvalid);
      return;
    }
    if (changes.length === 0) {
      setError(text.requestDialog.nothing);
      return;
    }
    const ok = await run(
      "/profile/mine/requests",
      { changes, reason: cleanReason, effectiveOn },
      text.requestDialog.failed,
    );
    if (!ok) return;
    reset();
    onClose();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.requestDialog.title}
      className="leave-modal details-modal"
    >
      <form
        className="leave-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <p>{text.requestDialog.intro}</p>
        {text.groups.map((group) => (
          <fieldset key={group.key} className="details-fieldset">
            <legend>{group.title}</legend>
            {group.fields.map((field) => {
              const copy = text.fields[field];
              const unknown = profile.unavailable.includes(field);
              return (
                <Input
                  key={field}
                  label={copy.label}
                  hint={
                    problems[field] ??
                    (unknown ? text.requestDialog.currentUnknown : copy.hint)
                  }
                  isInvalid={Boolean(problems[field])}
                  type={copy.type}
                  autoComplete={copy.autoComplete}
                  maxLength={copy.maxLength}
                  value={values[field]}
                  onChange={(value: string) => {
                    setValues((all) => ({ ...all, [field]: value }));
                    setProblems((all) => ({ ...all, [field]: undefined }));
                  }}
                />
              );
            })}
          </fieldset>
        ))}
        <TextArea
          label={text.requestDialog.reason}
          hint={problems.reason ?? text.requestDialog.reasonHint}
          isInvalid={Boolean(problems.reason)}
          textAreaClassName="details-note-input"
          maxLength={500}
          value={reason}
          onChange={(value: string) => {
            setReason(value);
            setProblems((all) => ({ ...all, reason: undefined }));
          }}
        />
        <RangeInput
          label={text.requestDialog.effective}
          hint={problems.date ?? text.requestDialog.effectiveHint}
          isInvalid={Boolean(problems.date)}
          type="date"
          min={today}
          max={addDays(today, 90)}
          value={effectiveOn}
          onChange={(value: string) => {
            setEffectiveOn(value);
            setProblems((all) => ({ ...all, date: undefined }));
          }}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.requestDialog.submit}
          saving={text.requestDialog.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

function WithdrawDialog({
  request,
  open,
  onClose,
}: {
  request: ProfileChangeRequest;
  open: boolean;
  onClose: () => void;
}) {
  const { run, busy, error, setError } = useProfileRequestRunner();
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(
      `/profile/mine/requests/${request.id}/withdraw`,
      { version: request.version },
      text.withdrawDialog.failed,
    );
    if (ok) onClose();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.withdrawDialog.title}
      className="leave-modal details-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.withdrawDialog.intro}</p>
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.withdrawDialog.submit}
          saving={text.withdrawDialog.saving}
          onCancel={close}
          cancelLabel={text.form.back}
        />
      </form>
    </DialogPanel>
  );
}

/* HR view ---------------------------------------------------------------- */

function ReviewView() {
  const { me } = useWorkspace();
  const { reduceMotion } = usePreferences();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProfileChangeStatus | "">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{
    text: string;
    failed: boolean;
  } | null>(null);
  const { data, error, isPending, refetch } = useProfileRequests(true);
  const term = search.trim().toLowerCase();
  const filtered = Boolean(term || status);
  const items = (data?.items ?? []).filter(
    (item) =>
      (!status || item.status === status) &&
      (!term ||
        item.employeeName.toLowerCase().includes(term) ||
        item.employeeCode.toLowerCase().includes(term)),
  );
  const counts = data?.counts;
  async function applyDue() {
    setApplying(true);
    setApplyMessage(null);
    try {
      const result = (await mutate("/profile/apply-due", me.csrfToken, {})) as {
        applied?: unknown;
      };
      const applied = typeof result?.applied === "number" ? result.applied : 0;
      setApplyMessage({
        text:
          applied > 0 ? text.review.applyDone(applied) : text.review.applyNone,
        failed: false,
      });
      await client.invalidateQueries({ queryKey: ["profile"] });
    } catch (cause) {
      setApplyMessage({
        text:
          cause instanceof ApiError && cause.status === 403
            ? text.errors.forbidden
            : text.review.applyFailed,
        failed: true,
      });
    } finally {
      setApplying(false);
    }
  }
  return (
    <div className="page-enter details-page">
      <PageHeader
        title={text.review.title}
        description={text.review.subtitle}
        actions={
          <Button
            variant="secondary"
            isDisabled={applying}
            onPress={() => void applyDue()}
          >
            {applying ? text.review.applying : text.review.applyDue}
          </Button>
        }
      />
      <p className="details-muted details-apply-hint">
        {text.review.applyHint}
      </p>
      {applyMessage && (
        <p
          role={applyMessage.failed ? "alert" : "status"}
          className={applyMessage.failed ? "inline-error" : "details-callout"}
        >
          {applyMessage.text}
        </p>
      )}
      <div className="details-stats">
        <StatCard
          label={text.review.stats.waiting}
          value={counts?.submitted ?? 0}
          hint={text.review.stats.waitingHint}
          icon={Hourglass}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.review.stats.approved}
          value={counts?.approved ?? 0}
          hint={text.review.stats.approvedHint}
          icon={Timer}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.review.stats.applied}
          value={counts?.applied ?? 0}
          hint={text.review.stats.appliedHint}
          icon={CheckCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.review.stats.closed}
          value={(counts?.rejected ?? 0) + (counts?.withdrawn ?? 0)}
          hint={text.review.stats.closedHint}
          icon={ProhibitInset}
          animate={!reduceMotion}
        />
      </div>
      <section
        className="panel details-panel"
        aria-labelledby="details-list-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="details-list-heading">{text.review.list.heading}</h2>
            {data && (
              <p aria-live="polite">{text.review.list.total(items.length)}</p>
            )}
          </div>
        </div>
        <div className="directory-toolbar details-toolbar">
          <Input
            aria-label={text.review.list.searchLabel}
            placeholder={text.review.list.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={search}
            onChange={setSearch}
            className="details-search"
          />
          <div
            className="details-chips"
            role="group"
            aria-label={text.review.list.statusLabel}
          >
            <button
              type="button"
              className="details-chip"
              aria-pressed={status === ""}
              onClick={() => setStatus("")}
            >
              {text.review.list.all}
            </button>
            {statusKeys.map((key) => (
              <button
                key={key}
                type="button"
                className="details-chip"
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
            message={error.message || text.review.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyBlock
              icon={IdentificationCard}
              title={text.review.list.noMatchTitle}
              description={text.review.list.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    setSearch("");
                    setStatus("");
                  }}
                >
                  {text.review.list.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              icon={IdentificationCard}
              title={text.review.list.emptyTitle}
              description={text.review.list.emptyBody}
            />
          )
        ) : (
          <CollectionView
            id="details-review"
            label={text.review.list.total(items.length)}
            noun="requests"
            items={items}
            getKey={(item) => item.id}
            onOpen={(item) => setOpenId(item.id)}
            defaultView="table"
            columns={[
              {
                id: "employee",
                label: "Employee",
                isRowHeader: true,
                sortValue: (item) => item.employeeName.toLowerCase(),
                render: (item) => (
                  <div className="details-title">
                    <strong>{item.employeeName}</strong>
                    <small className="details-muted">{item.employeeCode}</small>
                  </div>
                ),
              },
              {
                id: "changing",
                label: "Changing",
                render: (item) => labelList(item.fields),
              },
              {
                id: "status",
                label: "Status",
                render: (item) => <StatusPill status={item.status} />,
              },
              {
                id: "effective",
                label: "Effective",
                sortValue: (item) => item.effectiveOn,
                render: (item) => day(item.effectiveOn),
              },
              {
                id: "submitted",
                label: "Submitted",
                sortValue: (item) => item.createdAt,
                render: (item) => day(item.createdAt),
              },
              {
                id: "open",
                label: "",
                render: (item) => (
                  <Button
                    variant="secondary"
                    onPress={() => setOpenId(item.id)}
                    aria-label={text.review.list.openLabel(item.employeeName)}
                  >
                    {text.review.list.open}
                  </Button>
                ),
              },
            ]}
            renderCard={(item) => (
              <div className="details-request">
                <div className="details-row-main">
                  <div className="details-title">
                    <strong>{item.employeeName}</strong>
                    <small className="details-muted">{item.employeeCode}</small>
                  </div>
                  <span>
                    {text.review.list.changing(labelList(item.fields))}
                  </span>
                  <div className="details-meta">
                    <StatusPill status={item.status} />
                    <small>
                      {text.review.list.effective(day(item.effectiveOn))}
                    </small>
                    <small>
                      {text.review.list.submitted(day(item.createdAt))}
                    </small>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onPress={() => setOpenId(item.id)}
                  aria-label={text.review.list.openLabel(item.employeeName)}
                >
                  {text.review.list.open}
                </Button>
              </div>
            )}
          />
        )}
      </section>
      <RequestDetails id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/* Request details -------------------------------------------------------- */

type Decision = "reject" | "cancel";

function RequestDetails({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, error, refetch } = useProfileRequest(id);
  const [decision, setDecision] = useState<Decision | null>(null);
  const request = data && data.id === id ? data : null;
  function close() {
    setDecision(null);
    onClose();
  }
  return (
    <>
      <DialogPanel
        open={Boolean(id) && !decision}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={text.detail.title}
        className="leave-modal details-modal"
      >
        {error ? (
          <ErrorState
            message={error.message || text.detail.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : request ? (
          <DetailBody
            request={request}
            onDecision={setDecision}
            onDone={close}
          />
        ) : (
          <LoadingState />
        )}
      </DialogPanel>
      {request && (
        <NoteDialog
          request={request}
          decision={decision}
          onDone={close}
          onBack={() => setDecision(null)}
        />
      )}
    </>
  );
}

function DetailBody({
  request,
  onDecision,
  onDone,
}: {
  request: ProfileChangeRequest;
  onDecision: (decision: Decision) => void;
  onDone: () => void;
}) {
  const { run, busy, error } = useProfileRequestRunner();
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const ok = await run(
      `/profile/requests/${request.id}/approve`,
      { version: request.version, ...(note ? { note } : {}) },
      text.detail.failed,
    );
    if (ok) onDone();
  }
  return (
    <div className="details-detail">
      <header className="details-detail-head">
        <div className="details-title">
          <strong>{request.employeeName}</strong>
          <small className="details-muted">{request.employeeCode}</small>
        </div>
        <StatusPill status={request.status} />
      </header>
      <p className="details-callout">{text.detail.auditNote}</p>
      <section aria-labelledby="details-changes" className="details-section">
        <h3 id="details-changes" className="details-subhead">
          {text.detail.changes}
        </h3>
        <ul className="details-rows details-inner">
          {(request.changes ?? []).map((change) => (
            <li key={change.field}>
              <div className="details-row-main">
                <strong>{text.fields[change.field].label}</strong>
                <span className="details-change">
                  <small className="details-muted">
                    {text.detail.newValue}:{" "}
                  </small>
                  {change.unavailable
                    ? text.detail.unavailable
                    : (change.value ?? text.detail.cleared)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <dl className="details-facts">
        <div>
          <dt>{text.detail.effective}</dt>
          <dd>{day(request.effectiveOn)}</dd>
        </div>
        <div>
          <dt>{text.detail.submittedBy}</dt>
          <dd>{request.submittedBy}</dd>
        </div>
        {request.reason && (
          <div className="details-wide">
            <dt>{text.detail.reason}</dt>
            <dd>{request.reason}</dd>
          </div>
        )}
        {request.decidedAt && request.decidedBy && (
          <div className="details-wide">
            <dt>{text.detail.decision}</dt>
            <dd>
              {text.statusNames[request.status]} ·{" "}
              {text.detail.decidedBy(request.decidedBy, day(request.decidedAt))}
              {request.decisionNote && (
                <>
                  <br />
                  {text.detail.decisionNote}: {request.decisionNote}
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
      {request.canDecide ? (
        <form className="leave-form" onSubmit={(event) => void approve(event)}>
          <NoteField
            label={text.detail.note}
            hint={text.detail.noteHint}
            required={false}
          />
          <FormError message={error} />
          <div className="details-actions">
            <Button type="submit" isDisabled={busy}>
              {busy ? text.detail.approving : text.detail.approve}
            </Button>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => onDecision("reject")}
            >
              {text.detail.reject}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {request.status === "submitted" && (
            <p className="details-muted">{text.detail.ownRequest}</p>
          )}
          {request.status === "approved" && (
            <p className="details-muted">{text.detail.approvedWaiting}</p>
          )}
          {request.canCancel && (
            <div className="details-actions">
              <Button variant="secondary" onPress={() => onDecision("cancel")}>
                {text.detail.cancel}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NoteDialog({
  request,
  decision,
  onDone,
  onBack,
}: {
  request: ProfileChangeRequest;
  decision: Decision | null;
  onDone: () => void;
  onBack: () => void;
}) {
  const { run, busy, error, setError } = useProfileRequestRunner();
  const copy = decision === "cancel" ? text.cancelDialog : text.rejectDialog;
  function back() {
    if (busy) return;
    setError("");
    onBack();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision) return;
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const ok = await run(
      `/profile/requests/${request.id}/${decision}`,
      { version: request.version, note },
      copy.failed,
    );
    if (ok) onDone();
  }
  return (
    <DialogPanel
      open={Boolean(decision)}
      onOpenChange={(next) => {
        if (!next) back();
      }}
      title={copy.title}
      className="leave-modal details-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.intro(request.employeeName)}</p>
        <NoteField label={copy.note} hint={copy.noteHint} required />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.submit}
          saving={copy.saving}
          onCancel={back}
          cancelLabel={text.form.back}
        />
      </form>
    </DialogPanel>
  );
}
