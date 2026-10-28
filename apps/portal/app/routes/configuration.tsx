import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlugsConnected } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import {
  Button,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TextArea,
  UTabs,
  CollectionView,
  DetailFields,
  type Column,
} from "@anvi/ui";
import {
  brandingSchema,
  type BrandingHistory,
  type IntegrationReadiness,
  type PermissionMatrix,
  type Theme,
} from "@anvi/contracts";
import {
  ApiError,
  mutate,
  useBrandingHistory,
  useIntegrations,
  usePermissionMatrix,
} from "../lib/api";
import { configurationCopy as text } from "../lib/copy/configuration";
import { useWorkspace } from "./workspace";
import "./configuration.css";

type Entry = BrandingHistory["items"][number];
type Look = Pick<
  Entry,
  "platformName" | "employeeName" | "organizationName" | "theme"
>;
type TabKey = "history" | "access" | "integrations";

const stamp = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
const when = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : stamp.format(parsed);
};
const nameFields = [
  "platformName",
  "employeeName",
  "organizationName",
] as const;

/** Which fields differ between two looks, for the compact before/after. */
function changedFields(before: Look, after: Look) {
  const out: { key: keyof Look; from: string; to: string }[] = [];
  for (const key of nameFields)
    if (before[key] !== after[key])
      out.push({ key, from: before[key], to: after[key] });
  if (before.theme !== after.theme)
    out.push({ key: "theme", from: before.theme, to: after.theme });
  return out;
}

function ThemeChip({ theme }: { theme: string }) {
  const known = theme in text.themeNames;
  return (
    <span className={`config-theme theme-${theme}`}>
      <span className="theme-swatch" aria-hidden="true">
        <i />
        <i />
      </span>
      {known ? text.themeNames[theme as Theme] : theme}
    </span>
  );
}

function Value({ field, value }: { field: keyof Look; value: string }) {
  return field === "theme" ? (
    <ThemeChip theme={value} />
  ) : (
    <span className="config-value">{value}</span>
  );
}

export default function Configuration() {
  const { me } = useWorkspace();
  const canHistory = me.permissions.includes("branding.write");
  const canAccess = me.permissions.includes("admin.read");
  const [tab, setTab] = useState<TabKey>(canHistory ? "history" : "access");
  if (!canHistory && !canAccess) return <ErrorState message={text.denied} />;
  return (
    <div className="page-enter config-page">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.subtitle}
      />
      <section className="panel config-panel">
        <UTabs
          selectedKey={tab}
          onSelectionChange={(key) => setTab(String(key) as TabKey)}
        >
          <div className="config-tabs-scroll">
            <UTabs.List
              type="underline"
              aria-label={text.tabsLabel}
              className="config-tabs"
            >
              {canHistory && (
                <UTabs.Item id="history">{text.tabs.history}</UTabs.Item>
              )}
              {canAccess && (
                <UTabs.Item id="access">{text.tabs.access}</UTabs.Item>
              )}
              {canAccess && (
                <UTabs.Item id="integrations">
                  {text.tabs.integrations}
                </UTabs.Item>
              )}
            </UTabs.List>
          </div>
          {canHistory && (
            <UTabs.Panel id="history" className="config-tab-panel">
              <HistoryTab />
            </UTabs.Panel>
          )}
          {canAccess && (
            <UTabs.Panel id="access" className="config-tab-panel">
              <AccessTab />
            </UTabs.Panel>
          )}
          {canAccess && (
            <UTabs.Panel id="integrations" className="config-tab-panel">
              <IntegrationsTab />
            </UTabs.Panel>
          )}
        </UTabs>
      </section>
    </div>
  );
}

function Note({ children }: { children: string }) {
  return (
    <p className="config-note">
      <Info size={18} weight="duotone" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* History ------------------------------------------------------------------ */

function HistoryTab() {
  const { branding } = useWorkspace();
  const [before, setBefore] = useState<number>();
  const query = useBrandingHistory(true, before);
  const client = useQueryClient();
  // Settings publishes elsewhere; always show the newest versions on arrival.
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["branding", "history"] });
  }, [client]);
  const [loaded, setLoaded] = useState<Entry[]>([]);
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<Entry | null>(null);
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    setLoaded((previous) => {
      const merged = new Map(previous.map((entry) => [entry.version, entry]));
      for (const entry of data.items) merged.set(entry.version, entry);
      return [...merged.values()].sort((a, b) => b.version - a.version);
    });
  }, [data]);
  // The oldest page loaded so far decides what "Load older" asks for.
  const oldest = loaded.length ? loaded[loaded.length - 1] : undefined;
  const nextCursor = data?.nextBeforeVersion ?? null;
  const hasMore = nextCursor !== null && Boolean(oldest);

  if (query.isLoading && !loaded.length)
    return (
      <div aria-label={text.history.loading}>
        <LoadingState />
      </div>
    );
  if (query.isError && !loaded.length)
    return (
      <ErrorState
        message={text.history.failed}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <div className="config-stack">
      <p className="config-lead">{text.history.intro}</p>
      <Note>{text.history.note}</Note>
      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>
      {notice && (
        <p className="config-success" aria-hidden="true">
          {notice}
        </p>
      )}
      {!loaded.length ? (
        <EmptyBlock
          icon={ClockCounterClockwise}
          title={text.history.emptyTitle}
          description={text.history.emptyBody}
        />
      ) : (
        <ol className="config-timeline" aria-label={text.history.list}>
          {loaded.map((entry, index) => (
            <HistoryItem
              key={entry.version}
              entry={entry}
              previous={loaded[index + 1]}
              isCurrent={entry.version === branding.version}
              hasEarlier={hasMore && index === loaded.length - 1}
              onRollback={() => setTarget(entry)}
            />
          ))}
        </ol>
      )}
      {hasMore && (
        <div className="config-more">
          <Button
            variant="secondary"
            isDisabled={query.isFetching}
            onPress={() => setBefore(nextCursor ?? undefined)}
          >
            {query.isFetching
              ? text.history.loadingOlder
              : text.history.loadOlder}
          </Button>
        </div>
      )}
      {target && (
        <RollbackDialog
          target={target}
          onClose={() => setTarget(null)}
          onDone={(version) => {
            setTarget(null);
            setBefore(undefined);
            setNotice(text.rollback.done(version));
          }}
        />
      )}
    </div>
  );
}

function HistoryItem({
  entry,
  previous,
  isCurrent,
  hasEarlier,
  onRollback,
}: {
  entry: Entry;
  previous?: Entry;
  isCurrent: boolean;
  hasEarlier: boolean;
  onRollback: () => void;
}) {
  const diffs = previous ? changedFields(previous, entry) : null;
  const color =
    entry.source === "rollback"
      ? "warning"
      : entry.source === "baseline"
        ? "gray"
        : "brand";
  return (
    <li className={`config-entry${isCurrent ? " is-current" : ""}`}>
      <div className="config-entry-head">
        <StatusBadge color="gray" size="sm" type="modern">
          {text.history.version(entry.version)}
        </StatusBadge>
        <StatusBadge color={color} size="sm" type="pill-color">
          {text.history.sources[entry.source]}
        </StatusBadge>
        {isCurrent && (
          <StatusBadge color="success" size="sm" type="pill-color">
            {text.history.current}
          </StatusBadge>
        )}
        {entry.restoredVersion !== null && (
          <span className="config-quiet">
            {text.history.restored(entry.restoredVersion)}
          </span>
        )}
      </div>
      <p className="config-who">
        <strong>{entry.changedBy}</strong>{" "}
        <time dateTime={entry.occurredAt}>{when(entry.occurredAt)}</time>
      </p>
      <p className="config-reason">
        <span className="config-quiet">{text.history.reasonLabel}: </span>
        {entry.reason ?? text.history.noReason}
      </p>
      {diffs ? (
        diffs.length ? (
          <dl
            className="config-diff"
            aria-label={text.history.changesFrom(previous!.version)}
          >
            {diffs.map((d) => (
              <div key={d.key}>
                <dt>{text.history.fields[d.key]}</dt>
                <dd>
                  <Value field={d.key} value={d.from} />
                  <span className="config-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="sr-only"> changed to </span>
                  <Value field={d.key} value={d.to} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="config-quiet">{text.history.noChange}</p>
        )
      ) : (
        <dl className="config-diff" aria-label={text.history.firstValues}>
          {nameFields.map((key) => (
            <div key={key}>
              <dt>{text.history.fields[key]}</dt>
              <dd>
                <Value field={key} value={entry[key]} />
              </dd>
            </div>
          ))}
          <div>
            <dt>{text.history.fields.theme}</dt>
            <dd>
              <Value field="theme" value={entry.theme} />
            </dd>
          </div>
        </dl>
      )}
      {!diffs && hasEarlier && (
        <p className="config-quiet">{text.history.unknownBefore}</p>
      )}
      {isCurrent ? (
        <p className="config-quiet">{text.history.liveNote(entry.version)}</p>
      ) : (
        <div className="config-entry-actions">
          <Button variant="secondary" onPress={onRollback}>
            <ArrowsClockwise size={16} aria-hidden="true" />
            {text.history.rollbackButton(entry.version)}
          </Button>
        </div>
      )}
    </li>
  );
}

function RollbackDialog({
  target,
  onClose,
  onDone,
}: {
  target: Entry;
  onClose: () => void;
  onDone: (version: number) => void;
}) {
  const { me, branding } = useWorkspace();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const diffs = changedFields(branding, target);
  const trimmed = reason.trim();
  const valid = trimmed.length >= 10 && trimmed.length <= 300;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !diffs.length) return;
    setBusy(true);
    setError("");
    try {
      brandingSchema.parse(
        await mutate("/branding/rollback", me.csrfToken, {
          toVersion: target.version,
          version: branding.version,
          reason: trimmed,
        }),
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["branding"] }),
        client.invalidateQueries({ queryKey: ["me"] }),
      ]);
      onDone(target.version);
    } catch (cause) {
      const errors = text.rollback.errors;
      if (cause instanceof ApiError) {
        if (cause.status === 409) {
          setError(errors.conflict);
          void client.invalidateQueries({ queryKey: ["branding"] });
        } else if (cause.status === 403) setError(errors.forbidden);
        else if (cause.status === 404) setError(errors.notFound);
        else if (cause.status === 400) setError(errors.invalid);
        else setError(errors.fallback);
      } else setError(errors.fallback);
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={text.rollback.title}
      className="config-dialog"
    >
      <form onSubmit={(event) => void submit(event)} className="config-form">
        <p className="config-lead">
          {text.rollback.intro(target.version, branding.version)}
        </p>
        <div className="config-changes">
          <h3>{text.rollback.changesTitle}</h3>
          {diffs.length ? (
            <dl className="config-diff">
              {diffs.map((d) => (
                <div key={d.key}>
                  <dt>{text.history.fields[d.key]}</dt>
                  <dd>
                    <Value field={d.key} value={d.from} />
                    <span className="config-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="sr-only"> will become </span>
                    <Value field={d.key} value={d.to} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="config-quiet">
              {text.rollback.nothing(target.version)}
            </p>
          )}
        </div>
        <Note>{text.rollback.honest}</Note>
        <TextArea
          label={text.rollback.reason}
          hint={`${text.rollback.reasonHint} ${text.rollback.count(reason.length)}`}
          isRequired
          hideRequiredIndicator
          minLength={10}
          maxLength={300}
          autoFocus
          value={reason}
          onChange={setReason}
          isDisabled={busy}
        />
        {error && (
          <p className="config-error" role="alert">
            {error}
          </p>
        )}
        <div className="config-dialog-actions">
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            {text.rollback.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || !valid || !diffs.length}
          >
            {busy ? text.rollback.submitting : text.rollback.submit}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}

/* Access ------------------------------------------------------------------- */

type Permission = PermissionMatrix["permissions"][number];
type Row = { id: string; area: string; first: boolean; item: Permission };

const areaOf = (permission: string) =>
  permission.includes(".") ? permission.split(".")[0]! : text.access.other;
const humanize = (value: string) =>
  value.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());

function ScopeChips({
  grants,
}: {
  grants: { scope: "self" | "team" | "entity" }[];
}) {
  if (!grants.length)
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{text.access.noAccess}</span>
      </>
    );
  return (
    <span className="config-chips">
      {grants.map((grant) => (
        <StatusBadge
          key={grant.scope}
          color={grant.scope === "entity" ? "brand" : "gray"}
          size="sm"
          type="pill-color"
        >
          {text.access.scopes[grant.scope]}
        </StatusBadge>
      ))}
    </span>
  );
}

function AccessTab() {
  const query = usePermissionMatrix(true);
  if (query.isLoading)
    return (
      <div aria-label={text.access.loading}>
        <LoadingState />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <ErrorState
        message={text.access.failed}
        onRetry={() => void query.refetch()}
      />
    );
  return <Matrix matrix={query.data} />;
}

function Matrix({ matrix }: { matrix: PermissionMatrix }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const term = search.trim().toLowerCase();
  const roles = useMemo(
    () =>
      role === "all"
        ? matrix.roles
        : matrix.roles.filter((r) => r.role === role),
    [matrix.roles, role],
  );
  const rows = useMemo<Row[]>(() => {
    const filtered = matrix.permissions
      .filter(
        (item) =>
          (!term ||
            item.permission.toLowerCase().includes(term) ||
            item.description.toLowerCase().includes(term)) &&
          (role === "all" || item.grants.some((g) => g.role === role)),
      )
      .map((item) => ({ item, area: areaOf(item.permission) }))
      .sort(
        (a, b) =>
          a.area.localeCompare(b.area) ||
          a.item.permission.localeCompare(b.item.permission),
      );
    return filtered.map((entry, index) => ({
      id: entry.item.permission,
      area: entry.area,
      item: entry.item,
      first: index === 0 || filtered[index - 1]!.area !== entry.area,
    }));
  }, [matrix.permissions, term, role]);
  const roleLabel = (id: string) =>
    matrix.roles.find((r) => r.role === id)?.label ?? id;
  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        id: "permission",
        label: text.access.permissionColumn,
        isRowHeader: true,
        sortValue: (row) => row.item.permission,
        render: (row) => (
          <>
            {row.first && (
              <span className="config-area">{humanize(row.area)}</span>
            )}
            <span className="config-perm">{row.item.permission}</span>
            <span className="config-quiet">{row.item.description}</span>
          </>
        ),
      },
      ...roles.map((r) => ({
        id: r.role,
        label: r.label,
        render: (row: Row) => (
          <ScopeChips
            grants={row.item.grants.filter((g) => g.role === r.role)}
          />
        ),
      })),
    ],
    [roles],
  );
  return (
    <div className="config-stack">
      <p className="config-lead">{text.access.title}</p>
      <Note>{text.access.note}</Note>
      <div className="config-toolbar">
        <Input
          aria-label={text.access.search}
          placeholder={text.access.searchPlaceholder}
          maxLength={80}
          icon={MagnifyingGlass}
          value={search}
          onChange={setSearch}
          className="config-search"
        />
        <Select
          label={text.access.role}
          selectedKey={role}
          onSelectionChange={(key) => setRole(String(key))}
          className="config-role"
        >
          {[
            <Select.Item key="all" id="all" label={text.access.allRoles} />,
            ...matrix.roles.map((r) => (
              <Select.Item key={r.role} id={r.role} label={r.label} />
            )),
          ]}
        </Select>
      </div>
      <p className="config-quiet">{text.access.scopeHelp}</p>
      <CollectionView
        id="config-access"
        label={text.access.tableLabel}
        noun="permissions"
        items={rows}
        getKey={(row) => row.id}
        defaultView="table"
        urlState
        columns={columns}
        emptyIcon={ShieldCheck}
        emptyTitle={text.access.emptyTitle}
        emptyDescription={text.access.emptyBody}
        renderCard={(row) => {
          const visible = row.item.grants.filter(
            (g) => role === "all" || g.role === role,
          );
          return (
            <div className="config-card">
              <p className="config-area">{humanize(row.area)}</p>
              <h3>{row.item.permission}</h3>
              <p className="config-quiet">{row.item.description}</p>
              {visible.length ? (
                <dl>
                  {visible.map((g) => (
                    <div key={g.role}>
                      <dt>{roleLabel(g.role)}</dt>
                      <dd>
                        <ScopeChips grants={[g]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="config-quiet">{text.access.nobody}</p>
              )}
            </div>
          );
        }}
        detail={{
          title: (row) => row.item.permission,
          subtitle: (row) => row.item.description,
          body: (row) => (
            <DetailFields
              title={humanize(row.area)}
              fields={matrix.roles.map((r) => ({
                label: r.label,
                value: (
                  <ScopeChips
                    grants={row.item.grants.filter((g) => g.role === r.role)}
                  />
                ),
              }))}
            />
          ),
        }}
      />
    </div>
  );
}

/* Integrations -------------------------------------------------------------- */

const statusColor = {
  configured: "success",
  not_configured: "gray",
  demo: "warning",
} as const;

function IntegrationsTab() {
  const query = useIntegrations(true);
  if (query.isLoading)
    return (
      <div aria-label={text.integrations.loading}>
        <LoadingState />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <ErrorState
        message={text.integrations.failed}
        onRetry={() => void query.refetch()}
      />
    );
  const data: IntegrationReadiness = query.data;
  return (
    <div className="config-stack">
      <Note>{text.integrations.note}</Note>
      <p className="config-quiet">{text.integrations.asOf(when(data.asOf))}</p>
      {!data.items.length ? (
        <EmptyBlock icon={PlugsConnected} title={text.integrations.title} />
      ) : (
        <ul className="config-integrations" aria-label={text.integrations.list}>
          {data.items.map((item) => {
            const facts = Object.entries(item.detail);
            return (
              <li key={item.key} className="config-integration">
                <div className="config-integration-head">
                  <h3>{item.name}</h3>
                  <StatusBadge
                    color={statusColor[item.status]}
                    size="sm"
                    type="pill-color"
                  >
                    {text.integrations.status[item.status]}
                  </StatusBadge>
                </div>
                <p>{item.note}</p>
                {facts.length ? (
                  <dl
                    className="config-facts"
                    aria-label={text.integrations.facts}
                  >
                    {facts.map(([key, value]) => (
                      <div key={key}>
                        <dt>{humanize(key)}</dt>
                        <dd>
                          {typeof value === "boolean"
                            ? value
                              ? text.integrations.yes
                              : text.integrations.no
                            : value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="config-quiet">{text.integrations.noFacts}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
