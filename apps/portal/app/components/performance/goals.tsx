import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  RangeInput,
  Select,
  TextArea,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { PerfKeyResult, PerfObjective } from "@anvi/contracts";
import {
  usePerfAlignable,
  usePerfObjective,
  usePerfObjectives,
  usePerfProgress,
} from "../../lib/api";
import { performanceCopy as text } from "../../lib/copy/performance";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  PersonPicker,
  ProgressBar,
  SelectField,
  StatusPill,
  dateOnly,
  formatValue,
  goalColor,
  useDebounced,
  usePerfSend,
  type Person,
} from "./shared";

const copy = text.goal;
const statuses = Object.keys(copy.status);
const units = Object.keys(text.units) as Array<keyof typeof text.units>;

type Acting =
  | { kind: "new" }
  | { kind: "edit"; item: PerfObjective }
  | { kind: "step"; step: "complete" | "cancel"; item: PerfObjective }
  | { kind: "keyResult"; item: PerfObjective }
  | { kind: "progress"; goal: PerfObjective; keyResult: PerfKeyResult };

const pill = (item: PerfObjective) => (
  <StatusPill
    label={copy.status[item.status]}
    color={goalColor[item.status] ?? "gray"}
  />
);
const period = (item: PerfObjective) =>
  text.common.period(dateOnly(item.periodStart), dateOnly(item.periodEnd));

const columns: Column<PerfObjective>[] = [
  {
    id: "goal",
    label: copy.columns.goal,
    isRowHeader: true,
    sortValue: (item) => item.title,
    render: (item) => (
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm text-primary">{item.title}</strong>
        <span className="text-sm text-tertiary">
          {copy.cardKeyResults(item.keyResultCount)}
        </span>
      </span>
    ),
  },
  {
    id: "owner",
    label: copy.columns.owner,
    sortValue: (item) => item.ownerName,
    render: (item) => (
      <span className="text-sm">{item.mine ? copy.mine : item.ownerName}</span>
    ),
  },
  {
    id: "period",
    label: copy.columns.period,
    render: (item) => <span className="text-sm">{period(item)}</span>,
  },
  {
    id: "progress",
    label: copy.columns.progress,
    sortValue: (item) => item.progress,
    render: (item) => (
      <ProgressBar
        value={item.progress}
        label={`${copy.columns.progress}: ${item.title}`}
      />
    ),
  },
  {
    id: "status",
    label: copy.columns.status,
    sortValue: (item) => item.status,
    render: pill,
  },
];

export function GoalsTab({
  view,
  canCreate,
  canCreateForOthers,
}: {
  view: "mine" | "team" | "all";
  canCreate: boolean;
  canCreateForOthers: boolean;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
    q,
    view,
  });
  if (status !== "all") query.set("status", status);
  const list = usePerfObjectives(true, query.toString());
  const { send, busy, error, setError } = usePerfSend();
  const [acting, setActing] = useState<Acting | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  async function step(
    item: PerfObjective,
    name: "activate" | "complete" | "cancel",
    note?: string,
  ) {
    const body = { version: item.version, ...(note ? { note } : {}) };
    return (await send(`objectives/${item.id}/${name}`, body)) !== null;
  }

  const detail: CollectionDetail<PerfObjective> = {
    title: (item) => item.title,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {item.mine ? copy.mine : item.ownerName}
        {pill(item)}
      </span>
    ),
    body: (item) => (
      <GoalBody
        item={item}
        error={error}
        onLog={(keyResult) => {
          setOpenKey(null);
          setError("");
          setActing({ kind: "progress", goal: item, keyResult });
        }}
      />
    ),
    footer: (item, close) => (
      <>
        {item.canEdit && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setError("");
              setActing({ kind: "edit", item });
            }}
          >
            {copy.actions.edit}
          </Button>
        )}
        {item.canAddKeyResult && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setError("");
              setActing({ kind: "keyResult", item });
            }}
          >
            {copy.actions.addKeyResult}
          </Button>
        )}
        {item.canActivate && (
          <Button
            isDisabled={busy || item.keyResultCount === 0}
            onPress={() => void step(item, "activate")}
          >
            {copy.actions.activate}
          </Button>
        )}
        {item.canComplete && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "step", step: "complete", item });
            }}
          >
            {copy.actions.complete}
          </Button>
        )}
        {item.canCancel && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "step", step: "cancel", item });
            }}
          >
            {copy.actions.cancel}
          </Button>
        )}
      </>
    ),
  };

  const filtered = Boolean(search) || status !== "all";
  const dialog =
    acting && acting.kind === "step" ? copy.dialogs[acting.step] : null;
  return (
    <div className="perf-tab">
      <div className="recruit-toolbar">
        <ListFilters
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          status={status}
          onStatus={(value) => {
            setStatus(value);
            setPage(1);
          }}
          statuses={statuses}
          labels={copy.status}
        />
        {canCreate && (
          <Button
            onPress={() => {
              setError("");
              setActing({ kind: "new" });
            }}
          >
            <Plus size={18} />
            {copy.create}
          </Button>
        )}
      </div>
      <CollectionView
        id={`perf-goals-${view}`}
        label={view === "mine" ? text.tabs.goals : text.tabs.team}
        noun="goals"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(item) => item.id}
        columns={columns}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={Target}
        emptyTitle={
          filtered
            ? copy.emptyFiltered
            : view === "mine"
              ? copy.empty
              : copy.emptyTeam
        }
        emptyDescription={view === "mine" ? copy.emptyBody : copy.emptyTeamBody}
        onClearFilters={
          filtered
            ? () => {
                setSearch("");
                setStatus("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="min-w-0 break-words text-primary">
                {item.title}
              </strong>
              {pill(item)}
            </div>
            <ProgressBar
              value={item.progress}
              label={`${copy.columns.progress}: ${item.title}`}
            />
            <span className="text-sm text-tertiary">
              {item.mine ? copy.mine : item.ownerName} · {period(item)}
            </span>
            <span className="text-sm text-secondary">
              {copy.cardKeyResults(item.keyResultCount)}
            </span>
          </div>
        )}
        detail={detail}
      />
      <GoalForm
        open={acting?.kind === "new" || acting?.kind === "edit"}
        item={acting?.kind === "edit" ? acting.item : null}
        canCreateForOthers={canCreateForOthers}
        onClose={() => setActing(null)}
      />
      <KeyResultForm
        open={acting?.kind === "keyResult"}
        goal={acting?.kind === "keyResult" ? acting.item : null}
        onClose={() => setActing(null)}
      />
      <ProgressForm
        open={acting?.kind === "progress"}
        keyResult={acting?.kind === "progress" ? acting.keyResult : null}
        onClose={() => setActing(null)}
      />
      {acting?.kind === "step" && dialog && (
        <NoteDialog
          open
          title={dialog.title}
          body={dialog.body}
          label={dialog.label}
          submit={dialog.submit}
          required={acting.step === "cancel"}
          onClose={() => setActing(null)}
          onSubmit={(note) => step(acting.item, acting.step, note)}
        />
      )}
    </div>
  );
}

// The panel body loads the full goal (key results and aligned goals) on its own.
function GoalBody({
  item,
  error,
  onLog,
}: {
  item: PerfObjective;
  error: string;
  onLog: (keyResult: PerfKeyResult) => void;
}) {
  const full = usePerfObjective(item.id);
  const goal = full.data?.objective ?? item;
  const d = copy.detail;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label={d.overall}>
        <h3 className="text-sm font-semibold text-secondary">{d.overall}</h3>
        <ProgressBar value={goal.progress} label={d.overall} />
      </section>
      <DetailFields
        title={d.goal}
        fields={[
          { label: d.owner, value: goal.mine ? copy.mine : goal.ownerName },
          { label: d.period, value: period(goal) },
          { label: d.description, value: goal.description },
          {
            label: d.alignedTo,
            value:
              goal.parentTitle ??
              (goal.parentObjectiveId ? d.alignedHidden : null),
          },
          { label: d.statusNote, value: goal.statusNote },
          { label: d.updated, value: dateOnly(goal.updatedAt) },
        ]}
      />
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-secondary">{d.keyResults}</h3>
        {full.error ? (
          <p role="alert" className="inline-error">
            {full.error.message}
          </p>
        ) : !full.data ? (
          <div className="cv-skeleton h-16 rounded-xl bg-secondary" />
        ) : full.data.keyResults.length === 0 ? (
          <p className="text-sm text-tertiary">{d.noKeyResults}</p>
        ) : (
          <ul className="perf-krs" aria-label={d.keyResults}>
            {full.data.keyResults.map((kr) => (
              <KeyResultRow key={kr.id} kr={kr} onLog={onLog} />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-secondary">{d.aligned}</h3>
        {full.data && full.data.children.length === 0 ? (
          <p className="text-sm text-tertiary">{d.noAligned}</p>
        ) : (
          <ul className="perf-krs" aria-label={d.aligned}>
            {(full.data?.children ?? []).map((child) => (
              <li key={child.id} className="perf-kr">
                <div className="perf-kr-head">
                  <strong>{child.title}</strong>
                  <StatusPill
                    label={copy.status[child.status]}
                    color={goalColor[child.status] ?? "gray"}
                  />
                </div>
                <span className="recruit-muted">{child.ownerName}</span>
                <ProgressBar
                  value={child.progress}
                  label={`${copy.columns.progress}: ${child.title}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <FormError message={error} />
    </div>
  );
}

function KeyResultRow({
  kr,
  onLog,
}: {
  kr: PerfKeyResult;
  onLog: (keyResult: PerfKeyResult) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const history = usePerfProgress(showHistory ? kr.id : null);
  const d = text.progress;
  return (
    <li className="perf-kr">
      <div className="perf-kr-head">
        <strong>{kr.title}</strong>
        <span className="recruit-muted">
          {text.keyResult.summary(
            formatValue(kr.unit, kr.currentValue),
            formatValue(kr.unit, kr.targetValue),
          )}
        </span>
      </div>
      <ProgressBar
        value={kr.progress}
        label={`${text.goal.columns.progress}: ${kr.title}`}
      />
      <span className="recruit-muted">
        {text.keyResult.started(formatValue(kr.unit, kr.startValue))} ·{" "}
        {text.keyResult.updates(kr.updateCount)}
      </span>
      <div className="leave-actions">
        {kr.canRecordProgress && (
          <Button variant="secondary" onPress={() => onLog(kr)}>
            {text.goal.actions.logProgress}
          </Button>
        )}
        {kr.updateCount > 0 && (
          <Button
            variant="ghost"
            aria-expanded={showHistory}
            onPress={() => setShowHistory((open) => !open)}
          >
            {showHistory
              ? text.goal.actions.hideHistory
              : text.goal.actions.showHistory}
          </Button>
        )}
      </div>
      {showHistory && (
        <ol className="perf-history" aria-label={`${d.history}: ${kr.title}`}>
          {!history.data ? (
            <li className="recruit-muted">…</li>
          ) : history.data.items.length === 0 ? (
            <li className="recruit-muted">{d.historyEmpty}</li>
          ) : (
            history.data.items.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {d.change(
                    formatValue(kr.unit, entry.previousValue),
                    formatValue(kr.unit, entry.value),
                  )}
                </strong>
                <span className="recruit-muted">
                  {entry.by} · {dateOnly(entry.at)}
                </span>
                {entry.note && <span>{entry.note}</span>}
              </li>
            ))
          )}
        </ol>
      )}
    </li>
  );
}

function GoalForm({
  open,
  item,
  canCreateForOthers,
  onClose,
}: {
  open: boolean;
  item: PerfObjective | null;
  canCreateForOthers: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={item ? copy.editTitle : copy.createTitle}
      onClose={onClose}
    >
      {open && (
        <GoalFields
          key={item?.id ?? "new"}
          item={item}
          canCreateForOthers={canCreateForOthers}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function GoalFields({
  item,
  canCreateForOthers,
  onClose,
}: {
  item: PerfObjective | null;
  canCreateForOthers: boolean;
  onClose: () => void;
}) {
  const { send, busy, error } = usePerfSend();
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [periodStart, setPeriodStart] = useState(item?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(item?.periodEnd ?? "");
  const [parentId, setParentId] = useState(item?.parentObjectiveId ?? "");
  const [owner, setOwner] = useState<Person[]>([]);
  const ownerId = item ? item.ownerEmployeeId : (owner[0]?.id ?? "");
  const alignable = usePerfAlignable(true, ownerId);
  const locked = Boolean(item && item.status !== "draft");
  const ready =
    title.trim().length >= 3 &&
    periodStart !== "" &&
    periodEnd !== "" &&
    periodEnd >= periodStart;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const body = {
      title: title.trim(),
      description: description.trim() || null,
      periodStart,
      periodEnd,
      parentObjectiveId: parentId || null,
    };
    const done = item
      ? await send(
          `objectives/${item.id}`,
          { ...body, version: item.version },
          undefined,
          "PUT",
        )
      : await send("objectives", {
          ...body,
          ownerEmployeeId: owner[0]?.id ?? null,
        });
    if (done !== null) onClose();
  }
  const options = (alignable.data?.items ?? []).filter(
    (goal) => goal.id !== item?.id,
  );
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      {!item && canCreateForOthers && (
        <>
          <p>{copy.ownerHint}</p>
          <PersonPicker
            label={copy.fields.owner}
            selected={owner}
            onChange={(next) => {
              setOwner(next);
              setParentId("");
            }}
          />
        </>
      )}
      <Input
        label={copy.fields.title}
        value={title}
        onChange={setTitle}
        maxLength={160}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <TextArea
        label={copy.fields.description}
        value={description}
        onChange={setDescription}
        maxLength={2000}
      />
      <div className="leave-dates">
        <RangeInput
          type="date"
          label={copy.fields.periodStart}
          value={periodStart}
          onChange={setPeriodStart}
          isDisabled={locked}
          isRequired
        />
        <RangeInput
          type="date"
          label={copy.fields.periodEnd}
          value={periodEnd}
          onChange={setPeriodEnd}
          min={periodStart || undefined}
          isDisabled={locked}
          isRequired
        />
      </div>
      {locked && <p>{copy.periodLocked}</p>}
      <Select
        label={copy.fields.parent}
        selectedKey={parentId || "none"}
        onSelectionChange={(key) =>
          setParentId(key === "none" ? "" : String(key))
        }
        hint={alignable.error ? copy.parentUnavailable : undefined}
      >
        <Select.Item id="none" label={copy.parentNone} />
        {options.map((goal) => (
          <Select.Item
            key={goal.id}
            id={goal.id}
            label={`${goal.title} (${goal.ownerName})`}
          />
        ))}
      </Select>
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.common.save}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}

function KeyResultForm({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal: PerfObjective | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={text.keyResult.title} onClose={onClose}>
      {open && goal && <KeyResultFields goal={goal} onClose={onClose} />}
    </Modal>
  );
}

function KeyResultFields({
  goal,
  onClose,
}: {
  goal: PerfObjective;
  onClose: () => void;
}) {
  const { send, busy, error } = usePerfSend();
  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState<keyof typeof text.units>("number");
  const [start, setStart] = useState("0");
  const [target, setTarget] = useState("");
  const startValue = Number(start);
  const targetValue = Number(target);
  const numbers =
    start.trim() !== "" &&
    target.trim() !== "" &&
    Number.isFinite(startValue) &&
    Number.isFinite(targetValue);
  const differ = numbers && startValue !== targetValue;
  const ready = title.trim().length >= 3 && differ;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send(`objectives/${goal.id}/key-results`, {
      title: title.trim(),
      unit,
      startValue,
      targetValue,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.keyResult.note}</p>
      <Input
        label={text.keyResult.fields.title}
        value={title}
        onChange={setTitle}
        maxLength={160}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <SelectField
        label={text.keyResult.fields.unit}
        value={unit}
        onChange={setUnit}
        options={units}
        labels={text.units}
      />
      <div className="leave-dates">
        <RangeInput
          type="number"
          step="any"
          label={text.keyResult.fields.start}
          value={start}
          onChange={setStart}
          isRequired
        />
        <RangeInput
          type="number"
          step="any"
          label={text.keyResult.fields.target}
          value={target}
          onChange={setTarget}
          isRequired
        />
      </div>
      {numbers && !differ && (
        <p role="alert" className="inline-error">
          {text.keyResult.differ}
        </p>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.keyResult.title}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}

function ProgressForm({
  open,
  keyResult,
  onClose,
}: {
  open: boolean;
  keyResult: PerfKeyResult | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={text.progress.title} onClose={onClose}>
      {open && keyResult && (
        <ProgressFields
          key={keyResult.id}
          keyResult={keyResult}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function ProgressFields({
  keyResult,
  onClose,
}: {
  keyResult: PerfKeyResult;
  onClose: () => void;
}) {
  const { send, busy, error } = usePerfSend();
  const [value, setValue] = useState(String(keyResult.currentValue));
  const [note, setNote] = useState("");
  const number = Number(value);
  const ready = value.trim() !== "" && Number.isFinite(number);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send(`key-results/${keyResult.id}/progress`, {
      version: keyResult.version,
      value: number,
      note: note.trim() || null,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>
        {keyResult.title}:{" "}
        {text.keyResult.summary(
          formatValue(keyResult.unit, keyResult.currentValue),
          formatValue(keyResult.unit, keyResult.targetValue),
        )}
        . {text.progress.note}
      </p>
      <RangeInput
        type="number"
        step="any"
        label={text.progress.value}
        value={value}
        onChange={setValue}
        isRequired
        autoFocus
      />
      <TextArea
        label={text.progress.comment}
        value={note}
        onChange={setNote}
        maxLength={500}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.progress.submit}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}
