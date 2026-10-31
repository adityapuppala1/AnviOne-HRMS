import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Books } from "@phosphor-icons/react/dist/csr/Books";
import {
  Button,
  Checkbox,
  CollectionView,
  ErrorState,
  Input,
  RangeInput,
  Select,
  TextArea,
  type Column,
} from "@anvi/ui";
import {
  lrnAssignResultSchema,
  type LrnAssignResult,
  type LrnCourse,
} from "@anvi/contracts";
import { useOrganization, usePeopleSearch } from "../../lib/api";
import { useLrnCourses } from "../../lib/learning-api";
import { learningCopy as text } from "../../lib/copy/learning";
import { AssignmentsTab } from "./assignments";
import {
  FilterSelect,
  FormActions,
  FormError,
  Modal,
  SearchBox,
  SelectField,
  StatusPill,
  courseColor,
  todayIso,
  useDebounced,
  useLrnSend,
} from "./shared";

const copy = text.manage;
const courseStatuses = Object.keys(text.courseStatus) as LrnCourse["status"][];
const deliveries = Object.keys(text.delivery) as LrnCourse["deliveryMode"][];

export function ManageTab() {
  return (
    <div className="lrn-manage">
      <CoursesSection />
      <section className="lrn-section" aria-label={copy.assignmentsTitle}>
        <div>
          <h2 className="lrn-h2">{copy.assignmentsTitle}</h2>
          <p className="recruit-muted">{copy.assignmentsIntro}</p>
        </div>
        <AssignmentsTab mode="all" />
      </section>
    </div>
  );
}

function CoursesSection() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = useLrnCourses(true, query.toString());
  const { send, busy, error } = useLrnSend();
  const [editing, setEditing] = useState<LrnCourse | "new" | null>(null);
  const [assigning, setAssigning] = useState<LrnCourse | null>(null);
  async function step(item: LrnCourse, name: "publish" | "archive") {
    await send(`courses/${item.id}/${name}`, { version: item.version });
  }
  const actions = (item: LrnCourse) => (
    <span className="flex flex-wrap gap-2">
      {item.canEdit && (
        <Button
          variant="secondary"
          aria-label={`${copy.edit}: ${item.title}`}
          onPress={() => setEditing(item)}
        >
          {copy.edit}
        </Button>
      )}
      {item.canPublish && (
        <Button
          variant="secondary"
          isDisabled={busy}
          aria-label={`${copy.publish}: ${item.title}`}
          onPress={() => void step(item, "publish")}
        >
          {copy.publish}
        </Button>
      )}
      {item.canAssign && (
        <Button
          variant="secondary"
          aria-label={`${copy.assign}: ${item.title}`}
          onPress={() => setAssigning(item)}
        >
          {copy.assign}
        </Button>
      )}
      {item.canArchive && (
        <Button
          variant="secondary"
          isDisabled={busy}
          aria-label={`${copy.archive}: ${item.title}`}
          onPress={() => void step(item, "archive")}
        >
          {copy.archive}
        </Button>
      )}
    </span>
  );
  const columns: Column<LrnCourse>[] = [
    {
      id: "course",
      label: text.catalogue.columns.course,
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
      id: "category",
      label: text.catalogue.columns.category,
      render: (item) => <span className="text-sm">{item.category}</span>,
    },
    {
      id: "type",
      label: text.catalogue.columns.type,
      render: (item) => (
        <span className="text-sm">
          {item.mandatory ? text.course.mandatory : text.course.optional}
        </span>
      ),
    },
    {
      id: "status",
      label: text.catalogue.columns.status,
      render: (item) => (
        <StatusPill
          label={text.courseStatus[item.status]}
          color={courseColor[item.status]}
        />
      ),
    },
    { id: "actions", label: copy.edit, render: actions },
  ];
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const filtered = Boolean(search) || status !== "all";
  return (
    <section className="lrn-section" aria-label={copy.coursesTitle}>
      <div className="recruit-toolbar">
        <div>
          <h2 className="lrn-h2">{copy.coursesTitle}</h2>
          <p className="recruit-muted">{copy.coursesIntro}</p>
        </div>
        <Button onPress={() => setEditing("new")}>
          <Plus size={18} />
          {copy.add}
        </Button>
      </div>
      <div className="recruit-filters">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label={text.common.status}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          allLabel={text.common.allStatuses}
          options={courseStatuses.map((id) => ({
            id,
            label: text.courseStatus[id],
          }))}
        />
      </div>
      <FormError message={error} />
      <CollectionView
        id="lrn-courses-manage"
        label={copy.coursesTitle}
        noun="courses"
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
        emptyIcon={Books}
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
                {item.title}
              </strong>
              <StatusPill
                label={text.courseStatus[item.status]}
                color={courseColor[item.status]}
              />
            </div>
            <span className="text-sm text-tertiary">
              {item.code} · {item.category} ·{" "}
              {item.mandatory ? text.course.mandatory : text.course.optional}
            </span>
            {actions(item)}
          </div>
        )}
      />
      <Modal
        open={editing !== null}
        title={editing === "new" ? copy.addTitle : copy.editTitle}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <CourseForm
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal
        open={assigning !== null}
        title={text.assign.title}
        onClose={() => setAssigning(null)}
      >
        {assigning && (
          <AssignForm
            key={assigning.id}
            course={assigning}
            onClose={() => setAssigning(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function CourseForm({
  item,
  onClose,
}: {
  item: LrnCourse | null;
  onClose: () => void;
}) {
  const f = copy.fields;
  const { send, busy, error } = useLrnSend();
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [delivery, setDelivery] = useState<LrnCourse["deliveryMode"]>(
    item?.deliveryMode ?? "online",
  );
  const [minutes, setMinutes] = useState(String(item?.durationMinutes ?? 60));
  const [link, setLink] = useState(item?.externalUrl ?? "");
  const [mandatory, setMandatory] = useState(item?.mandatory ?? false);
  const [validity, setValidity] = useState(
    item?.validityMonths ? String(item.validityMonths) : "",
  );
  const duration = Number(minutes);
  const months = Number(validity);
  const ready =
    title.trim().length >= 3 &&
    category.trim().length >= 2 &&
    Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= 10000 &&
    (validity === "" ||
      (Number.isInteger(months) && months >= 1 && months <= 120));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const payload = {
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      deliveryMode: delivery,
      durationMinutes: duration,
      externalUrl: link.trim() === "" ? null : link.trim(),
      mandatory,
      validityMonths: validity === "" ? null : months,
    };
    const done = item
      ? await send(
          `courses/${item.id}`,
          { ...payload, version: item.version },
          "PUT",
        )
      : await send("courses", payload);
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={f.title}
        value={title}
        onChange={setTitle}
        maxLength={120}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <Input
        label={f.category}
        value={category}
        onChange={setCategory}
        maxLength={60}
        isRequired
        hideRequiredIndicator
      />
      <TextArea
        label={f.description}
        value={description}
        onChange={setDescription}
        maxLength={2000}
      />
      <SelectField
        label={f.delivery}
        value={delivery}
        onChange={setDelivery}
        options={deliveries}
        labels={text.delivery}
      />
      <RangeInput
        type="number"
        label={f.duration}
        value={minutes}
        onChange={setMinutes}
        min={1}
        max={10000}
        isRequired
      />
      <Input
        label={f.link}
        value={link}
        onChange={setLink}
        maxLength={500}
        hint={f.linkHint}
      />
      <RangeInput
        type="number"
        label={f.validity}
        value={validity}
        onChange={setValidity}
        min={1}
        max={120}
        hint={f.validityHint}
      />
      <Checkbox
        isSelected={mandatory}
        onChange={setMandatory}
        label={f.mandatory}
        hint={f.mandatoryHint}
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

type TargetKind = "employee" | "department" | "location";
const targetKinds: TargetKind[] = ["employee", "department", "location"];

function PersonPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const a = text.assign;
  const [term, setTerm] = useState("");
  const settled = useDebounced(term.trim());
  const found = usePeopleSearch(settled.length >= 2 ? settled : "");
  const items = found.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Input
        label={a.searchPerson}
        hint={a.searchPersonHint}
        value={term}
        onChange={setTerm}
        maxLength={80}
      />
      {settled.length >= 2 && found.data && items.length === 0 ? (
        <p className="recruit-muted">{a.noMatches}</p>
      ) : (
        items.length > 0 && (
          <Select
            label={a.person}
            placeholder={a.personNone}
            selectedKey={items.some((p) => p.id === value) ? value : null}
            onSelectionChange={(key) => key && onChange(String(key))}
          >
            {items.map((p) => (
              <Select.Item
                key={p.id}
                id={p.id}
                label={`${p.name} · ${p.department}`}
              />
            ))}
          </Select>
        )
      )}
    </div>
  );
}

function UnitPicker({
  kind,
  value,
  onChange,
}: {
  kind: "department" | "location";
  value: string;
  onChange: (id: string) => void;
}) {
  const a = text.assign;
  const units = useOrganization(`kind=${kind}&limit=50`);
  const options = (units.data?.items ?? []).filter((u) => u.inEffect);
  return units.error ? (
    <p role="alert" className="inline-error">
      {units.error.message}
    </p>
  ) : units.data && options.length === 0 ? (
    <p className="recruit-muted">{a.unitEmpty}</p>
  ) : (
    <Select
      label={a.unit[kind]}
      placeholder={a.unitNone}
      selectedKey={value || null}
      onSelectionChange={(key) => key && onChange(String(key))}
      hint={units.data && units.data.total > 50 ? a.unitLimit : undefined}
    >
      {options.map((u) => (
        <Select.Item
          key={u.id}
          id={u.id}
          label={a.unitPeople(u.name, u.employeeCount)}
        />
      ))}
    </Select>
  );
}

function AssignForm({
  course,
  onClose,
}: {
  course: LrnCourse;
  onClose: () => void;
}) {
  const a = text.assign;
  const { send, busy, error, status } = useLrnSend();
  const [kind, setKind] = useState<TargetKind>("employee");
  const [targetId, setTargetId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [mandatory, setMandatory] = useState(course.mandatory);
  const [result, setResult] = useState<LrnAssignResult | null>(null);
  const ready = targetId !== "" && dueOn >= todayIso();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const target =
      kind === "employee"
        ? { kind, employeeId: targetId }
        : { kind, unitId: targetId };
    const done = await send(
      `courses/${course.id}/assign`,
      { target, dueOn, mandatory },
      "POST",
      lrnAssignResultSchema,
    );
    if (done) setResult(done);
  }
  if (result)
    return (
      <div className="leave-form">
        <p role="status" className="recruit-notice">
          {a.result(result.assigned, result.skipped)}
        </p>
        <div className="leave-actions">
          <Button
            variant="secondary"
            onPress={() => {
              setResult(null);
              setTargetId("");
            }}
          >
            {a.resultAgain}
          </Button>
          <Button onPress={onClose}>{a.done}</Button>
        </div>
      </div>
    );
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{a.intro}</p>
      <strong>{course.title}</strong>
      <Select
        label={a.target}
        selectedKey={kind}
        onSelectionChange={(key) => {
          setKind(String(key) as TargetKind);
          setTargetId("");
        }}
      >
        {targetKinds.map((k) => (
          <Select.Item key={k} id={k} label={a.targets[k]} />
        ))}
      </Select>
      {kind === "employee" ? (
        <PersonPicker value={targetId} onChange={setTargetId} />
      ) : (
        <UnitPicker
          key={kind}
          kind={kind}
          value={targetId}
          onChange={setTargetId}
        />
      )}
      <RangeInput
        type="date"
        label={a.due}
        value={dueOn}
        onChange={setDueOn}
        min={todayIso()}
        isRequired
      />
      <Checkbox
        isSelected={mandatory}
        onChange={setMandatory}
        label={a.mandatory}
      />
      <FormError
        message={
          status === 409 && error
            ? `${error} Nothing was assigned; try again.`
            : error
        }
      />
      <FormActions
        busy={busy}
        submit={a.submit}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}
