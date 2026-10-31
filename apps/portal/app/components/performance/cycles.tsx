import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  RangeInput,
  Select,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import { perfCycleOpenedSchema, type PerfCycle } from "@anvi/contracts";
import { usePerfCycles, useRecruitLookups } from "../../lib/api";
import { performanceCopy as text } from "../../lib/copy/performance";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  StatusPill,
  cycleColor,
  dateOnly,
  useDebounced,
  usePerfSend,
} from "./shared";

const copy = text.cycle;
const statuses = Object.keys(copy.status);

type Acting =
  | { kind: "new" }
  | { kind: "edit"; item: PerfCycle }
  | { kind: "step"; step: "open" | "close" | "cancel"; item: PerfCycle };

const pill = (item: PerfCycle) => (
  <StatusPill
    label={copy.status[item.status]}
    color={cycleColor[item.status] ?? "gray"}
  />
);
const period = (item: PerfCycle) =>
  text.common.period(dateOnly(item.periodStart), dateOnly(item.periodEnd));
const scope = (item: PerfCycle) => item.departmentName ?? copy.scopeAll;
const reviewTotal = (item: PerfCycle) =>
  Object.values(item.reviewCounts).reduce((sum, n) => sum + n, 0);

const columns: Column<PerfCycle>[] = [
  {
    id: "cycle",
    label: copy.columns.cycle,
    isRowHeader: true,
    sortValue: (item) => item.name,
    render: (item) => <strong className="text-sm">{item.name}</strong>,
  },
  {
    id: "period",
    label: copy.columns.period,
    render: (item) => <span className="text-sm">{period(item)}</span>,
  },
  {
    id: "scope",
    label: copy.columns.scope,
    render: (item) => <span className="text-sm">{scope(item)}</span>,
  },
  {
    id: "reviews",
    label: copy.columns.reviews,
    sortValue: reviewTotal,
    render: (item) => <span className="text-sm">{reviewTotal(item)}</span>,
  },
  {
    id: "status",
    label: copy.columns.status,
    sortValue: (item) => item.status,
    render: pill,
  },
];

export function CyclesTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = usePerfCycles(true, query.toString());
  const { send, busy, error, setError } = usePerfSend();
  const [acting, setActing] = useState<Acting | null>(null);
  const [notice, setNotice] = useState("");
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  async function step(
    item: PerfCycle,
    name: "open" | "close" | "cancel",
    note?: string,
  ) {
    const body = { version: item.version, ...(note ? { note } : {}) };
    if (name === "open") {
      const result = await send(
        `cycles/${item.id}/open`,
        body,
        perfCycleOpenedSchema,
      );
      if (result)
        setNotice(
          copy.opened(
            result.cycle.name,
            result.generated,
            result.skippedNoManager,
          ),
        );
      return result !== null;
    }
    return (await send(`cycles/${item.id}/${name}`, body)) !== null;
  }

  const detail: CollectionDetail<PerfCycle> = {
    title: (item) => item.name,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {scope(item)}
        {pill(item)}
      </span>
    ),
    body: (item) => (
      <div className="flex flex-col gap-5">
        <DetailFields
          title={copy.detail.cycle}
          fields={[
            { label: copy.detail.period, value: period(item) },
            { label: copy.detail.selfDue, value: dateOnly(item.selfDue) },
            { label: copy.detail.managerDue, value: dateOnly(item.managerDue) },
            { label: copy.detail.scope, value: scope(item) },
            { label: copy.detail.statusNote, value: item.statusNote },
            {
              label: copy.detail.openedAt,
              value: item.openedAt ? dateOnly(item.openedAt) : null,
            },
            {
              label: copy.detail.closedAt,
              value: item.closedAt ? dateOnly(item.closedAt) : null,
            },
          ]}
        />
        <DetailFields
          title={copy.detail.reviews}
          fields={Object.entries(copy.stage).map(([key, label]) => ({
            label,
            value: String(
              item.reviewCounts[key as keyof typeof item.reviewCounts] ?? 0,
            ),
          }))}
        />
        <p className="recruit-muted">{copy.detail.dueNote}</p>
        <FormError message={error} />
      </div>
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
        {item.canOpen && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "step", step: "open", item });
            }}
          >
            {copy.actions.open}
          </Button>
        )}
        {item.canClose && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "step", step: "close", item });
            }}
          >
            {copy.actions.close}
          </Button>
        )}
        {item.canCancel && (
          <Button
            variant="secondary"
            isDisabled={busy}
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
      {notice && (
        <p role="status" className="recruit-notice">
          {notice}
        </p>
      )}
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
        {list.data?.canCreate && (
          <Button
            onPress={() => {
              setError("");
              setNotice("");
              setActing({ kind: "new" });
            }}
          >
            <Plus size={18} />
            {copy.create}
          </Button>
        )}
      </div>
      <CollectionView
        id="perf-cycles"
        label={text.tabs.cycles}
        noun="review cycles"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(item) => item.id}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={ArrowsClockwise}
        emptyTitle={filtered ? copy.emptyFiltered : copy.empty}
        emptyDescription={copy.emptyBody}
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
                {item.name}
              </strong>
              {pill(item)}
            </div>
            <span className="text-sm text-tertiary">{period(item)}</span>
            <span className="text-sm text-secondary">
              {scope(item)} · {copy.cardReviews(reviewTotal(item))}
            </span>
          </div>
        )}
        detail={detail}
      />
      <CycleForm
        open={acting?.kind === "new" || acting?.kind === "edit"}
        item={acting?.kind === "edit" ? acting.item : null}
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

function CycleForm({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: PerfCycle | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={item ? copy.editTitle : copy.createTitle}
      onClose={onClose}
    >
      {open && (
        <CycleFields key={item?.id ?? "new"} item={item} onClose={onClose} />
      )}
    </Modal>
  );
}

function CycleFields({
  item,
  onClose,
}: {
  item: PerfCycle | null;
  onClose: () => void;
}) {
  const lookups = useRecruitLookups(true);
  const { send, busy, error } = usePerfSend();
  const [name, setName] = useState(item?.name ?? "");
  const [periodStart, setPeriodStart] = useState(item?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(item?.periodEnd ?? "");
  const [selfDue, setSelfDue] = useState(item?.selfDue ?? "");
  const [managerDue, setManagerDue] = useState(item?.managerDue ?? "");
  const [departmentId, setDepartmentId] = useState(item?.departmentId ?? "");
  const ready =
    name.trim().length >= 3 &&
    periodStart !== "" &&
    periodEnd >= periodStart &&
    periodEnd !== "" &&
    selfDue !== "" &&
    selfDue >= periodStart &&
    managerDue !== "" &&
    managerDue >= selfDue;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const body = {
      name: name.trim(),
      periodStart,
      periodEnd,
      selfDue,
      managerDue,
      departmentId: departmentId || null,
    };
    const done = item
      ? await send(
          `cycles/${item.id}`,
          { ...body, version: item.version },
          undefined,
          "PUT",
        )
      : await send("cycles", body);
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={copy.fields.name}
        value={name}
        onChange={setName}
        maxLength={80}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <div className="leave-dates">
        <RangeInput
          type="date"
          label={copy.fields.periodStart}
          value={periodStart}
          onChange={setPeriodStart}
          isRequired
        />
        <RangeInput
          type="date"
          label={copy.fields.periodEnd}
          value={periodEnd}
          onChange={setPeriodEnd}
          min={periodStart || undefined}
          isRequired
        />
      </div>
      <div className="leave-dates">
        <RangeInput
          type="date"
          label={copy.fields.selfDue}
          value={selfDue}
          onChange={setSelfDue}
          min={periodStart || undefined}
          isRequired
        />
        <RangeInput
          type="date"
          label={copy.fields.managerDue}
          value={managerDue}
          onChange={setManagerDue}
          min={selfDue || undefined}
          isRequired
        />
      </div>
      <Select
        label={copy.fields.department}
        selectedKey={departmentId || "all"}
        onSelectionChange={(key) =>
          setDepartmentId(key === "all" ? "" : String(key))
        }
        hint={lookups.error ? copy.lookupUnavailable : undefined}
      >
        <Select.Item id="all" label={copy.wholeEntity} />
        {(lookups.data?.departments ?? []).map((unit) => (
          <Select.Item key={unit.id} id={unit.id} label={unit.name} />
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
