import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase";
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
import type { RecruitRequisition } from "@anvi/contracts";
import { useRecruitLookups, useRecruitRequisitions } from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  PersonPicker,
  SelectField,
  StatusPill,
  dateOnly,
  requisitionColor,
  useDebounced,
  useRecruitSend,
  type Person,
} from "./shared";

const copy = text.requisition;
const statuses = Object.keys(copy.status);
const types = Object.keys(copy.employmentType) as Array<
  keyof typeof copy.employmentType
>;

type Step =
  "submit" | "approve" | "reject" | "open" | "hold" | "close" | "cancel";
type Acting =
  | {
      kind: "step";
      step: "reject" | "hold" | "close" | "cancel";
      item: RecruitRequisition;
    }
  | { kind: "edit"; item: RecruitRequisition }
  | { kind: "new" };

const placement = (item: RecruitRequisition) =>
  [item.departmentName, item.locationName].filter(Boolean).join(" · ");

function pill(item: RecruitRequisition) {
  return (
    <StatusPill
      label={copy.status[item.status]}
      color={requisitionColor[item.status] ?? "gray"}
    />
  );
}

const columns: Column<RecruitRequisition>[] = [
  {
    id: "role",
    label: copy.columns.role,
    isRowHeader: true,
    sortValue: (item) => item.title,
    render: (item) => (
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm text-primary">{item.title}</strong>
        <span className="text-sm text-tertiary">{item.code}</span>
      </span>
    ),
  },
  {
    id: "placement",
    label: copy.columns.placement,
    render: (item) => <span className="text-sm">{placement(item)}</span>,
  },
  {
    id: "headcount",
    label: copy.columns.headcount,
    sortValue: (item) => item.headcount,
    render: (item) => (
      <span className="text-sm">
        {copy.cardHeadcount(item.filledCount, item.headcount)}
      </span>
    ),
  },
  {
    id: "applications",
    label: copy.columns.applications,
    sortValue: (item) => item.applicationCount,
    render: (item) => <span className="text-sm">{item.applicationCount}</span>,
  },
  {
    id: "status",
    label: copy.columns.status,
    sortValue: (item) => item.status,
    render: pill,
  },
];

export function RequisitionsTab({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = useRecruitRequisitions(true, query.toString());
  const { send, busy, error, setError } = useRecruitSend();
  const [acting, setActing] = useState<Acting | null>(null);
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  async function step(item: RecruitRequisition, name: Step, note?: string) {
    const body = { version: item.version, ...(note ? { note } : {}) };
    return (await send(`requisitions/${item.id}/${name}`, body)) !== null;
  }

  const detail: CollectionDetail<RecruitRequisition> = {
    title: (item) => item.title,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {item.code}
        {pill(item)}
      </span>
    ),
    body: (item) => (
      <div className="flex flex-col gap-5">
        {item.needsReapproval && (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
            {copy.detail.reapproval}
          </p>
        )}
        <DetailFields
          title={copy.detail.requisition}
          fields={[
            { label: copy.detail.department, value: item.departmentName },
            { label: copy.detail.location, value: item.locationName },
            { label: copy.detail.designation, value: item.designationName },
            {
              label: copy.detail.employmentType,
              value: copy.employmentType[item.employmentType],
            },
            {
              label: copy.detail.headcount,
              value: copy.cardHeadcount(item.filledCount, item.headcount),
            },
            { label: copy.detail.applications, value: item.applicationCount },
            {
              label: copy.detail.targetStart,
              value: item.targetStart ? dateOnly(item.targetStart) : null,
            },
            { label: copy.detail.description, value: item.description },
          ]}
        />
        <DetailFields
          title={copy.detail.people}
          fields={[
            { label: copy.detail.hiringManager, value: item.hiringManagerName },
            { label: copy.detail.raisedBy, value: item.createdBy },
            { label: copy.detail.approvedBy, value: item.approvedBy },
          ]}
        />
        <DetailFields
          title={copy.detail.history}
          fields={[
            { label: copy.detail.status, value: copy.status[item.status] },
            { label: copy.detail.note, value: item.statusNote },
            {
              label: copy.detail.closedAt,
              value: item.closedAt ? dateOnly(item.closedAt) : null,
            },
            { label: copy.detail.updated, value: dateOnly(item.updatedAt) },
          ]}
        />
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
              setActing({ kind: "edit", item });
            }}
          >
            {copy.actions.edit}
          </Button>
        )}
        {item.canSubmit && (
          <Button isDisabled={busy} onPress={() => void step(item, "submit")}>
            {copy.actions.submit}
          </Button>
        )}
        {item.canDecide && (
          <>
            <Button
              variant="secondary"
              onPress={() => {
                close();
                setActing({ kind: "step", step: "reject", item });
              }}
            >
              {copy.actions.reject}
            </Button>
            <Button
              isDisabled={busy}
              onPress={() => void step(item, "approve")}
            >
              {copy.actions.approve}
            </Button>
          </>
        )}
        {item.canOpen && (
          <Button isDisabled={busy} onPress={() => void step(item, "open")}>
            {copy.actions.open}
          </Button>
        )}
        {item.canHold && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "step", step: "hold", item });
            }}
          >
            {copy.actions.hold}
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

  const dialog =
    acting && acting.kind === "step" ? copy.dialogs[acting.step] : null;
  return (
    <div className="recruit-tab">
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
              setActing({ kind: "new" });
            }}
          >
            <Plus size={18} />
            {copy.raise}
          </Button>
        )}
      </div>
      <CollectionView
        id="recruit-requisitions"
        label={text.tabs.requisitions}
        noun="requisitions"
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
        emptyIcon={Briefcase}
        emptyTitle={
          search || status !== "all" ? copy.emptyFiltered : copy.empty
        }
        emptyDescription={copy.emptyBody}
        onClearFilters={
          search || status !== "all"
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
            <span className="text-sm text-tertiary">
              {item.code} · {placement(item)}
            </span>
            <span className="text-sm text-secondary">
              {copy.cardHeadcount(item.filledCount, item.headcount)} ·{" "}
              {copy.applicationsCount(item.applicationCount)}
            </span>
            <span className="text-sm text-tertiary">
              {copy.detail.hiringManager}: {item.hiringManagerName}
            </span>
          </div>
        )}
        detail={detail}
      />
      <RequisitionForm
        open={acting?.kind === "new" || acting?.kind === "edit"}
        item={acting?.kind === "edit" ? acting.item : null}
        canManage={canManage}
        onClose={() => setActing(null)}
      />
      {acting?.kind === "step" && dialog && (
        <NoteDialog
          open
          title={dialog.title}
          body={dialog.body}
          label={dialog.label}
          submit={dialog.submit}
          required={acting.step === "reject" || acting.step === "close"}
          onClose={() => setActing(null)}
          onSubmit={(note) => step(acting.item, acting.step, note)}
        />
      )}
    </div>
  );
}

function RequisitionForm({
  open,
  item,
  canManage,
  onClose,
}: {
  open: boolean;
  item: RecruitRequisition | null;
  canManage: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={item ? copy.editTitle : copy.raiseTitle}
      onClose={onClose}
    >
      {open && (
        <RequisitionFields
          key={item?.id ?? "new"}
          item={item}
          canManage={canManage}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function RequisitionFields({
  item,
  canManage,
  onClose,
}: {
  item: RecruitRequisition | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const lookups = useRecruitLookups(true);
  const { send, busy, error } = useRecruitSend();
  const [title, setTitle] = useState(item?.title ?? "");
  const [departmentId, setDepartmentId] = useState(item?.departmentId ?? "");
  const [locationId, setLocationId] = useState(item?.locationId ?? "");
  const [designationId, setDesignationId] = useState(item?.designationId ?? "");
  const [headcount, setHeadcount] = useState(String(item?.headcount ?? 1));
  const [employmentType, setEmploymentType] = useState<
    keyof typeof copy.employmentType | ""
  >(item?.employmentType ?? "full_time");
  const [targetStart, setTargetStart] = useState(item?.targetStart ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [manager, setManager] = useState<Person[]>(
    item
      ? [{ id: item.hiringManagerId, name: item.hiringManagerName, title: "" }]
      : [],
  );
  const unavailable = Boolean(lookups.error);
  const loading = lookups.isPending;
  const count = Number(headcount);
  const ready =
    title.trim().length >= 3 &&
    departmentId &&
    locationId &&
    employmentType &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 50 &&
    (!item || manager.length === 1 || !canManage);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !employmentType) return;
    const body = {
      title: title.trim(),
      departmentId,
      locationId,
      designationId: designationId || null,
      headcount: count,
      employmentType,
      description: description.trim() || null,
      targetStart: targetStart || null,
    };
    const done = item
      ? await send(
          `requisitions/${item.id}`,
          {
            ...body,
            version: item.version,
            hiringManagerId:
              canManage && manager[0] ? manager[0].id : item.hiringManagerId,
          },
          undefined,
          "PUT",
        )
      : await send("requisitions", {
          ...body,
          hiringManagerId: canManage && manager[0] ? manager[0].id : null,
        });
    if (done !== null) onClose();
  }
  if (unavailable)
    return (
      <div className="leave-form">
        <p>{copy.lookupUnavailable}</p>
        <div className="leave-actions">
          <Button variant="secondary" onPress={onClose}>
            {text.common.close}
          </Button>
        </div>
      </div>
    );
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      {item && <p>{copy.editNote}</p>}
      <Input
        label={copy.fields.title}
        value={title}
        onChange={setTitle}
        maxLength={120}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <div className="leave-dates">
        <Select
          label={copy.fields.department}
          selectedKey={departmentId || null}
          onSelectionChange={(key) => key && setDepartmentId(String(key))}
          isDisabled={loading}
        >
          {(lookups.data?.departments ?? []).map((unit) => (
            <Select.Item key={unit.id} id={unit.id} label={unit.name} />
          ))}
        </Select>
        <Select
          label={copy.fields.location}
          selectedKey={locationId || null}
          onSelectionChange={(key) => key && setLocationId(String(key))}
          isDisabled={loading}
        >
          {(lookups.data?.locations ?? []).map((unit) => (
            <Select.Item key={unit.id} id={unit.id} label={unit.name} />
          ))}
        </Select>
      </div>
      <Select
        label={copy.fields.designation}
        selectedKey={designationId || "none"}
        onSelectionChange={(key) =>
          setDesignationId(key === "none" ? "" : String(key))
        }
      >
        <Select.Item id="none" label={text.common.none} />
        {(lookups.data?.designations ?? []).map((unit) => (
          <Select.Item key={unit.id} id={unit.id} label={unit.name} />
        ))}
      </Select>
      <div className="leave-dates">
        <RangeInput
          label={copy.fields.headcount}
          type="number"
          min={1}
          max={50}
          value={headcount}
          onChange={setHeadcount}
          isRequired
          hideRequiredIndicator
        />
        <SelectField
          label={copy.fields.employmentType}
          value={employmentType}
          onChange={setEmploymentType}
          options={types}
          labels={copy.employmentType}
        />
      </div>
      <RangeInput
        type="date"
        label={copy.fields.targetStart}
        value={targetStart}
        onChange={setTargetStart}
      />
      {!canManage && !item && <p>{copy.selfManager}</p>}
      {canManage && (
        <PersonPicker
          label={copy.fields.hiringManager}
          selected={manager}
          onChange={setManager}
        />
      )}
      <TextArea
        label={copy.fields.description}
        value={description}
        onChange={setDescription}
        maxLength={2000}
      />
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
