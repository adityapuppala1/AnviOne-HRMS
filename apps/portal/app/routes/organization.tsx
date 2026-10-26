import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Badge,
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
  Tabs,
  TabList,
  Tab,
  TabPanel,
} from "@anvi/ui";
import {
  organizationUnitSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  type OrganizationUnit,
} from "@anvi/contracts";
import { api, ApiError, useOrganization } from "../lib/api";
import { useWorkspace } from "./workspace";
import { organizationCopy as text } from "../lib/copy/organization";
import "./organization.css";

type UnitKind = OrganizationUnit["kind"];
const labels: Record<UnitKind, { singular: string; plural: string }> =
  text.kinds;

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
  const [saved, setSaved] = useState("");
  const kind: UnitKind =
    params.get("kind") === "location" ? "location" : "department";
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
  const Icon = kind === "department" ? TreeStructure : MapPin;
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

  async function refreshAfterSave(unit: OrganizationUnit, created: boolean) {
    setEditing(null);
    setSaved(text.saved(unit.name, created));
    // Renames must be reflected by the scoped directory, profiles and chart labels.
    await Promise.all([
      client.invalidateQueries({ queryKey: ["organization"] }),
      client.invalidateQueries({ queryKey: ["directory"] }),
      client.invalidateQueries({ queryKey: ["employee"] }),
      client.invalidateQueries({ queryKey: ["dashboard"] }),
      client.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  }

  return (
    <div className="page-enter organization-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.heading}</h1>
          <p>{text.intro}</p>
        </div>
        {writable && (
          <Button onPress={() => setEditing("create")}>
            <Plus size={18} />
            {text.add(label.singular)}
          </Button>
        )}
      </div>
      <div className="organization-scope">
        <span className="organization-scope-icon">
          <Buildings size={24} weight="duotone" />
        </span>
        <div>
          <small>{text.currentEntity}</small>
          <strong>{data?.entityName ?? me.entityName}</strong>
        </div>
        <Badge>{text.hrWorkspace}</Badge>
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
          <Tabs
            selectedKey={kind}
            onSelectionChange={(value) => filter("kind", String(value))}
          >
            <TabList aria-label={text.typeLabel} className="tabs-list">
              <Tab id="department" className="tab">
                <TreeStructure size={18} />
                {text.departments}
              </Tab>
              <Tab id="location" className="tab">
                <MapPin size={18} />
                {text.locations}
              </Tab>
            </TabList>
            <div className="organization-toolbar">
              <label className="search-box">
                <MagnifyingGlass size={19} />
                <input
                  aria-label={text.searchLabel(label.plural)}
                  placeholder={text.searchPlaceholder(label.singular)}
                  maxLength={80}
                  value={search}
                  onChange={(event) => filter("q", event.target.value)}
                />
              </label>
              {search && (
                <Button variant="ghost" onPress={() => filter("q", "")}>
                  {text.clearSearch}
                  <X size={15} />
                </Button>
              )}
            </div>
            <TabPanel id={kind} className="organization-tab-panel">
              <div className="organization-count" aria-live="polite">
                <strong>
                  {text.count(data?.total, label.singular, label.plural)}
                </strong>
                <span>{text.countNote}</span>
              </div>
              {error ? (
                <ErrorState
                  message={error.message}
                  onRetry={() => void refetch()}
                />
              ) : isPending ? (
                <LoadingState />
              ) : !data?.items.length ? (
                <div className="organization-empty">
                  <Icon size={32} weight="duotone" />
                  <h2>
                    {search ? text.noMatches : text.emptyTitle(label.plural)}
                  </h2>
                  <p>
                    {search
                      ? text.noMatchesBody
                      : text.emptyBody(label.singular)}
                  </p>
                  {search ? (
                    <Button variant="secondary" onPress={() => filter("q", "")}>
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
                  )}
                </div>
              ) : (
                <>
                  <div
                    className="organization-column-labels"
                    aria-hidden="true"
                  >
                    <span>{text.columns[kind]}</span>
                    <span>{text.columns.assigned}</span>
                    <span>{text.columns.availability}</span>
                    <span />
                  </div>
                  <div className="organization-list">
                    {data.items.map((unit) => (
                      <article
                        className={`organization-row ${unit.active ? "" : "is-inactive"}`}
                        key={unit.id}
                      >
                        <div className="organization-record-name">
                          <span className="organization-unit-icon">
                            <Icon size={22} weight="duotone" />
                          </span>
                          <div>
                            <h2>{unit.name}</h2>
                            <span className="organization-code">
                              {unit.code}
                            </span>
                          </div>
                        </div>
                        <div className="organization-assigned">
                          <small>{text.columns.assigned}</small>
                          <strong>{unit.employeeCount}</strong>
                          <span>
                            {unit.employeeCount === 1
                              ? text.person
                              : text.people}
                          </span>
                        </div>
                        <div className="organization-availability">
                          <Badge tone={unit.active ? "green" : "amber"}>
                            {unit.active ? text.active : text.inactive}
                          </Badge>
                        </div>
                        {writable ? (
                          <Button
                            variant="icon"
                            aria-label={text.edit(unit.name)}
                            onPress={() => setEditing(unit)}
                          >
                            <PencilSimple size={19} />
                          </Button>
                        ) : (
                          <span />
                        )}
                      </article>
                    ))}
                  </div>
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
            </TabPanel>
          </Tabs>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const dirty = !unit || name.trim() !== unit.name || active !== unit.active;
  const label = labels[kind];
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const input = unit
      ? { name, active, version: unit.version, reason }
      : { kind, code, name, reason };
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
      return;
    }
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const saved = await api(
        unit ? `/organization/${unit.id}` : "/organization",
        organizationUnitSchema,
        {
          method: unit ? "PUT" : "POST",
          headers: { "X-CSRF-Token": me.csrfToken },
          body: JSON.stringify(parsed.data),
        },
      );
      onSaved(saved, !unit);
    } catch (e) {
      setConflict(Boolean(unit && e instanceof ApiError && e.status === 409));
      setError(e instanceof Error ? e.message : text.editor.saveFailed);
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
        <label htmlFor="organization-name">
          <strong>{text.editor.name}</strong>
          <input
            id="organization-name"
            autoFocus
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </label>
        <div className="organization-field">
          <label htmlFor="organization-code">
            <strong>{text.editor.code}</strong>
          </label>
          <input
            id="organization-code"
            required
            readOnly={Boolean(unit)}
            minLength={2}
            maxLength={20}
            pattern={"[A-Z][A-Z0-9_\\-]{1,19}"}
            aria-describedby="organization-code-help"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            disabled={busy}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <small id="organization-code-help">
            {unit ? text.editor.codeHelpEdit : text.editor.codeHelpCreate}
          </small>
        </div>
        {unit && (
          <fieldset className="organization-state-choice">
            <legend>{text.editor.availability}</legend>
            <label className={active ? "selected" : ""}>
              <input
                type="radio"
                name="organization-active"
                value="active"
                checked={active}
                onChange={() => setActive(true)}
                disabled={busy}
              />
              <div>
                <strong>{text.active}</strong>
                <span>{text.editor.activeNote}</span>
              </div>
              <CheckCircle size={20} />
            </label>
            <label className={!active ? "selected" : ""}>
              <input
                type="radio"
                name="organization-active"
                value="inactive"
                checked={!active}
                onChange={() => setActive(false)}
                disabled={busy}
              />
              <div>
                <strong>{text.inactive}</strong>
                <span>{text.editor.inactiveNote}</span>
              </div>
              <Archive size={20} />
            </label>
          </fieldset>
        )}
        {unit && !active && unit.active && (
          <p className="organization-impact">
            {text.editor.impact(unit.employeeCount, label.singular)}
          </p>
        )}
        <div className="organization-field">
          <label htmlFor="organization-reason">
            <strong>{text.editor.reason}</strong>
          </label>
          <textarea
            id="organization-reason"
            required
            minLength={10}
            maxLength={300}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="organization-reason-help"
            disabled={busy}
          />
          <small id="organization-reason-help">{text.editor.reasonHelp}</small>
        </div>
        {error && (
          <div className="inline-error organization-form-error" role="alert">
            <p>{error}</p>
            {conflict && (
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
          <Button type="submit" isDisabled={busy || !dirty || conflict}>
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
