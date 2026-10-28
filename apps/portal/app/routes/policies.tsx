import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Scroll } from "@phosphor-icons/react/dist/csr/Scroll";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import {
  Button,
  CollectionView,
  type Column,
  Checkbox,
  DialogPanel,
  EmptyBlock,
  Input,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import {
  myPoliciesSchema,
  myPolicyDetailSchema,
  policyDetailSchema,
  type MyPolicy,
  type PolicyCategory,
  type PolicyDetail,
  type PolicyList,
  type PolicyVersionDetail,
} from "@anvi/contracts";
import {
  api,
  ApiError,
  useMyPolicies,
  useOrganization,
  usePolicies,
  usePolicy,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { policiesCopy as text } from "../lib/copy/policies";
import { useWorkspace } from "./workspace";
// Shared dialog form styles come from the leave screen.
import "./leave.css";
import "./policies.css";

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

const categoryKeys = Object.keys(text.categories) as PolicyCategory[];
type ListItem = PolicyList["items"][number];
type Department = { id: string; name: string };

export default function Policies() {
  const { me } = useWorkspace();
  if (me.permissions.includes("policy.manage")) return <ManageView />;
  if (me.permissions.includes("policy.self")) return <EmployeeView />;
  return <ErrorState message={text.denied} />;
}

/* Shared helpers --------------------------------------------------------- */

function usePolicyRequest() {
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
      return await api(path, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      // A stale version means someone else changed it: show the latest.
      if (cause instanceof ApiError && cause.status === 409)
        void client.invalidateQueries({ queryKey: ["policies"] });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError, client };
}

function FormActions({
  busy,
  cancel,
  submit,
  saving,
  onCancel,
}: {
  busy: boolean;
  cancel: string;
  submit: string;
  saving: string;
  onCancel: () => void;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" isDisabled={busy}>
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

function audienceName(version: { audienceDepartment: Department | null }) {
  return version.audienceDepartment?.name ?? text.list.everyone;
}

function VersionChips({ item }: { item: ListItem }) {
  return (
    <>
      {item.current && (
        <StatusBadge color="success" size="sm" type="pill-color">
          {text.list.published(item.current.versionNumber)}
        </StatusBadge>
      )}
      {item.draft && (
        <StatusBadge color="warning" size="sm" type="pill-color">
          {text.list.draft(item.draft.versionNumber)}
        </StatusBadge>
      )}
      {!item.current && !item.draft && (
        <StatusBadge color="gray" size="sm" type="pill-color">
          {text.list.withdrawn}
        </StatusBadge>
      )}
    </>
  );
}

/* HR view ---------------------------------------------------------------- */

function ManageView() {
  const { reduceMotion } = usePreferences();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, isPending, refetch } = usePolicies(true);
  const units = useOrganization("kind=department&limit=50");
  const departments: Department[] = (units.data?.items ?? [])
    .filter((unit) => unit.active)
    .map((unit) => ({ id: unit.id, name: unit.name }));
  const term = search.trim().toLowerCase();
  const filtered = Boolean(term || category);
  const items = (data?.items ?? []).filter(
    (item) =>
      (!category || item.category === category) &&
      (!term ||
        item.code.toLowerCase().includes(term) ||
        item.title.toLowerCase().includes(term)),
  );
  const counts = data?.counts;
  return (
    <div className="page-enter policies-page">
      <PageHeader
        title={text.title}
        description={text.subtitle}
        actions={
          <Button onPress={() => setAdding(true)}>
            <Plus size={18} weight="bold" />
            {text.newButton}
          </Button>
        }
      />
      <div className="policies-stats">
        <StatCard
          label={text.stats.published}
          value={counts?.published ?? 0}
          hint={text.stats.publishedHint}
          icon={Scroll}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.drafts}
          value={counts?.drafts ?? 0}
          hint={text.stats.draftsHint}
          icon={PencilSimple}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.outstanding}
          value={counts?.outstanding ?? 0}
          hint={text.stats.outstandingHint}
          icon={Hourglass}
          animate={!reduceMotion}
        />
      </div>
      <section
        className="panel policies-panel"
        aria-labelledby="policies-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="policies-heading">{text.list.heading}</h2>
            {data && <p aria-live="polite">{text.list.total(items.length)}</p>}
          </div>
        </div>
        <div className="directory-toolbar policies-toolbar">
          <Input
            aria-label={text.toolbar.searchLabel}
            placeholder={text.toolbar.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={search}
            onChange={setSearch}
            className="policies-search"
          />
          <Select
            aria-label={text.toolbar.categoryLabel}
            selectedKey={category || "all"}
            onSelectionChange={(key) =>
              setCategory(key === "all" ? "" : String(key))
            }
            className="policies-filter"
          >
            <Select.Item id="all" label={text.toolbar.allCategories} />
            {categoryKeys.map((key) => (
              <Select.Item key={key} id={key} label={text.categories[key]} />
            ))}
          </Select>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyBlock
              icon={Scroll}
              title={text.list.noMatchTitle}
              description={text.list.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    setSearch("");
                    setCategory("");
                  }}
                >
                  {text.list.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              icon={Scroll}
              title={text.list.emptyTitle}
              description={text.list.emptyBody}
              action={
                <Button onPress={() => setAdding(true)}>
                  {text.newButton}
                </Button>
              }
            />
          )
        ) : (
          <CollectionView
            id="policies-hr"
            label={text.list.heading}
            noun="policies"
            items={items}
            getKey={(item) => item.id}
            columns={policyColumns(setOpenId)}
            renderCard={(item) => (
              <PolicyRow item={item} onOpen={() => setOpenId(item.id)} />
            )}
            onOpen={(item) => setOpenId(item.id)}
            defaultView="table"
          />
        )}
      </section>
      <PolicyDialog
        open={adding}
        departments={departments}
        onClose={() => setAdding(false)}
        onCreated={(detail) => {
          setAdding(false);
          setOpenId(detail.policy.id);
        }}
      />
      <DetailsDialog
        id={openId}
        departments={departments}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function policyColumns(open: (id: string) => void): Column<ListItem>[] {
  return [
    {
      id: "code",
      label: "Code",
      isRowHeader: true,
      sortValue: (item) => item.code,
      render: (item) => <strong className="text-sm">{item.code}</strong>,
    },
    {
      id: "title",
      label: "Policy",
      sortValue: (item) => item.title,
      render: (item) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-primary">{item.title}</span>
          <small className="text-tertiary">
            {text.categories[item.category]}
          </small>
        </span>
      ),
    },
    {
      id: "version",
      label: "Version",
      render: (item) => <VersionChips item={item} />,
    },
    {
      id: "effective",
      label: "Effective",
      sortValue: (item) => (item.current ?? item.draft)?.effectiveOn ?? "",
      render: (item) => {
        const v = item.current ?? item.draft;
        return <span className="text-sm">{v ? day(v.effectiveOn) : ""}</span>;
      },
    },
    {
      id: "ack",
      label: "Acknowledged",
      render: (item) =>
        item.current?.requiresAcknowledgement && item.stats ? (
          <span className="text-sm">
            {text.list.acknowledged(
              item.stats.acknowledged,
              item.stats.audience,
            )}
          </span>
        ) : null,
    },
    {
      id: "open",
      label: "",
      render: (item) => (
        <Button
          variant="secondary"
          onPress={() => open(item.id)}
          aria-label={text.list.openLabel(item.code)}
        >
          {text.list.open}
        </Button>
      ),
    },
  ];
}

function PolicyRow({ item, onOpen }: { item: ListItem; onOpen: () => void }) {
  const version = item.current ?? item.draft;
  const progress =
    item.current?.requiresAcknowledgement && item.stats ? item.stats : null;
  const percent = progress
    ? progress.audience === 0
      ? 0
      : Math.min(
          100,
          Math.round((progress.acknowledged / progress.audience) * 100),
        )
    : 0;
  return (
    <div className="policies-row">
      <div className="policies-main">
        <div className="policies-title">
          <strong className="policies-code">{item.code}</strong>
          <span>{item.title}</span>
        </div>
        <small>{text.categories[item.category]}</small>
        {version && <p className="policies-summary">{version.summary}</p>}
        <div className="policies-meta">
          <VersionChips item={item} />
          {version && (
            <>
              <small>{text.list.audience(audienceName(version))}</small>
              <small>{text.list.effective(day(version.effectiveOn))}</small>
            </>
          )}
        </div>
        {progress && (
          <div className="policies-progress">
            <span>
              {text.list.acknowledged(progress.acknowledged, progress.audience)}
            </span>
            <div className="policies-bar" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        onPress={onOpen}
        aria-label={text.list.openLabel(item.code)}
      >
        {text.list.open}
      </Button>
    </div>
  );
}

/* Content fields (create + edit) ---------------------------------------- */

function readContent(form: FormData) {
  return {
    title: String(form.get("title") ?? "").trim(),
    summary: String(form.get("summary") ?? "").trim(),
    body: String(form.get("body") ?? "").trim(),
    effectiveOn: String(form.get("effectiveOn") ?? ""),
    requiresAcknowledgement: form.get("requires") === "on",
    audienceDepartmentId:
      form.get("audience") && form.get("audience") !== "all"
        ? String(form.get("audience"))
        : null,
  };
}

function ContentFields({
  departments,
  defaults,
}: {
  departments: Department[];
  defaults: {
    title: string;
    summary: string;
    body: string;
    effectiveOn: string;
    requiresAcknowledgement: boolean;
    audience: Department | null;
  };
}) {
  const [length, setLength] = useState(defaults.body.length);
  const options =
    defaults.audience &&
    !departments.some((dept) => dept.id === defaults.audience?.id)
      ? [...departments, defaults.audience]
      : departments;
  return (
    <>
      <Input
        name="title"
        label={text.form.title}
        defaultValue={defaults.title}
        isRequired
        hideRequiredIndicator
        minLength={3}
        maxLength={120}
        autoComplete="off"
      />
      <TextArea
        name="summary"
        label={text.form.summary}
        hint={text.form.summaryHint}
        textAreaClassName="policies-summary-input"
        defaultValue={defaults.summary}
        isRequired
        hideRequiredIndicator
        minLength={10}
        maxLength={300}
      />
      <TextArea
        name="body"
        label={text.form.body}
        hint={`${text.form.bodyHint} ${text.form.count(length)}`}
        textAreaClassName="policies-body-input"
        defaultValue={defaults.body}
        isRequired
        hideRequiredIndicator
        minLength={20}
        maxLength={20000}
        onChange={(value) => setLength(value.length)}
      />
      <Input
        name="effectiveOn"
        type="date"
        label={text.form.effectiveOn}
        defaultValue={defaults.effectiveOn}
        isRequired
        hideRequiredIndicator
      />
      <Select
        name="audience"
        label={text.form.audience}
        defaultSelectedKey={defaults.audience?.id ?? "all"}
      >
        <Select.Item id="all" label={text.form.everyone} />
        {options.map((dept) => (
          <Select.Item key={dept.id} id={dept.id} label={dept.name} />
        ))}
      </Select>
      <Checkbox
        name="requires"
        defaultSelected={defaults.requiresAcknowledgement}
        label={text.form.requires}
        className="policies-check"
      />
    </>
  );
}

/* Create ---------------------------------------------------------------- */

function PolicyDialog({
  open,
  departments,
  onClose,
  onCreated,
}: {
  open: boolean;
  departments: Department[];
  onClose: () => void;
  onCreated: (detail: PolicyDetail) => void;
}) {
  const { run, busy, error, setError, client } = usePolicyRequest();
  const [category, setCategory] = useState<PolicyCategory>("conduct");
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const detail = await run(
      "/policies",
      policyDetailSchema,
      {
        code: String(form.get("code") ?? "")
          .trim()
          .toUpperCase(),
        category,
        ...readContent(form),
      },
      text.create.failed,
    );
    if (!detail) return;
    client.setQueryData(["policies", "detail", detail.policy.id], detail);
    await client.invalidateQueries({ queryKey: ["policies", "list"] });
    setCategory("conduct");
    onCreated(detail);
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.create.title}
      className="leave-modal policies-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <Input
          name="code"
          label={text.form.code}
          hint={text.form.codeHint}
          inputClassName="policies-code-input"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,31}"
          autoComplete="off"
          autoFocus
        />
        <Select
          label={text.form.category}
          selectedKey={category}
          onSelectionChange={(key) =>
            setCategory(String(key) as PolicyCategory)
          }
        >
          {categoryKeys.map((key) => (
            <Select.Item key={key} id={key} label={text.categories[key]} />
          ))}
        </Select>
        {open && (
          <ContentFields
            departments={departments}
            defaults={{
              title: "",
              summary: "",
              body: "",
              effectiveOn: new Date().toISOString().slice(0, 10),
              requiresAcknowledgement: true,
              audience: null,
            }}
          />
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          cancel={text.form.cancel}
          submit={text.create.submit}
          saving={text.create.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

/* Details ---------------------------------------------------------------- */

type Action = "edit" | "publish" | "withdraw" | "discard";

function DetailsDialog({
  id,
  departments,
  onClose,
}: {
  id: string | null;
  departments: Department[];
  onClose: () => void;
}) {
  const { data, error, refetch } = usePolicy(id);
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const detail = data && data.policy.id === id ? data : null;
  function close() {
    setAction(null);
    onClose();
  }
  // Called by every action after a successful save.
  function saved(next: PolicyDetail, then: Action | null = null) {
    client.setQueryData(["policies", "detail", next.policy.id], next);
    void client.invalidateQueries({ queryKey: ["policies", "list"] });
    setAction(then);
  }
  return (
    <>
      <DialogPanel
        open={Boolean(id) && !action}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={text.details.title}
        className="leave-modal policies-modal"
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
          departments={departments}
          onSaved={saved}
          onCancel={() => setAction(null)}
        />
      )}
    </>
  );
}

function sections(detail: PolicyDetail) {
  const versions = [...detail.versions].sort(
    (a, b) => b.versionNumber - a.versionNumber,
  );
  return {
    versions,
    current: versions.find((v) => v.status === "published") ?? null,
    draft: versions.find((v) => v.status === "draft") ?? null,
  };
}

function DetailBody({
  detail,
  onAction,
  onSaved,
}: {
  detail: PolicyDetail;
  onAction: (action: Action) => void;
  onSaved: (detail: PolicyDetail, then?: Action | null) => void;
}) {
  const { versions, current, draft } = sections(detail);
  const { run, busy, error } = usePolicyRequest();
  const head = current ?? draft ?? versions[0] ?? null;
  const compliance = detail.compliance;
  async function startVersion() {
    const next = await run(
      `/policies/${detail.policy.id}/drafts`,
      policyDetailSchema,
      {},
      text.actions.newVersionFailed,
    );
    if (next) onSaved(next, "edit");
  }
  return (
    <div className="policies-detail">
      <header className="policies-detail-head">
        <div className="policies-title">
          <strong className="policies-code">{detail.policy.code}</strong>
          <span>{head?.title}</span>
        </div>
        <div className="policies-meta">
          <small>{text.categories[detail.policy.category]}</small>
          {current && (
            <StatusBadge color="success" size="sm" type="pill-color">
              {text.list.published(current.versionNumber)}
            </StatusBadge>
          )}
          {draft && (
            <StatusBadge color="warning" size="sm" type="pill-color">
              {text.list.draft(draft.versionNumber)}
            </StatusBadge>
          )}
          {!current && !draft && (
            <StatusBadge color="gray" size="sm" type="pill-color">
              {text.list.withdrawn}
            </StatusBadge>
          )}
        </div>
      </header>

      <div className="policies-actions">
        {draft ? (
          <>
            <Button variant="secondary" onPress={() => onAction("edit")}>
              {text.actions.edit}
            </Button>
            <Button onPress={() => onAction("publish")}>
              {text.actions.publish}
            </Button>
            <Button variant="secondary" onPress={() => onAction("discard")}>
              {text.actions.discard}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => void startVersion()}
            >
              {text.actions.newVersion}
            </Button>
            {current && (
              <Button variant="secondary" onPress={() => onAction("withdraw")}>
                {text.actions.withdraw}
              </Button>
            )}
          </>
        )}
      </div>
      <FormError message={error} />

      <section aria-labelledby="policy-current" className="policies-section">
        <h3 id="policy-current">{text.details.current}</h3>
        {current ? (
          <VersionBlock version={current} />
        ) : (
          <p className="policies-muted">{text.details.noCurrent}</p>
        )}
      </section>

      {draft && (
        <section aria-labelledby="policy-draft" className="policies-section">
          <h3 id="policy-draft">{text.details.draft}</h3>
          <p>
            <strong>{draft.title}</strong>
          </p>
          <p>{draft.summary}</p>
          <p className="policies-muted">
            {text.details.draftSummary(draft.versionNumber)}{" "}
            {text.details.draftNote}
          </p>
        </section>
      )}

      {compliance && (
        <section aria-labelledby="policy-ack" className="policies-section">
          <h3 id="policy-ack">{text.details.compliance}</h3>
          <div className="policies-progress">
            <span>
              {text.details.progress(
                compliance.stats.acknowledged,
                compliance.stats.audience,
              )}
            </span>
            <div className="policies-bar" aria-hidden="true">
              <span
                style={{
                  width: `${
                    compliance.stats.audience === 0
                      ? 0
                      : Math.min(
                          100,
                          Math.round(
                            (compliance.stats.acknowledged /
                              compliance.stats.audience) *
                              100,
                          ),
                        )
                  }%`,
                }}
              />
            </div>
          </div>
          <ul className="policies-people">
            {compliance.people.map((person) => (
              <li key={person.employeeId}>
                <span className="policies-avatar" aria-hidden="true">
                  {person.initials}
                </span>
                <span className="policies-person">
                  <strong>{person.name}</strong>
                  <small>{person.department}</small>
                </span>
                <small
                  className={
                    person.acknowledgedAt ? "policies-muted" : "policies-due"
                  }
                >
                  {person.acknowledgedAt
                    ? day(person.acknowledgedAt)
                    : text.details.notYet}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="policy-history" className="policies-section">
        <h3 id="policy-history">{text.details.history}</h3>
        <ol className="policies-history">
          {versions.map((version) => (
            <li key={version.id}>
              <strong>
                {text.details.historyEntry(
                  version.versionNumber,
                  text.statusNames[version.status],
                )}
              </strong>
              <span>
                {version.publishedAt && version.publishedBy
                  ? text.details.publishedBy(
                      version.publishedBy,
                      day(version.publishedAt),
                    )
                  : text.details.notPublished}
              </span>
              <span>{text.details.createdBy(version.createdBy)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function VersionBlock({ version }: { version: PolicyVersionDetail }) {
  return (
    <div className="policies-version">
      <p>
        <strong>{version.title}</strong>
      </p>
      <dl className="policies-facts">
        <div>
          <dt>{text.details.effective}</dt>
          <dd>{day(version.effectiveOn)}</dd>
        </div>
        <div>
          <dt>{text.details.audience}</dt>
          <dd>{audienceName(version)}</dd>
        </div>
        <div>
          <dt>{text.details.acknowledgement}</dt>
          <dd>
            {version.requiresAcknowledgement
              ? text.details.required
              : text.details.notRequired}
          </dd>
        </div>
      </dl>
      {version.publishedAt && version.publishedBy && (
        <p className="policies-muted">
          {text.details.publishedBy(
            version.publishedBy,
            day(version.publishedAt),
          )}
        </p>
      )}
      <div className="policies-wording" tabIndex={0}>
        {version.body}
      </div>
    </div>
  );
}

/* Action dialogs --------------------------------------------------------- */

function ActionDialog({
  detail,
  action,
  departments,
  onSaved,
  onCancel,
}: {
  detail: PolicyDetail;
  action: Action | null;
  departments: Department[];
  onSaved: (detail: PolicyDetail) => void;
  onCancel: () => void;
}) {
  const { current, draft } = sections(detail);
  const title =
    action === "edit"
      ? text.edit.title
      : action === "publish"
        ? text.publish.title
        : action === "withdraw"
          ? text.withdraw.title
          : action === "discard"
            ? text.discard.title
            : "";
  return (
    <DialogPanel
      open={Boolean(action)}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title}
      className="leave-modal policies-modal"
    >
      {action === "edit" && draft && (
        <EditForm
          draft={draft}
          departments={departments}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
      {action === "publish" && draft && (
        <PublishForm draft={draft} onSaved={onSaved} onCancel={onCancel} />
      )}
      {action === "withdraw" && current && (
        <ReasonForm
          target={current}
          copy={text.withdraw}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
      {action === "discard" && draft && (
        <ReasonForm
          target={draft}
          copy={text.discard}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    </DialogPanel>
  );
}

type FormProps = {
  onSaved: (detail: PolicyDetail) => void;
  onCancel: () => void;
};

function EditForm({
  draft,
  departments,
  onSaved,
  onCancel,
}: FormProps & { draft: PolicyVersionDetail; departments: Department[] }) {
  const { run, busy, error } = usePolicyRequest();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await run(
      `/policies/versions/${draft.id}`,
      policyDetailSchema,
      {
        ...readContent(new FormData(event.currentTarget)),
        version: draft.version,
      },
      text.edit.failed,
      "PUT",
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <ContentFields
        departments={departments}
        defaults={{
          title: draft.title,
          summary: draft.summary,
          body: draft.body,
          effectiveOn: draft.effectiveOn,
          requiresAcknowledgement: draft.requiresAcknowledgement,
          audience: draft.audienceDepartment,
        }}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.form.cancel}
        submit={text.edit.submit}
        saving={text.edit.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

function PublishForm({
  draft,
  onSaved,
  onCancel,
}: FormProps & { draft: PolicyVersionDetail }) {
  const { run, busy, error } = usePolicyRequest();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = await run(
      `/policies/versions/${draft.id}/publish`,
      policyDetailSchema,
      { version: draft.version },
      text.publish.failed,
    );
    if (next) onSaved(next);
  }
  const message = !draft.requiresAcknowledgement
    ? text.publish.noAck
    : draft.audienceDepartment
      ? text.publish.department(draft.audienceDepartment.name)
      : text.publish.everyone;
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{message}</p>
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.form.cancel}
        submit={text.publish.submit}
        saving={text.publish.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

function ReasonForm({
  target,
  copy,
  onSaved,
  onCancel,
}: FormProps & {
  target: PolicyVersionDetail;
  copy: typeof text.withdraw | typeof text.discard;
}) {
  const { run, busy, error } = usePolicyRequest();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const next = await run(
      `/policies/versions/${target.id}/withdraw`,
      policyDetailSchema,
      { version: target.version, note },
      copy.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.intro}</p>
      <TextArea
        name="note"
        label={copy.reason}
        hint={copy.reasonHint}
        isRequired
        hideRequiredIndicator
        minLength={3}
        maxLength={300}
        autoFocus
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.form.cancel}
        submit={copy.submit}
        saving={copy.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

/* Employee view ---------------------------------------------------------- */

function EmployeeView() {
  const query = useMyPolicies(true);
  const [readId, setReadId] = useState<string | null>(null);
  const header = (
    <PageHeader title={text.mine.title} description={text.mine.subtitle} />
  );
  if (query.error)
    return (
      <div className="page-enter policies-page">
        {header}
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  if (!query.data)
    return (
      <div className="page-enter policies-page">
        {header}
        <LoadingState />
      </div>
    );
  const items = query.data.items;
  const needs = items.filter(
    (item) => item.requiresAcknowledgement && !item.acknowledgedAt,
  );
  const done = items.filter((item) => item.acknowledgedAt);
  const info = items.filter((item) => !item.requiresAcknowledgement);
  return (
    <div className="page-enter policies-page">
      {header}
      {items.length === 0 && (
        <EmptyBlock
          icon={FileText}
          title={text.mine.emptyTitle}
          description={text.mine.emptyBody}
        />
      )}
      <MineSection
        id="policies-needs"
        heading={text.mine.needsHeading}
        items={needs}
        highlight
        button={text.mine.readAcknowledge}
        note={(item) =>
          text.mine.version(item.versionNumber, day(item.effectiveOn))
        }
        onRead={setReadId}
      />
      <MineSection
        id="policies-done"
        heading={text.mine.doneHeading}
        items={done}
        button={text.mine.readAgain}
        note={(item) =>
          `${text.mine.version(item.versionNumber, day(item.effectiveOn))} · ${text.mine.acknowledged(day(item.acknowledgedAt ?? ""))}`
        }
        onRead={setReadId}
      />
      <MineSection
        id="policies-info"
        heading={text.mine.infoHeading}
        items={info.filter((item) => !item.acknowledgedAt)}
        button={text.mine.read}
        note={(item) =>
          text.mine.version(item.versionNumber, day(item.effectiveOn))
        }
        onRead={setReadId}
      />
      <ReadDialog versionId={readId} onClose={() => setReadId(null)} />
    </div>
  );
}

function MineSection({
  id,
  heading,
  items,
  button,
  note,
  highlight = false,
  onRead,
}: {
  id: string;
  heading: string;
  items: MyPolicy[];
  button: string;
  note: (item: MyPolicy) => string;
  highlight?: boolean;
  onRead: (versionId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      className={`panel policies-mine-panel${highlight ? " policies-attention" : ""}`}
      aria-labelledby={id}
    >
      <div className="panel-heading">
        <h2 id={id}>{heading}</h2>
      </div>
      <ul className="policies-mine">
        {items.map((item) => (
          <li key={item.versionId}>
            <div className="policies-mine-body">
              <div className="policies-title">
                <strong className="policies-code">{item.code}</strong>
                <span>{item.title}</span>
              </div>
              <p className="policies-summary">{item.summary}</p>
              <small>{note(item)}</small>
            </div>
            <Button
              variant={highlight ? "primary" : "secondary"}
              onPress={() => onRead(item.versionId)}
              aria-label={text.mine.readLabel(item.code)}
            >
              {button}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReadDialog({
  versionId,
  onClose,
}: {
  versionId: string | null;
  onClose: () => void;
}) {
  const { data, error, refetch } = useQuery({
    queryKey: ["policies", "read", versionId],
    enabled: Boolean(versionId),
    queryFn: ({ signal }) =>
      api(`/policies/mine/${versionId}`, myPolicyDetailSchema, { signal }),
  });
  const { run, busy, error: saveError, setError, client } = usePolicyRequest();
  const policy = data && data.versionId === versionId ? data : null;
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function acknowledge() {
    if (!policy) return;
    const next = await run(
      `/policies/versions/${policy.versionId}/acknowledge`,
      myPoliciesSchema,
      {},
      text.reading.confirmFailed,
    );
    if (!next) return;
    client.setQueryData(["policies", "mine"], next);
    void client.invalidateQueries({ queryKey: ["policies", "read"] });
    onClose();
  }
  return (
    <DialogPanel
      open={Boolean(versionId)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.reading.title}
      className="leave-modal policies-modal"
    >
      {error ? (
        <ErrorState
          message={error.message || text.reading.loadFailed}
          onRetry={() => void refetch()}
        />
      ) : policy ? (
        <div className="policies-detail">
          <header className="policies-detail-head">
            <div className="policies-title">
              <strong className="policies-code">{policy.code}</strong>
              <span>{policy.title}</span>
            </div>
            <small className="policies-muted">
              {text.reading.meta(policy.versionNumber, day(policy.effectiveOn))}
            </small>
          </header>
          <div className="policies-wording" tabIndex={0}>
            {policy.body}
          </div>
          {policy.acknowledgedAt ? (
            <p className="policies-final">
              {text.reading.done(day(policy.acknowledgedAt))}
            </p>
          ) : (
            policy.requiresAcknowledgement && (
              <>
                <FormError message={saveError} />
                <div className="leave-actions">
                  <Button isDisabled={busy} onPress={() => void acknowledge()}>
                    {busy ? text.reading.confirming : text.reading.confirm}
                  </Button>
                </div>
              </>
            )
          )}
        </div>
      ) : (
        <LoadingState />
      )}
    </DialogPanel>
  );
}
