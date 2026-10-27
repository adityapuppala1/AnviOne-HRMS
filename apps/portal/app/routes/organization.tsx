import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase";
import { Medal } from "@phosphor-icons/react/dist/csr/Medal";
import { Coins } from "@phosphor-icons/react/dist/csr/Coins";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/csr/DotsThreeVertical";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { GitMerge } from "@phosphor-icons/react/dist/csr/GitMerge";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { X } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import {
  Button,
  DataCard,
  Dropdown,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  RadioButton,
  RadioGroup,
  RangeInput,
  Select,
  StatusBadge,
  TextArea,
  UTabs,
} from "@anvi/ui";
import {
  organizationUnitSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  organizationMergeSchema,
  organizationMergeResultSchema,
  type OrganizationUnit,
  type OrganizationMergeResult,
} from "@anvi/contracts";
import {
  api,
  ApiError,
  useOrganization,
  useOrganizationDetail,
} from "../lib/api";
import { useWorkspace } from "./workspace";
import { organizationCopy as text } from "../lib/copy/organization";
import "./organization.css";

type UnitKind = OrganizationUnit["kind"];
const kinds: UnitKind[] = [
  "department",
  "location",
  "designation",
  "grade",
  "cost_center",
];
const labels: Record<UnitKind, { singular: string; plural: string }> =
  text.kinds;
const icons: Record<UnitKind, Icon> = {
  department: TreeStructure,
  location: MapPin,
  designation: Briefcase,
  grade: Medal,
  cost_center: Coins,
};
// Only these two hold employees today (and so can be merged).
const mergeable = (kind: UnitKind) =>
  kind === "department" || kind === "location";
const holdsPeople = mergeable;

type DisplayStatus = keyof typeof text.status;
const displayStatus = (unit: OrganizationUnit): DisplayStatus =>
  unit.mergedIntoId ? "merged" : unit.status;
const statusColor: Record<
  DisplayStatus,
  "success" | "blue" | "gray" | "warning" | "purple"
> = {
  in_effect: "success",
  scheduled: "blue",
  ended: "gray",
  inactive: "warning",
  merged: "purple",
};
const fmtDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};
const windowText = (unit: OrganizationUnit) =>
  unit.effectiveTo
    ? text.window.fromTo(fmtDate(unit.effectiveFrom), fmtDate(unit.effectiveTo))
    : text.window.from(fmtDate(unit.effectiveFrom));

function StatusPill({ unit }: { unit: OrganizationUnit }) {
  const status = displayStatus(unit);
  return (
    <StatusBadge color={statusColor[status]} size="sm" type="pill-color">
      {text.status[status]}
    </StatusBadge>
  );
}

function assignedText(unit: OrganizationUnit) {
  if (!holdsPeople(unit.kind))
    return <span className="organization-muted">{text.notTracked}</span>;
  return (
    <span className="text-sm">
      <strong>{unit.employeeCount}</strong>{" "}
      {unit.employeeCount === 1 ? text.person : text.people}
    </span>
  );
}

export default function Organization() {
  const { me } = useWorkspace();
  return me.permissions.includes("organization.read") ? (
    <OrganizationRecords />
  ) : (
    <ErrorState message={text.denied} />
  );
}

function OrganizationRecords() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<OrganizationUnit | "create" | null>(
    null,
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [merging, setMerging] = useState<OrganizationUnit | null>(null);
  const [saved, setSaved] = useState("");
  const requested = params.get("kind");
  const kind: UnitKind =
    kinds.find((candidate) => candidate === requested) ?? "department";
  const search = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = new URLSearchParams({
    kind,
    q: search,
    page: String(page),
    limit: "20",
  });
  const { data, error, isPending, refetch } = useOrganization(query.toString());
  const writable = me.permissions.includes("organization.write");
  const Icon = icons[kind];
  const label = labels[kind];

  function filter(key: "kind" | "q" | "page", value: string) {
    const next = new URLSearchParams(params);
    if (key === "kind") {
      next.delete("q");
      setSaved("");
    }
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    void setParams(next, { replace: true });
  }

  function refreshAll() {
    // Renames and merges must reach the directory, profiles, dashboard and chart labels.
    return Promise.all(
      ["organization", "directory", "employee", "dashboard", "audit"].map(
        (key) => client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }

  async function refreshAfterSave(unit: OrganizationUnit, created: boolean) {
    setEditing(null);
    setSaved(text.saved(unit.name, created));
    await refreshAll();
  }

  // The merge dialog follows the latest copy of its source after a refetch.
  const mergeSource = merging
    ? (data?.items.find((item) => item.id === merging.id) ?? merging)
    : null;

  return (
    <div className="page-enter organization-page">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.heading}
        description={text.intro}
        actions={
          writable && (
            <Button onPress={() => setEditing("create")}>
              <Plus size={18} />
              {text.add(label.singular)}
            </Button>
          )
        }
      ></PageHeader>
      <div className="organization-scope">
        <span className="organization-scope-icon">
          <Buildings size={24} weight="duotone" />
        </span>
        <div>
          <small>{text.currentEntity}</small>
          <strong>{data?.entityName ?? me.entityName}</strong>
        </div>
        <StatusBadge color="brand" size="sm" type="pill-color">
          {text.hrWorkspace}
        </StatusBadge>
      </div>
      {saved && (
        <div className="save-success organization-success" role="status">
          <CheckCircle size={18} />
          <span>{saved}</span>
          <Button
            variant="icon"
            aria-label={text.dismissSaved}
            onPress={() => setSaved("")}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <div className="organization-layout">
        <section
          className="panel organization-records"
          aria-label={text.recordsLabel}
        >
          <UTabs
            selectedKey={kind}
            onSelectionChange={(value) => filter("kind", String(value))}
          >
            <div className="organization-tabs-scroll">
              <UTabs.List
                type="underline"
                aria-label={text.typeLabel}
                className="organization-tabs"
              >
                {kinds.map((key) => (
                  <UTabs.Item key={key} id={key}>
                    {text.tabs[key]}
                  </UTabs.Item>
                ))}
              </UTabs.List>
            </div>
            <div className="organization-toolbar">
              <Input
                aria-label={text.searchLabel(label.plural)}
                placeholder={text.searchPlaceholder(label.singular)}
                maxLength={80}
                icon={MagnifyingGlass}
                value={search}
                onChange={(value: string) => filter("q", value)}
                className="organization-search"
              />
              {search && (
                <Button variant="ghost" onPress={() => filter("q", "")}>
                  {text.clearSearch}
                  <X size={15} />
                </Button>
              )}
            </div>
            <UTabs.Panel
              key={kind}
              id={kind}
              className="organization-tab-panel"
            >
              <div className="organization-count" aria-live="polite">
                <strong>
                  {text.count(data?.total, label.singular, label.plural)}
                </strong>
                <span>{text.countNote}</span>
              </div>
              {!holdsPeople(kind) && (
                <p className="organization-untracked">
                  <Info size={18} weight="duotone" />
                  <span>{text.untrackedNote(label.plural)}</span>
                </p>
              )}
              {error ? (
                <ErrorState
                  message={error.message}
                  onRetry={() => void refetch()}
                />
              ) : isPending ? (
                <LoadingState />
              ) : !data?.items.length ? (
                <EmptyBlock
                  icon={Icon}
                  title={
                    search ? text.noMatches : text.emptyTitle(label.plural)
                  }
                  description={
                    search ? text.noMatchesBody : text.emptyBody(label.singular)
                  }
                  action={
                    search ? (
                      <Button
                        variant="secondary"
                        onPress={() => filter("q", "")}
                      >
                        {text.clearSearch}
                      </Button>
                    ) : (
                      writable && (
                        <Button
                          variant="secondary"
                          onPress={() => setEditing("create")}
                        >
                          <Plus size={16} />
                          {text.add(label.singular)}
                        </Button>
                      )
                    )
                  }
                />
              ) : (
                <>
                  <DataCard
                    title={text.recordsLabel}
                    label={text.recordsTable}
                    rows={data.items}
                    getKey={(unit) => unit.id}
                    pageSize={20}
                    empty={null}
                    columns={[
                      {
                        id: "name",
                        label: text.columns[kind],
                        isRowHeader: true,
                        render: (unit) => <UnitName unit={unit} Icon={Icon} />,
                      },
                      {
                        id: "assigned",
                        label: text.columns.assigned,
                        render: assignedText,
                      },
                      {
                        id: "window",
                        label: text.columns.window,
                        render: (unit) => (
                          <span className="text-sm">{windowText(unit)}</span>
                        ),
                      },
                      {
                        id: "availability",
                        label: text.columns.availability,
                        render: (unit) => <StatusPill unit={unit} />,
                      },
                      {
                        id: "actions",
                        label: "",
                        render: (unit) => (
                          <RowActions
                            unit={unit}
                            writable={writable}
                            onEdit={() => setEditing(unit)}
                            onDetails={() => setDetailId(unit.id)}
                            onMerge={() => setMerging(unit)}
                          />
                        ),
                      },
                    ]}
                    mobileRow={(unit) => (
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <UnitName unit={unit} Icon={Icon} />
                          <p className="organization-mobile-line">
                            {assignedText(unit)}
                          </p>
                          <p className="organization-mobile-line text-sm text-tertiary">
                            {windowText(unit)}
                          </p>
                          <StatusPill unit={unit} />
                        </div>
                        <RowActions
                          unit={unit}
                          writable={writable}
                          onEdit={() => setEditing(unit)}
                          onDetails={() => setDetailId(unit.id)}
                          onMerge={() => setMerging(unit)}
                        />
                      </div>
                    )}
                  />
                  <div className="organization-pagination">
                    <span>{text.page(data.page, Math.max(data.pages, 1))}</span>
                    <div>
                      <Button
                        variant="secondary"
                        isDisabled={data.page <= 1}
                        onPress={() => filter("page", String(data.page - 1))}
                      >
                        <CaretLeft size={16} />
                        {text.previous}
                      </Button>
                      <Button
                        variant="secondary"
                        isDisabled={data.page >= data.pages}
                        onPress={() => filter("page", String(data.page + 1))}
                      >
                        {text.next}
                        <CaretRight size={16} />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </UTabs.Panel>
          </UTabs>
        </section>
        <aside className="organization-guide">
          <div className="organization-guide-symbol" aria-hidden="true">
            <TreeStructure size={32} weight="duotone" />
          </div>
          <p className="eyebrow">{text.guide.eyebrow}</p>
          <h2>
            {text.guide.heading1}
            <br />
            {text.guide.heading2}
          </h2>
          <p>{text.guide.body}</p>
          <div className="organization-guide-rule">
            <Archive size={21} />
            <div>
              <h3>{text.guide.inactivateTitle}</h3>
              <p>{text.guide.inactivateBody}</p>
            </div>
          </div>
          <div className="organization-guide-rule">
            <ArrowClockwise size={21} />
            <div>
              <h3>{text.guide.reactivateTitle}</h3>
              <p>{text.guide.reactivateBody}</p>
            </div>
          </div>
          <div className="organization-guide-rule">
            <CalendarCheck size={21} />
            <div>
              <h3>{text.guide.datesTitle}</h3>
              <p>{text.guide.datesBody}</p>
            </div>
          </div>
          <div className="organization-guide-rule">
            <GitMerge size={21} />
            <div>
              <h3>{text.guide.mergeTitle}</h3>
              <p>{text.guide.mergeBody}</p>
            </div>
          </div>
          <p className="organization-guide-footnote">{text.guide.footnote}</p>
        </aside>
      </div>
      {editing !== null && (
        <OrganizationEditor
          key={editing === "create" ? `new-${kind}` : editing.id}
          kind={kind}
          unit={editing === "create" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(unit, created) => void refreshAfterSave(unit, created)}
          onReload={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
      {detailId !== null && (
        <DetailDialog id={detailId} onClose={() => setDetailId(null)} />
      )}
      {mergeSource && (
        <MergeDialog
          key={mergeSource.id}
          unit={mergeSource}
          onClose={() => setMerging(null)}
          onRefresh={() => refreshAll()}
          onDone={(result) => {
            setMerging(null);
            setSaved(text.merge.banner(result.source.name, result.target.name));
          }}
        />
      )}
    </div>
  );
}

function UnitName({ unit, Icon }: { unit: OrganizationUnit; Icon: Icon }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`organization-unit-icon${unit.inEffect ? "" : " is-muted"}`}
      >
        <Icon size={20} weight="duotone" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-primary">{unit.name}</h2>
        <span className="organization-code">{unit.code}</span>
      </div>
    </div>
  );
}

function RowActions({
  unit,
  writable,
  onEdit,
  onDetails,
  onMerge,
}: {
  unit: OrganizationUnit;
  writable: boolean;
  onEdit: () => void;
  onDetails: () => void;
  onMerge: () => void;
}) {
  const closed = Boolean(unit.mergedIntoId);
  const canMerge = writable && !closed && mergeable(unit.kind);
  return (
    <div className="organization-row-actions">
      {writable && !closed && (
        <Button
          variant="icon"
          aria-label={text.edit(unit.name)}
          onPress={onEdit}
        >
          <PencilSimple size={19} />
        </Button>
      )}
      <Dropdown.Root>
        <Button variant="icon" aria-label={text.rowActions(unit.name)}>
          <DotsThreeVertical size={20} weight="bold" />
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            onAction={(key) => {
              if (key === "details") onDetails();
              if (key === "merge") onMerge();
            }}
          >
            <Dropdown.Item id="details" label={text.viewDetails} />
            {canMerge && <Dropdown.Item id="merge" label={text.mergeInto} />}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
    </div>
  );
}

function OrganizationEditor({
  kind,
  unit,
  onClose,
  onSaved,
  onReload,
}: {
  kind: UnitKind;
  unit: OrganizationUnit | null;
  onClose: () => void;
  onSaved: (unit: OrganizationUnit, created: boolean) => void;
  onReload: () => void;
}) {
  const { me } = useWorkspace();
  const [name, setName] = useState(unit?.name ?? "");
  const [code, setCode] = useState(unit?.code ?? "");
  const [active, setActive] = useState(unit?.active ?? true);
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState(unit?.effectiveFrom ?? "");
  const [to, setTo] = useState(unit?.effectiveTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"" | "stale" | "inUse">("");
  const dirty =
    !unit ||
    name.trim() !== unit.name ||
    active !== unit.active ||
    (from || unit.effectiveFrom) !== unit.effectiveFrom ||
    to !== (unit.effectiveTo ?? "");
  const label = labels[kind];
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (from && to && to < from) {
      setError(text.editor.dateOrder);
      setOutcome("");
      return;
    }
    const input = unit
      ? {
          name,
          active,
          version: unit.version,
          reason,
          ...(from ? { effectiveFrom: from } : {}),
          effectiveTo: to || null,
        }
      : {
          kind,
          code,
          name,
          reason,
          ...(from ? { effectiveFrom: from } : {}),
          ...(to ? { effectiveTo: to } : {}),
        };
    const parsed = unit
      ? organizationUpdateSchema.safeParse(input)
      : organizationCreateSchema.safeParse(input);
    if (!parsed.success) {
      const messages: Record<string, string> = text.editor.validation;
      setError(
        parsed.error.issues
          .map(
            (issue) =>
              messages[String(issue.path[0])] ??
              text.editor.validation.fallback,
          )
          .filter((value, index, values) => values.indexOf(value) === index)
          .join(" "),
      );
      setOutcome("");
      return;
    }
    setBusy(true);
    setError("");
    setOutcome("");
    try {
      const result = await api(
        unit ? `/organization/${unit.id}` : "/organization",
        organizationUnitSchema,
        {
          method: unit ? "PUT" : "POST",
          headers: { "X-CSRF-Token": me.csrfToken },
          body: JSON.stringify(parsed.data),
        },
      );
      onSaved(result, !unit);
    } catch (e) {
      const message = e instanceof Error ? e.message : text.editor.saveFailed;
      const conflict = e instanceof ApiError && e.status === 409;
      // A date change that would strand people is refused; the server says to merge.
      const inUse = conflict && /merge it into another/i.test(message);
      setOutcome(
        inUse
          ? "inUse"
          : unit && conflict && !/already exists/i.test(message)
            ? "stale"
            : "",
      );
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={text.editor.title(Boolean(unit), label.singular)}
      className="organization-editor"
    >
      <form
        onSubmit={(event) => void save(event)}
        className="organization-form"
      >
        <p className="organization-form-intro">
          {unit
            ? text.editor.introEdit
            : text.editor.introCreate(label.singular, me.entityName)}
        </p>
        <Input
          label={text.editor.name}
          autoFocus
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={60}
          value={name}
          onChange={setName}
          isDisabled={busy}
          autoComplete="off"
        />
        <Input
          label={text.editor.code}
          hint={unit ? text.editor.codeHelpEdit : text.editor.codeHelpCreate}
          isRequired
          hideRequiredIndicator
          isReadOnly={Boolean(unit)}
          minLength={2}
          maxLength={20}
          pattern={"[A-Z][A-Z0-9_\\-]{1,19}"}
          value={code}
          onChange={(value: string) => setCode(value.toUpperCase())}
          isDisabled={busy}
          autoComplete="off"
        />
        <div className="organization-dates">
          <RangeInput
            label={text.editor.effectiveFrom}
            hint={text.editor.effectiveFromHint}
            type="date"
            min="1900-01-01"
            max="2199-12-31"
            value={from}
            onChange={setFrom}
            isDisabled={busy}
          />
          <RangeInput
            label={text.editor.effectiveTo}
            hint={text.editor.effectiveToHint}
            type="date"
            min={from || "1900-01-01"}
            max="2199-12-31"
            value={to}
            onChange={setTo}
            isDisabled={busy}
          />
        </div>
        {unit && (
          <div className="organization-state-choice">
            <span className="organization-legend" id="organization-avail">
              {text.editor.availability}
            </span>
            <RadioGroup
              aria-labelledby="organization-avail"
              value={active ? "active" : "inactive"}
              onChange={(value) => setActive(value === "active")}
              isDisabled={busy}
              size="md"
              className="gap-3"
            >
              <RadioButton
                value="active"
                label={text.status.in_effect}
                hint={text.editor.activeNote}
              />
              <RadioButton
                value="inactive"
                label={text.status.inactive}
                hint={text.editor.inactiveNote}
              />
            </RadioGroup>
          </div>
        )}
        {unit && !active && unit.active && (
          <p className="organization-impact">
            {holdsPeople(kind)
              ? text.editor.impact(unit.employeeCount, label.singular)
              : text.editor.impact(0, label.singular)}
          </p>
        )}
        <TextArea
          label={text.editor.reason}
          hint={text.editor.reasonHelp}
          isRequired
          hideRequiredIndicator
          minLength={10}
          maxLength={300}
          rows={3}
          value={reason}
          onChange={setReason}
          isDisabled={busy}
        />
        {error && (
          <div className="inline-error organization-form-error" role="alert">
            <p>{error}</p>
            {outcome === "inUse" && <p>{text.editor.inUse}</p>}
            {outcome === "stale" && (
              <>
                <p>{text.editor.conflict}</p>
                <Button variant="secondary" onPress={onReload}>
                  {text.editor.reload}
                  <ArrowClockwise size={16} />
                </Button>
              </>
            )}
          </div>
        )}
        <div className="organization-form-actions">
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            {text.editor.cancel}
          </Button>
          <Button
            type="submit"
            isDisabled={busy || !dirty || outcome === "stale"}
          >
            {busy
              ? text.editor.saving
              : unit
                ? text.editor.saveChanges
                : text.editor.create(label.singular)}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, isPending, refetch } = useOrganizationDetail(id);
  const item = data?.item;
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item ? text.detail.title(item.name) : text.detail.loading}
      className="organization-detail"
    >
      {error ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : isPending || !data || !item ? (
        <LoadingState />
      ) : (
        <div className="organization-detail-body">
          {item.mergedIntoId && (
            <p className="organization-impact">{text.detail.closedNote}</p>
          )}
          <dl className="organization-facts">
            <div>
              <dt>{text.detail.code}</dt>
              <dd>{item.code}</dd>
            </div>
            <div>
              <dt>{text.detail.kind}</dt>
              <dd>{labels[item.kind].singular}</dd>
            </div>
            <div>
              <dt>{text.detail.status}</dt>
              <dd>
                <StatusPill unit={item} />
              </dd>
            </div>
            <div>
              <dt>{text.detail.window}</dt>
              <dd>{windowText(item)}</dd>
            </div>
            <div>
              <dt>{text.detail.people}</dt>
              <dd>{assignedText(item)}</dd>
            </div>
          </dl>
          <h3 className="organization-detail-heading">{text.detail.history}</h3>
          {!data.mergedInto && data.mergedFrom.length === 0 ? (
            <p className="organization-muted">{text.detail.noHistory}</p>
          ) : (
            <ul className="organization-history">
              {data.mergedInto && (
                <li>
                  <GitMerge size={18} />
                  <span>
                    <strong>{text.detail.mergedInto}</strong>{" "}
                    {data.mergedInto.name} ({data.mergedInto.code})
                    {data.mergedInto.mergedAt &&
                      ` ${text.detail.mergedOn(fmtDate(data.mergedInto.mergedAt.slice(0, 10)))}`}
                  </span>
                </li>
              )}
              {data.mergedFrom.map((source) => (
                <li key={source.id}>
                  <GitMerge size={18} />
                  <span>
                    <strong>{text.detail.mergedFrom}</strong> {source.name} (
                    {source.code})
                    {source.mergedAt &&
                      ` ${text.detail.mergedOn(fmtDate(source.mergedAt.slice(0, 10)))}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </DialogPanel>
  );
}

function MergeDialog({
  unit,
  onClose,
  onRefresh,
  onDone,
}: {
  unit: OrganizationUnit;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
  onDone: (result: OrganizationMergeResult) => void;
}) {
  const { me } = useWorkspace();
  const label = labels[unit.kind];
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [find, setFind] = useState("");
  const [searchable, setSearchable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<OrganizationMergeResult | null>(null);
  const targets = useOrganization(
    new URLSearchParams({
      kind: unit.kind,
      q: find,
      page: "1",
      limit: "50",
    }).toString(),
  );
  if (targets.data && targets.data.pages > 1 && !searchable)
    setSearchable(true);
  const choices = (targets.data?.items ?? []).filter(
    (item) => item.inEffect && !item.mergedIntoId && item.id !== unit.id,
  );
  const target = choices.find((item) => item.id === targetId) ?? null;
  const closed = Boolean(unit.mergedIntoId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || closed) return;
    if (!target) {
      setError(text.merge.needTarget);
      setNote("");
      return;
    }
    const parsed = organizationMergeSchema.safeParse({
      targetId: target.id,
      version: unit.version,
      targetVersion: target.version,
      reason,
    });
    if (!parsed.success) {
      setError(text.merge.reasonInvalid);
      setNote("");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const merged = await api(
        `/organization/${unit.id}/merge`,
        organizationMergeResultSchema,
        {
          method: "POST",
          headers: { "X-CSRF-Token": me.csrfToken },
          body: JSON.stringify(parsed.data),
        },
      );
      setResult(merged);
      await onRefresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : text.merge.failed;
      setError(message);
      if (e instanceof ApiError && e.status === 409) {
        // Stale or busy: reload the latest versions so the next attempt is accurate.
        setNote(text.merge.stale);
        await onRefresh();
      } else if (e instanceof ApiError && e.status === 400) {
        setNote(/policy|holiday/i.test(message) ? text.merge.inUse : "");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (open || busy) return;
        if (result) onDone(result);
        else onClose();
      }}
      title={result ? text.merge.doneTitle : text.merge.title(unit.name)}
      className="organization-editor"
    >
      {result ? (
        <div className="organization-form">
          <p className="organization-form-intro" role="status">
            {text.merge.done(result.source.name, result.target.name)}
          </p>
          <ul className="organization-history organization-moved">
            <li>{text.merge.movedActive(result.movedActive)}</li>
            <li>{text.merge.movedInactive(result.movedInactive)}</li>
            <li>{text.merge.movedCandidates(result.movedCandidates)}</li>
          </ul>
          <div className="organization-form-actions">
            <Button onPress={() => onDone(result)}>{text.merge.finish}</Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          className="organization-form"
        >
          <p className="organization-form-intro">
            {text.merge.intro(label.singular, unit.name)}
          </p>
          {closed && <p className="organization-impact">{text.merge.closed}</p>}
          {searchable && (
            <Input
              label={text.merge.searchTargets}
              maxLength={80}
              icon={MagnifyingGlass}
              value={find}
              onChange={setFind}
              isDisabled={busy}
            />
          )}
          {targets.error ? (
            <ErrorState
              message={text.merge.loadFailed}
              onRetry={() => void targets.refetch()}
            />
          ) : targets.isPending ? (
            <LoadingState />
          ) : choices.length === 0 ? (
            <p className="organization-impact">
              {text.merge.noTargets(label.singular)}
            </p>
          ) : (
            <Select
              label={text.merge.target(label.singular)}
              hint={
                targets.data && targets.data.pages > 1
                  ? `${text.merge.targetHint} ${text.merge.moreTargets}`
                  : text.merge.targetHint
              }
              placeholder={text.merge.placeholder}
              selectedKey={target?.id ?? null}
              onSelectionChange={(key) => setTargetId(String(key ?? ""))}
              isDisabled={busy || closed}
            >
              {choices.map((choice) => (
                <Select.Item
                  key={choice.id}
                  id={choice.id}
                  label={choice.name}
                  supportingText={choice.code}
                />
              ))}
            </Select>
          )}
          <div className="organization-counts">
            <strong>{text.merge.countsTitle}</strong>
            <ul>
              <li>{text.merge.sourceCount(unit.name, unit.employeeCount)}</li>
              {target && (
                <>
                  <li>
                    {text.merge.targetCount(target.name, target.employeeCount)}
                  </li>
                  <li>
                    {text.merge.afterCount(
                      target.name,
                      target.employeeCount + unit.employeeCount,
                    )}
                  </li>
                </>
              )}
            </ul>
            <small>{text.merge.countsNote}</small>
          </div>
          <TextArea
            label={text.merge.reason}
            hint={text.merge.reasonHint}
            isRequired
            hideRequiredIndicator
            minLength={10}
            maxLength={300}
            rows={3}
            value={reason}
            onChange={setReason}
            isDisabled={busy || closed}
          />
          {error && (
            <div className="inline-error organization-form-error" role="alert">
              <p>{error}</p>
              {note && <p>{note}</p>}
            </div>
          )}
          <div className="organization-form-actions">
            <Button variant="secondary" isDisabled={busy} onPress={onClose}>
              {text.merge.cancel}
            </Button>
            <Button type="submit" isDisabled={busy || closed || !target}>
              {busy ? text.merge.merging : text.merge.submit}
            </Button>
          </div>
        </form>
      )}
    </DialogPanel>
  );
}
