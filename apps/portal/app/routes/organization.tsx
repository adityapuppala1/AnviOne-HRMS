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
import "./organization.css";

type UnitKind = OrganizationUnit["kind"];
const labels: Record<UnitKind, { singular: string; plural: string }> = {
  department: { singular: "department", plural: "departments" },
  location: { singular: "location", plural: "locations" },
};

export default function Organization() {
  const { me } = useWorkspace();
  return me.permissions.includes("organization.read") ? (
    <OrganizationRecords />
  ) : (
    <ErrorState message="Organization records require an assigned HR admin workspace." />
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
    setSaved(`${unit.name} ${created ? "created" : "saved"}.`);
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
          <p className="eyebrow">Organization</p>
          <h1>Organization, kept in order.</h1>
          <p>Manage the departments and locations your people belong to.</p>
        </div>
        {writable && (
          <Button onPress={() => setEditing("create")}>
            <Plus size={18} />
            Add {label.singular}
          </Button>
        )}
      </div>
      <div className="organization-scope">
        <span className="organization-scope-icon">
          <Buildings size={24} weight="duotone" />
        </span>
        <div>
          <small>Current legal entity</small>
          <strong>{data?.entityName ?? me.entityName}</strong>
        </div>
        <Badge>HR workspace</Badge>
      </div>
      {saved && (
        <div className="save-success organization-success" role="status">
          <CheckCircle size={18} />
          <span>{saved}</span>
          <Button
            variant="icon"
            aria-label="Dismiss saved message"
            onPress={() => setSaved("")}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <div className="organization-layout">
        <section
          className="panel organization-records"
          aria-label="Organization records"
        >
          <Tabs
            selectedKey={kind}
            onSelectionChange={(value) => filter("kind", String(value))}
          >
            <TabList
              aria-label="Organization record type"
              className="tabs-list"
            >
              <Tab id="department" className="tab">
                <TreeStructure size={18} />
                Departments
              </Tab>
              <Tab id="location" className="tab">
                <MapPin size={18} />
                Locations
              </Tab>
            </TabList>
            <div className="organization-toolbar">
              <label className="search-box">
                <MagnifyingGlass size={19} />
                <input
                  aria-label={`Search ${label.plural}`}
                  placeholder={`Find a ${label.singular} by name or code…`}
                  maxLength={80}
                  value={search}
                  onChange={(event) => filter("q", event.target.value)}
                />
              </label>
              {search && (
                <Button variant="ghost" onPress={() => filter("q", "")}>
                  Clear search
                  <X size={15} />
                </Button>
              )}
            </div>
            <TabPanel id={kind} className="organization-tab-panel">
              <div className="organization-count" aria-live="polite">
                <strong>
                  {data?.total ?? "…"}{" "}
                  {data?.total === 1 ? label.singular : label.plural}
                </strong>
                <span>Active and inactive records</span>
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
                    {search
                      ? "No matching records"
                      : `Your ${label.plural} start here`}
                  </h2>
                  <p>
                    {search
                      ? "Try a different name or code, or clear your search."
                      : `Add the first ${label.singular} for this legal entity.`}
                  </p>
                  {search ? (
                    <Button variant="secondary" onPress={() => filter("q", "")}>
                      Clear search
                    </Button>
                  ) : (
                    writable && (
                      <Button
                        variant="secondary"
                        onPress={() => setEditing("create")}
                      >
                        <Plus size={16} />
                        Add {label.singular}
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
                    <span>
                      {kind === "department" ? "Department" : "Location"}
                    </span>
                    <span>Assigned people</span>
                    <span>Availability</span>
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
                          <small>Assigned people</small>
                          <strong>{unit.employeeCount}</strong>
                          <span>
                            {unit.employeeCount === 1 ? "person" : "people"}
                          </span>
                        </div>
                        <div className="organization-availability">
                          <Badge tone={unit.active ? "green" : "amber"}>
                            {unit.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        {writable ? (
                          <Button
                            variant="icon"
                            aria-label={`Edit ${unit.name}`}
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
                    <span>
                      Page {data.page} of {Math.max(data.pages, 1)}
                    </span>
                    <div>
                      <Button
                        variant="secondary"
                        isDisabled={data.page <= 1}
                        onPress={() => filter("page", String(data.page - 1))}
                      >
                        <CaretLeft size={16} />
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        isDisabled={data.page >= data.pages}
                        onPress={() => filter("page", String(data.page + 1))}
                      >
                        Next
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
          <p className="eyebrow">Keep the connections</p>
          <h2>
            Names can change.
            <br />
            History stays connected.
          </h2>
          <p>
            Each record has a permanent code. Rename it as your organization
            evolves.
          </p>
          <div className="organization-guide-rule">
            <Archive size={21} />
            <div>
              <h3>Inactivate, retain history</h3>
              <p>
                Inactive records remain on existing profiles and cannot be used
                for new assignments.
              </p>
            </div>
          </div>
          <div className="organization-guide-rule">
            <ArrowClockwise size={21} />
            <div>
              <h3>Ready to use again?</h3>
              <p>
                Reactivate a record to make it available for future assignments.
              </p>
            </div>
          </div>
          <p className="organization-guide-footnote">
            Every change records your reason in the audit history.
          </p>
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
      const messages: Record<string, string> = {
        name: "Enter a name between 2 and 60 characters.",
        code: "Use a code of 2–20 characters, starting with a letter, with uppercase letters, numbers, underscores or hyphens.",
        reason: "Explain the change in 10–300 characters.",
      };
      setError(
        parsed.error.issues
          .map(
            (issue) =>
              messages[String(issue.path[0])] ??
              "Review the form and try again.",
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
      setError(
        e instanceof Error
          ? e.message
          : "The record could not be saved. Try again.",
      );
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
      title={unit ? `Edit ${label.singular}` : `Add ${label.singular}`}
      className="organization-editor"
    >
      <form
        onSubmit={(event) => void save(event)}
        className="organization-form"
      >
        <p className="organization-form-intro">
          {unit
            ? "Update this record for your current legal entity."
            : `Create a ${label.singular} for ${me.entityName}.`}
        </p>
        <label htmlFor="organization-name">
          <strong>Name</strong>
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
            <strong>Permanent code</strong>
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
            {unit
              ? "This code stays the same throughout the record's history."
              : "2–20 characters. Start with a letter; use uppercase letters, numbers, underscores or hyphens."}
          </small>
        </div>
        {unit && (
          <fieldset className="organization-state-choice">
            <legend>Availability</legend>
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
                <strong>Active</strong>
                <span>Available for future assignments</span>
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
                <strong>Inactive</strong>
                <span>Retain existing assignments and history</span>
              </div>
              <Archive size={20} />
            </label>
          </fieldset>
        )}
        {unit && !active && unit.active && (
          <p className="organization-impact">
            {unit.employeeCount}{" "}
            {unit.employeeCount === 1
              ? "person keeps their existing assignment"
              : "people keep their existing assignments"}
            . This {label.singular} will be unavailable for new assignments.
          </p>
        )}
        <div className="organization-field">
          <label htmlFor="organization-reason">
            <strong>Reason for change</strong>
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
          <small id="organization-reason-help">
            Explain the organization change in 10–300 characters. Avoid
            confidential employee details.
          </small>
        </div>
        {error && (
          <div className="inline-error organization-form-error" role="alert">
            <p>{error}</p>
            {conflict && (
              <>
                <p>
                  Another change may have been saved. Reload the list and review
                  the latest record before trying again.
                </p>
                <Button variant="secondary" onPress={onReload}>
                  Reload list
                  <ArrowClockwise size={16} />
                </Button>
              </>
            )}
          </div>
        )}
        <div className="organization-form-actions">
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={busy || !dirty || conflict}>
            {busy
              ? "Saving…"
              : unit
                ? "Save changes"
                : `Create ${label.singular}`}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
