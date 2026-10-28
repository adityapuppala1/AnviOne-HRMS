import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { Archive as ArchiveBox } from "@phosphor-icons/react/dist/csr/Archive";
import { Laptop } from "@phosphor-icons/react/dist/csr/Laptop";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Package } from "@phosphor-icons/react/dist/csr/Package";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { UserCheck } from "@phosphor-icons/react/dist/csr/UserCheck";
import { Wrench } from "@phosphor-icons/react/dist/csr/Wrench";
import {
  Button,
  CollectionView,
  type Column,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import {
  assetDetailSchema,
  myAssetsSchema,
  type Asset,
  type AssetCategory,
  type AssetCondition,
  type AssetDetail,
  type AssetStatus,
  type MyAsset,
} from "@anvi/contracts";
import {
  api,
  ApiError,
  useAsset,
  useAssets,
  useDirectory,
  useMyAssets,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { assetsCopy as text } from "../lib/copy/assets";
import { useWorkspace } from "./workspace";
// Shared dialog form styles come from the leave screen.
import "./leave.css";
import "./assets.css";

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

const statusColor: Record<
  AssetStatus,
  "gray" | "brand" | "error" | "warning" | "success"
> = {
  available: "success",
  assigned: "brand",
  in_repair: "warning",
  lost: "error",
  retired: "gray",
};
const categoryKeys = Object.keys(text.categories) as AssetCategory[];
const conditionKeys = Object.keys(text.conditions) as AssetCondition[];
const statusKeys = Object.keys(text.status) as AssetStatus[];

function StatusPill({ status }: { status: AssetStatus }) {
  return (
    <StatusBadge color={statusColor[status]} size="sm" type="pill-color">
      {text.status[status]}
    </StatusBadge>
  );
}

export default function Assets() {
  const { me } = useWorkspace();
  if (me.permissions.includes("asset.manage")) return <ManageView />;
  if (me.permissions.includes("asset.self")) return <HolderView />;
  return <ErrorState message={text.denied} />;
}

/* Shared request helper ------------------------------------------------- */

function useAssetRequest() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(
    path: string,
    schema: z.ZodType<T>,
    method: "POST" | "PUT",
    body: unknown,
    fallback: string,
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
        void client.invalidateQueries({ queryKey: ["assets"] });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError, client };
}

function OptionSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: T[];
  labels: Record<T, string>;
}) {
  return (
    <Select
      label={label}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
    >
      {options.map((option) => (
        <Select.Item key={option} id={option} label={labels[option]} />
      ))}
    </Select>
  );
}

function FormActions({
  busy,
  cancel,
  submit,
  saving,
  onCancel,
  disabled = false,
}: {
  busy: boolean;
  cancel: string;
  submit: string;
  saving: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" isDisabled={busy || disabled}>
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

/* HR view --------------------------------------------------------------- */

type Action =
  | { kind: "issue" | "receive" | "edit" }
  | { kind: "status"; status: "available" | "in_repair" | "retired" | "lost" };

function ManageView() {
  const { reduceMotion } = usePreferences();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const query = new URLSearchParams({
    q: params.get("q") ?? "",
    status: params.get("status") ?? "",
    category: params.get("category") ?? "",
    page: params.get("page") ?? "1",
    limit: "10",
  });
  const { data, error, isPending, refetch } = useAssets(query.toString(), true);
  const filtered =
    params.has("q") || params.has("status") || params.has("category");
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    void setParams(next, { replace: true });
  }
  const counts = data?.counts;
  return (
    <div className="page-enter assets-page">
      <PageHeader
        title={text.title}
        description={text.subtitle}
        actions={
          <Button onPress={() => setAdding(true)}>
            <Plus size={18} weight="bold" />
            {text.addButton}
          </Button>
        }
      />
      <div className="assets-stats">
        <StatCard
          label={text.stats.available}
          value={counts?.available ?? 0}
          hint={text.stats.availableHint}
          icon={Package}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.issued}
          value={counts?.assigned ?? 0}
          hint={text.stats.issuedHint}
          icon={UserCheck}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.repair}
          value={counts?.in_repair ?? 0}
          hint={text.stats.repairHint}
          icon={Wrench}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.gone}
          value={(counts?.lost ?? 0) + (counts?.retired ?? 0)}
          hint={text.stats.goneHint}
          icon={ArchiveBox}
          animate={!reduceMotion}
        />
      </div>
      <section className="panel assets-panel" aria-labelledby="assets-heading">
        <div className="panel-heading">
          <div>
            <h2 id="assets-heading">{text.list.heading}</h2>
            {data && <p aria-live="polite">{text.list.total(data.total)}</p>}
          </div>
        </div>
        <div className="directory-toolbar assets-toolbar">
          <Input
            aria-label={text.toolbar.searchLabel}
            placeholder={text.toolbar.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={params.get("q") ?? ""}
            onChange={(value) => filter("q", value)}
            className="assets-search"
          />
          <Select
            aria-label={text.toolbar.statusLabel}
            selectedKey={params.get("status") || "all"}
            onSelectionChange={(key) =>
              filter("status", key === "all" ? "" : String(key))
            }
            className="assets-filter"
          >
            <Select.Item id="all" label={text.toolbar.allStatuses} />
            {statusKeys.map((key) => (
              <Select.Item key={key} id={key} label={text.status[key]} />
            ))}
          </Select>
          <Select
            aria-label={text.toolbar.categoryLabel}
            selectedKey={params.get("category") || "all"}
            onSelectionChange={(key) =>
              filter("category", key === "all" ? "" : String(key))
            }
            className="assets-filter"
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
        ) : data.items.length === 0 ? (
          filtered ? (
            <EmptyBlock
              icon={Laptop}
              title={text.list.noMatchTitle}
              description={text.list.noMatchBody}
              action={
                <Button variant="secondary" onPress={() => void setParams({})}>
                  {text.list.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              icon={Laptop}
              title={text.list.emptyTitle}
              description={text.list.emptyBody}
              action={
                <Button onPress={() => setAdding(true)}>
                  {text.addButton}
                </Button>
              }
            />
          )
        ) : (
          <CollectionView
            id="assets-hr"
            label={text.list.heading}
            noun="assets"
            items={data.items}
            getKey={(asset) => asset.id}
            columns={assetColumns(setOpenId)}
            renderCard={(asset) => (
              <AssetRow asset={asset} onOpen={() => setOpenId(asset.id)} />
            )}
            onOpen={(asset) => setOpenId(asset.id)}
            defaultView="table"
            server={{
              page: data.page,
              total: data.total,
              limit: pageLimit(data),
              onPageChange: (next) => filter("page", String(next)),
            }}
          />
        )}
      </section>
      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(detail) => {
          setAdding(false);
          setOpenId(detail.asset.id);
        }}
      />
      <DetailsDialog
        id={openId}
        action={action}
        setAction={setAction}
        onClose={() => {
          setOpenId(null);
          setAction(null);
        }}
      />
    </div>
  );
}

function holderNote(asset: Asset) {
  if (!asset.custodian) return null;
  if (asset.status !== "assigned") return asset.custodian.name;
  return asset.acknowledgedAt ? text.list.acknowledged : text.list.awaiting;
}

// The API reports total and pages but not the page size; derive it.
function pageLimit(data: {
  items: unknown[];
  total: number;
  page: number;
  pages: number;
}) {
  if (data.pages <= 1) return Math.max(1, data.total);
  if (data.page < data.pages) return Math.max(1, data.items.length);
  return Math.max(
    1,
    Math.ceil((data.total - data.items.length) / (data.page - 1)),
  );
}

function assetColumns(open: (id: string) => void): Column<Asset>[] {
  return [
    {
      id: "tag",
      label: "Tag",
      isRowHeader: true,
      render: (asset) => <strong className="text-sm">{asset.tag}</strong>,
    },
    {
      id: "name",
      label: "Asset",
      render: (asset) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-primary">{asset.name}</span>
          <small className="text-tertiary">
            {text.categories[asset.category]}
            {asset.serialNumber && ` · ${text.list.serial(asset.serialNumber)}`}
          </small>
        </span>
      ),
    },
    {
      id: "status",
      label: "Status",
      render: (asset) => <StatusPill status={asset.status} />,
    },
    {
      id: "holder",
      label: "Held by",
      render: (asset) =>
        asset.custodian ? (
          <span className="flex flex-col text-sm">
            <span>{text.list.heldBy(asset.custodian.name)}</span>
            {asset.status === "assigned" && (
              <small className="text-tertiary">{holderNote(asset)}</small>
            )}
          </span>
        ) : (
          <small className="text-tertiary">{text.list.noHolder}</small>
        ),
    },
    {
      id: "open",
      label: "",
      render: (asset) => (
        <Button
          variant="secondary"
          onPress={() => open(asset.id)}
          aria-label={text.list.openLabel(asset.tag)}
        >
          {text.list.open}
        </Button>
      ),
    },
  ];
}

function AssetRow({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const note = holderNote(asset);
  return (
    <div className="assets-row">
      <strong className="assets-tag">{asset.tag}</strong>
      <div className="assets-name">
        <span>{asset.name}</span>
        <small>
          {text.categories[asset.category]}
          {asset.serialNumber && ` · ${text.list.serial(asset.serialNumber)}`}
        </small>
      </div>
      <div className="assets-state">
        <StatusPill status={asset.status} />
      </div>
      <div className="assets-holder">
        {asset.custodian ? (
          <>
            <span>{text.list.heldBy(asset.custodian.name)}</span>
            {asset.status === "assigned" && <small>{note}</small>}
          </>
        ) : (
          <small>{text.list.noHolder}</small>
        )}
      </div>
      <Button
        variant="secondary"
        onPress={onOpen}
        aria-label={text.list.openLabel(asset.tag)}
      >
        {text.list.open}
      </Button>
    </div>
  );
}

/* Add ---------------------------------------------------------------------- */

function AddDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: AssetDetail) => void;
}) {
  const { run, busy, error, setError, client } = useAssetRequest();
  const [category, setCategory] = useState<AssetCategory>("laptop");
  const [condition, setCondition] = useState<AssetCondition>("new");
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const serial = String(form.get("serialNumber") ?? "").trim();
    const detail = await run(
      "/assets",
      assetDetailSchema,
      "POST",
      {
        tag: String(form.get("tag") ?? "")
          .trim()
          .toUpperCase(),
        category,
        name: String(form.get("name") ?? "").trim(),
        serialNumber: serial || null,
        condition,
      },
      text.add.failed,
    );
    if (!detail) return;
    await client.invalidateQueries({ queryKey: ["assets"] });
    setCategory("laptop");
    setCondition("new");
    onCreated(detail);
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.add.title}
      className="leave-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <Input
          label={text.add.tag}
          hint={text.add.tagHint}
          name="tag"
          inputClassName="assets-tag-input"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={24}
          pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,23}"
          autoComplete="off"
          autoFocus
        />
        <OptionSelect
          label={text.add.category}
          value={category}
          onChange={setCategory}
          options={categoryKeys}
          labels={text.categories}
        />
        <Input
          label={text.add.name}
          name="name"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
        <Input
          label={text.add.serial}
          name="serialNumber"
          minLength={2}
          maxLength={60}
          autoComplete="off"
        />
        <OptionSelect
          label={text.add.condition}
          value={condition}
          onChange={setCondition}
          options={conditionKeys}
          labels={text.conditions}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          cancel={text.add.cancel}
          submit={text.add.submit}
          saving={text.add.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

/* Details ------------------------------------------------------------------ */

function actionButtons(status: AssetStatus): { label: string; to: Action }[] {
  const a = text.actions;
  switch (status) {
    case "available":
      return [
        { label: a.issue, to: { kind: "issue" } },
        { label: a.edit, to: { kind: "edit" } },
        { label: a.repair, to: { kind: "status", status: "in_repair" } },
        { label: a.retire, to: { kind: "status", status: "retired" } },
        { label: a.lost, to: { kind: "status", status: "lost" } },
      ];
    case "assigned":
      return [
        { label: a.receive, to: { kind: "receive" } },
        { label: a.lost, to: { kind: "status", status: "lost" } },
      ];
    case "in_repair":
      return [
        { label: a.restock, to: { kind: "status", status: "available" } },
        { label: a.retire, to: { kind: "status", status: "retired" } },
        { label: a.lost, to: { kind: "status", status: "lost" } },
      ];
    case "lost":
      return [
        { label: a.found, to: { kind: "status", status: "available" } },
        { label: a.retire, to: { kind: "status", status: "retired" } },
      ];
    default:
      return [];
  }
}

function DetailsDialog({
  id,
  action,
  setAction,
  onClose,
}: {
  id: string | null;
  action: Action | null;
  setAction: (action: Action | null) => void;
  onClose: () => void;
}) {
  const { data, error, refetch } = useAsset(id);
  const client = useQueryClient();
  const detail = data && data.asset.id === id ? data : null;
  // Called by every action dialog after a successful save.
  function saved(next: AssetDetail) {
    client.setQueryData(["assets", "detail", next.asset.id], next);
    void client.invalidateQueries({ queryKey: ["assets", "list"] });
    setAction(null);
  }
  return (
    <>
      <DialogPanel
        open={Boolean(id) && !action}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title={text.details.title}
        className="leave-modal assets-modal"
      >
        {error ? (
          <ErrorState
            message={error.message || text.details.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : detail ? (
          <DetailBody detail={detail} onAction={setAction} />
        ) : (
          <LoadingState />
        )}
      </DialogPanel>
      {detail && (
        <ActionDialog
          detail={detail}
          action={action}
          onSaved={saved}
          onCancel={() => setAction(null)}
        />
      )}
    </>
  );
}

function DetailBody({
  detail,
  onAction,
}: {
  detail: AssetDetail;
  onAction: (action: Action) => void;
}) {
  const { asset, history } = detail;
  const buttons = actionButtons(asset.status);
  const rows: [string, ReactNode][] = [
    [text.details.tag, asset.tag],
    [text.details.name, asset.name],
    [text.details.category, text.categories[asset.category]],
    [text.details.serial, asset.serialNumber ?? text.details.none],
    [text.details.condition, text.conditions[asset.condition]],
    [text.details.status, <StatusPill key="s" status={asset.status} />],
    [text.details.holder, asset.custodian?.name ?? text.details.none],
  ];
  return (
    <div className="assets-detail">
      <dl className="assets-facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {buttons.length > 0 ? (
        <div className="assets-actions">
          {buttons.map((button) => (
            <Button
              key={button.label}
              variant="secondary"
              onPress={() => onAction(button.to)}
            >
              {button.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="assets-final">{text.details.final}</p>
      )}
      <h3 className="assets-subheading">{text.details.historyHeading}</h3>
      {history.length === 0 ? (
        <p className="assets-muted">{text.details.historyEmpty}</p>
      ) : (
        <ol className="assets-history">
          {history.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.employeeName}</strong>
              <span>
                {text.details.issued(day(entry.issuedOn), entry.issuedBy)}
              </span>
              <span>
                {text.details.issueCondition(
                  text.conditions[entry.issueCondition],
                )}
              </span>
              <span>
                {entry.acknowledgedAt
                  ? text.details.acknowledged(day(entry.acknowledgedAt))
                  : text.details.notAcknowledged}
              </span>
              {entry.returnedOn ? (
                <span>
                  {text.details.returned(
                    day(entry.returnedOn),
                    entry.returnCondition === "lost"
                      ? text.returnLost
                      : text.conditions[entry.returnCondition ?? "good"],
                  )}
                </span>
              ) : (
                <span>{text.details.stillHeld}</span>
              )}
              {entry.returnNote && (
                <span>{text.details.returnNote(entry.returnNote)}</span>
              )}
              {entry.receivedBy && (
                <span>{text.details.receivedBy(entry.receivedBy)}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* Action dialogs ------------------------------------------------------------ */

function ActionDialog({
  detail,
  action,
  onSaved,
  onCancel,
}: {
  detail: AssetDetail;
  action: Action | null;
  onSaved: (detail: AssetDetail) => void;
  onCancel: () => void;
}) {
  const title =
    action?.kind === "issue"
      ? text.issue.title
      : action?.kind === "receive"
        ? text.receive.title
        : action?.kind === "edit"
          ? text.edit.title
          : action?.kind === "status"
            ? action.status === "in_repair"
              ? text.change.repairTitle
              : action.status === "available"
                ? text.change.stockTitle
                : action.status === "retired"
                  ? text.change.retireTitle
                  : text.change.lostTitle
            : "";
  return (
    <DialogPanel
      open={Boolean(action)}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title}
      className="leave-modal"
    >
      {action?.kind === "issue" && (
        <IssueForm detail={detail} onSaved={onSaved} onCancel={onCancel} />
      )}
      {action?.kind === "receive" && (
        <ReceiveForm detail={detail} onSaved={onSaved} onCancel={onCancel} />
      )}
      {action?.kind === "edit" && (
        <EditForm detail={detail} onSaved={onSaved} onCancel={onCancel} />
      )}
      {action?.kind === "status" && (
        <StatusForm
          detail={detail}
          status={action.status}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    </DialogPanel>
  );
}

type FormProps = {
  detail: AssetDetail;
  onSaved: (detail: AssetDetail) => void;
  onCancel: () => void;
};

function IssueForm({ detail, onSaved, onCancel }: FormProps) {
  const { asset } = detail;
  const { run, busy, error } = useAssetRequest();
  const [term, setTerm] = useState("");
  const [chosen, setChosen] = useState<{
    id: string;
    name: string;
    title: string;
  } | null>(null);
  const search = term.trim();
  const people = useDirectory(`q=${encodeURIComponent(search)}&limit=6`);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    const next = await run(
      `/assets/${asset.id}/issue`,
      assetDetailSchema,
      "POST",
      { employeeId: chosen.id, version: asset.version },
      text.issue.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.issue.intro(asset.tag, asset.name)}</p>
      {chosen ? (
        <div className="assets-chosen">
          <span>
            <small>{text.issue.selected}</small>
            <strong>{chosen.name}</strong>
            <small>{chosen.title}</small>
          </span>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => setChosen(null)}
          >
            {text.issue.change}
          </Button>
        </div>
      ) : (
        <>
          <Input
            label={text.issue.find}
            autoComplete="off"
            maxLength={80}
            value={term}
            onChange={(value: string) => setTerm(value)}
            autoFocus
          />
          {search && people.data && (
            <ul className="assets-people" aria-label={text.issue.results}>
              {people.data.items.length === 0 ? (
                <li className="assets-muted">{text.issue.none}</li>
              ) : (
                people.data.items.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setChosen({
                          id: person.id,
                          name: person.name,
                          title: person.title,
                        })
                      }
                    >
                      <strong>{person.name}</strong>
                      <small>{person.title}</small>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.issue.cancel}
        submit={text.issue.submit}
        saving={text.issue.saving}
        onCancel={onCancel}
        disabled={!chosen}
      />
    </form>
  );
}

function ReceiveForm({ detail, onSaved, onCancel }: FormProps) {
  const { asset } = detail;
  const { run, busy, error } = useAssetRequest();
  const [condition, setCondition] = useState<AssetCondition>("good");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const next = await run(
      `/assets/${asset.id}/return`,
      assetDetailSchema,
      "POST",
      { condition, ...(note ? { note } : {}), version: asset.version },
      text.receive.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <OptionSelect
        label={text.receive.condition}
        value={condition}
        onChange={setCondition}
        options={conditionKeys}
        labels={text.conditions}
      />
      <TextArea
        label={text.receive.notes}
        hint={text.receive.notesHint}
        name="note"
        maxLength={300}
        isRequired={condition === "damaged"}
        hideRequiredIndicator
        minLength={condition === "damaged" ? 3 : undefined}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.receive.cancel}
        submit={text.receive.submit}
        saving={text.receive.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

function EditForm({ detail, onSaved, onCancel }: FormProps) {
  const { asset } = detail;
  const { run, busy, error } = useAssetRequest();
  const [condition, setCondition] = useState<AssetCondition>(asset.condition);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const serial = String(form.get("serialNumber") ?? "").trim();
    const next = await run(
      `/assets/${asset.id}`,
      assetDetailSchema,
      "PUT",
      {
        name: String(form.get("name") ?? "").trim(),
        serialNumber: serial || null,
        condition,
        reason: String(form.get("reason") ?? "").trim(),
        version: asset.version,
      },
      text.edit.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={text.edit.name}
        name="name"
        defaultValue={asset.name}
        isRequired
        hideRequiredIndicator
        minLength={2}
        maxLength={80}
        autoComplete="off"
        autoFocus
      />
      <Input
        label={text.edit.serial}
        name="serialNumber"
        defaultValue={asset.serialNumber ?? ""}
        minLength={2}
        maxLength={60}
        autoComplete="off"
      />
      <OptionSelect
        label={text.edit.condition}
        value={condition}
        onChange={setCondition}
        options={conditionKeys}
        labels={text.conditions}
      />
      <TextArea
        label={text.edit.reason}
        name="reason"
        isRequired
        hideRequiredIndicator
        minLength={3}
        maxLength={300}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.edit.cancel}
        submit={text.edit.submit}
        saving={text.edit.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

function StatusForm({
  detail,
  status,
  onSaved,
  onCancel,
}: FormProps & { status: "available" | "in_repair" | "retired" | "lost" }) {
  const { asset } = detail;
  const { run, busy, error } = useAssetRequest();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    const next = await run(
      `/assets/${asset.id}/status`,
      assetDetailSchema,
      "POST",
      { status, note, version: asset.version },
      text.change.failed,
    );
    if (next) onSaved(next);
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <TextArea
        label={text.change.reason}
        hint={text.change.reasonHint}
        name="note"
        isRequired
        hideRequiredIndicator
        minLength={3}
        maxLength={300}
        autoFocus
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        cancel={text.change.cancel}
        submit={text.change.submit}
        saving={text.change.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

/* Holder view -------------------------------------------------------------- */

function HolderView() {
  const query = useMyAssets(true);
  const { run, busy, error, client } = useAssetRequest();
  const [pending, setPending] = useState<string | null>(null);
  async function acknowledge(item: MyAsset) {
    setPending(item.assignmentId);
    const next = await run(
      `/assets/assignments/${item.assignmentId}/acknowledge`,
      myAssetsSchema,
      "POST",
      { version: item.version },
      text.mine.confirmFailed,
    );
    setPending(null);
    if (next) {
      client.setQueryData(["assets", "mine"], next);
      void client.invalidateQueries({ queryKey: ["assets"] });
    }
  }
  const header = (
    <PageHeader title={text.mine.title} description={text.mine.subtitle} />
  );
  if (query.error)
    return (
      <div className="page-enter assets-page">
        {header}
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  if (!query.data)
    return (
      <div className="page-enter assets-page">
        {header}
        <LoadingState />
      </div>
    );
  const { current, past } = query.data;
  const unconfirmed = current.filter((item) => item.acknowledgedAt === null);
  return (
    <div className="page-enter assets-page">
      {header}
      {error && <FormError message={error} />}
      {current.length === 0 && past.length === 0 && (
        <EmptyBlock
          icon={Laptop}
          title={text.mine.emptyTitle}
          description={text.mine.emptyBody}
        />
      )}
      {unconfirmed.length > 0 && (
        <section
          className="panel assets-confirm"
          aria-labelledby="assets-confirm"
        >
          <div className="panel-heading">
            <div>
              <h2 id="assets-confirm">{text.mine.confirmHeading}</h2>
              <p>{text.mine.confirmHint}</p>
            </div>
          </div>
          <ul className="assets-mine">
            {unconfirmed.map((item) => (
              <li key={item.assignmentId}>
                <MineSummary item={item} />
                <Button
                  isDisabled={busy}
                  onPress={() => void acknowledge(item)}
                  aria-label={text.mine.confirmLabel(item.tag)}
                >
                  {pending === item.assignmentId && busy
                    ? text.mine.confirming
                    : text.mine.confirm}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {current.length > 0 && (
        <section className="panel" aria-labelledby="assets-current">
          <div className="panel-heading">
            <h2 id="assets-current">{text.mine.currentHeading}</h2>
          </div>
          <ul className="assets-mine">
            {current.map((item) => (
              <li key={item.assignmentId}>
                <MineSummary item={item} />
                <span className="assets-muted">
                  {item.acknowledgedAt
                    ? text.mine.acknowledged(day(item.acknowledgedAt))
                    : text.mine.awaiting}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="panel" aria-labelledby="assets-past">
          <div className="panel-heading">
            <h2 id="assets-past">{text.mine.pastHeading}</h2>
          </div>
          <ul className="assets-mine">
            {past.map((item) => (
              <li key={item.assignmentId}>
                <div className="assets-mine-body">
                  <strong>
                    {item.tag} <span>{item.name}</span>
                  </strong>
                  <small>
                    {item.returnedOn
                      ? text.mine.returned(
                          day(item.returnedOn),
                          item.returnCondition === "lost"
                            ? text.returnLost
                            : text.conditions[item.returnCondition ?? "good"],
                        )
                      : ""}
                  </small>
                </div>
                {item.returnCondition === "lost" && (
                  <StatusBadge color="error" size="sm" type="pill-color">
                    {text.returnLost}
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MineSummary({ item }: { item: MyAsset }) {
  return (
    <div className="assets-mine-body">
      <strong>
        {item.tag} <span>{item.name}</span>
      </strong>
      <small>
        {text.categories[item.category]}
        {item.serialNumber && ` · ${text.mine.serial(item.serialNumber)}`}
      </small>
      <small>{text.mine.issuedOn(day(item.issuedOn), item.issuedBy)}</small>
    </div>
  );
}
