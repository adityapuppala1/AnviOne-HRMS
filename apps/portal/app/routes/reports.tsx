import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Icon } from "@phosphor-icons/react";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { DoorOpen } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Laptop } from "@phosphor-icons/react/dist/csr/Laptop";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt";
import { Scroll } from "@phosphor-icons/react/dist/csr/Scroll";
import { Table as TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import {
  Button,
  Checkbox,
  DataCard,
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
  UTabs,
  type Column as TableColumn,
} from "@anvi/ui";
import {
  reportDefinitionSchema,
  reportResultSchema,
  savedReportSchema,
  type ReportCatalog,
  type ReportDefinition,
  type ReportFilter,
  type ReportOperator,
  type ReportResult,
  type SavedReport,
} from "@anvi/contracts";
import { api, ApiError, useReportCatalog, useSavedReports } from "../lib/api";
import { markTouched } from "../lib/activity";
import { useWorkspace } from "./workspace";
import { reportsCopy as text } from "../lib/copy/reports";
import "./reports.css";

type Dataset = ReportCatalog["datasets"][number];
type CatalogColumn = Dataset["columns"][number];
type Cell = string | number | null;
type FilterDraft = {
  id: number;
  column: string;
  op: ReportOperator;
  value: string;
  to: string;
  values: string[];
};
type Draft = {
  dataset: string;
  columns: string[];
  filters: FilterDraft[];
  sortColumn: string;
  direction: "asc" | "desc";
  limit: string;
};

const datasetIcons: Record<string, Icon> = {
  people: Users,
  leave: CalendarBlank,
  attendance: Clock,
  expenses: Receipt,
  assets: Laptop,
  policyAcknowledgements: Scroll,
  exits: DoorOpen,
};
const limitChoices = [25, 100, 500, 1000];
const firstColumns = 5;
const none = "__default__";

const humanize = (value: string) =>
  value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 });
const dayFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (value: string) => {
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  );
  return Number.isNaN(parsed.getTime()) ? value : dayFormat.format(parsed);
};

// Money arrives as integer paise; dates as YYYY-MM-DD.
function formatCell(value: Cell, type: string): string {
  if (value === null || value === "") return text.results.empty;
  if (type === "money" && typeof value === "number")
    return money.format(value / 100);
  if (type === "number" && typeof value === "number")
    return plain.format(value);
  if (type === "date" && typeof value === "string") return day(value);
  if (type === "enum" && typeof value === "string") return humanize(value);
  return String(value);
}

// The count stops at 10,001, so a capped total reads "10,000+".
const totalLabel = (result: ReportResult) =>
  result.totalCapped ? "10,000+" : result.total.toLocaleString("en-IN");

const filterable = (column: CatalogColumn) => column.operators.length > 0;

function emptyDraft(dataset: Dataset | undefined): Draft {
  return {
    dataset: dataset?.key ?? "",
    columns: (dataset?.columns ?? [])
      .filter((column) => !column.sensitive)
      .slice(0, firstColumns)
      .map((column) => column.key),
    filters: [],
    sortColumn: "",
    direction: "asc",
    limit: "100",
  };
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function scalar(column: CatalogColumn, raw: string): Checked<string | number> {
  const value = raw.trim();
  if (!value) return { ok: false, error: text.steps.filters.incomplete };
  switch (column.type) {
    case "number": {
      const number = Number(value);
      return Number.isFinite(number)
        ? { ok: true, value: number }
        : { ok: false, error: text.steps.filters.badNumber };
    }
    case "money": {
      const rupees = Number(value);
      if (!Number.isFinite(rupees))
        return { ok: false, error: text.steps.filters.badMoney };
      return Math.abs(rupees * 100 - Math.round(rupees * 100)) > 1e-6
        ? { ok: false, error: text.steps.filters.badMoney }
        : { ok: true, value: rupees };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { ok: true, value }
        : { ok: false, error: text.steps.filters.badDate };
    case "enum":
      return column.options?.includes(value)
        ? { ok: true, value }
        : { ok: false, error: text.steps.filters.badEnum };
    default:
      return value.length <= 120
        ? { ok: true, value }
        : { ok: false, error: text.steps.filters.incomplete };
  }
}

function toFilter(
  row: FilterDraft,
  column: CatalogColumn | undefined,
): Checked<ReportFilter> {
  const incomplete = {
    ok: false,
    error: text.steps.filters.incomplete,
  } as const;
  if (!column || !column.operators.includes(row.op)) return incomplete;
  switch (row.op) {
    case "contains": {
      const value = row.value.trim();
      return value && value.length <= 80
        ? { ok: true, value: { column: column.key, op: "contains", value } }
        : incomplete;
    }
    case "in": {
      const values =
        column.type === "enum"
          ? row.values
          : row.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
      if (!values.length) return incomplete;
      if (values.length > 50 || values.some((item) => item.length > 120))
        return { ok: false, error: text.steps.filters.tooMany };
      return { ok: true, value: { column: column.key, op: "in", values } };
    }
    case "between": {
      const from = scalar(column, row.value);
      if (!from.ok) return from;
      const to = scalar(column, row.to);
      if (!to.ok) return to;
      return {
        ok: true,
        value: {
          column: column.key,
          op: "between",
          from: from.value,
          to: to.value,
        },
      };
    }
    case "eq":
    case "gte":
    case "lte": {
      const value = scalar(column, row.value);
      return value.ok
        ? {
            ok: true,
            value: { column: column.key, op: row.op, value: value.value },
          }
        : value;
    }
  }
}

export default function Reports() {
  const { me } = useWorkspace();
  return me.permissions.includes("report.run") ? (
    <ReportsView />
  ) : (
    <ErrorState message={text.noAccess} />
  );
}

function ReportsView() {
  const { me } = useWorkspace();
  const queryClient = useQueryClient();
  const catalogQuery = useReportCatalog(true);
  const savedQuery = useSavedReports(true);
  const [tab, setTab] = useState<"build" | "saved">("build");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(undefined));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ReportResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{
    kind: "ok" | "warn" | "error";
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"save" | SavedReport | null>(null);
  const [archiving, setArchiving] = useState<SavedReport | null>(null);
  const nextId = useRef(1);
  const resultsRef = useRef<HTMLDivElement>(null);

  const catalog = catalogQuery.data;
  const dataset = catalog?.datasets.find((item) => item.key === draft.dataset);
  const columnByKey = useMemo(
    () => new Map(dataset?.columns.map((column) => [column.key, column])),
    [dataset],
  );

  useEffect(() => {
    if (runId > 0) {
      const target = resultsRef.current;
      target?.scrollIntoView({ block: "nearest" });
      target?.focus({ preventScroll: true });
    }
  }, [runId]);

  if (catalogQuery.error)
    return (
      <ErrorState
        message={catalogQuery.error.message}
        onRetry={() => void catalogQuery.refetch()}
      />
    );
  if (catalogQuery.isPending || !catalog) return <LoadingState />;

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }
  function pickDataset(key: string) {
    if (key === draft.dataset) return;
    setDraft(emptyDraft(catalog?.datasets.find((item) => item.key === key)));
    setErrors({});
    setResult(null);
    setRunError("");
    setExportNote(null);
    setNotice("");
  }
  function toggleColumn(key: string, on: boolean) {
    patch({
      columns: on
        ? [...draft.columns, key]
        : draft.columns.filter((item) => item !== key),
    });
  }
  function addFilter() {
    const column = dataset?.columns.find(filterable);
    if (!column) return;
    patch({
      filters: [
        ...draft.filters,
        {
          id: nextId.current++,
          column: column.key,
          op: column.operators[0] ?? "eq",
          value: "",
          to: "",
          values: [],
        },
      ],
    });
  }
  function changeFilter(id: number, change: Partial<FilterDraft>) {
    patch({
      filters: draft.filters.map((row) =>
        row.id === id ? { ...row, ...change } : row,
      ),
    });
    setErrors((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });
  }
  function changeFilterColumn(id: number, key: string) {
    const column = columnByKey.get(key);
    if (!column) return;
    changeFilter(id, {
      column: key,
      op: column.operators[0] ?? "eq",
      value: "",
      to: "",
      values: [],
    });
  }
  function removeFilter(id: number) {
    patch({ filters: draft.filters.filter((row) => row.id !== id) });
    setErrors((current) => {
      const rest = { ...current };
      delete rest[id];
      return rest;
    });
  }

  // Builds the definition the server will see, or marks the rows that need fixing.
  function build(): ReportDefinition | null {
    if (!dataset || !draft.columns.length) return null;
    const filters: ReportFilter[] = [];
    const problems: Record<number, string> = {};
    for (const row of draft.filters) {
      const checked = toFilter(row, columnByKey.get(row.column));
      if (checked.ok) filters.push(checked.value);
      else problems[row.id] = checked.error;
    }
    setErrors(problems);
    if (Object.keys(problems).length) return null;
    const ordered = dataset.columns
      .map((column) => column.key)
      .filter((key) => draft.columns.includes(key));
    const parsed = reportDefinitionSchema.safeParse({
      dataset: dataset.key,
      columns: ordered,
      filters,
      ...(draft.sortColumn
        ? { sort: { column: draft.sortColumn, direction: draft.direction } }
        : {}),
      limit: Number(draft.limit),
    });
    return parsed.success ? parsed.data : null;
  }

  async function run(definition: ReportDefinition | null = build()) {
    if (!definition || running) return;
    setRunning(true);
    setRunError("");
    setExportNote(null);
    try {
      const next = await api("/reports/run", reportResultSchema, {
        method: "POST",
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({ definition }),
      });
      setResult(next);
      setRunId((value) => value + 1);
      setNotice(text.results.ran(next.rows.length, totalLabel(next)));
    } catch (e) {
      setRunError(
        e instanceof ApiError && e.status === 429
          ? text.runTooMany
          : e instanceof ApiError && e.status === 503
            ? text.runUnavailable
            : e instanceof Error
              ? e.message
              : text.runFailed,
      );
    } finally {
      setRunning(false);
    }
  }

  async function exportCsv() {
    const definition = build();
    if (!definition || !dataset || exporting || running) return;
    setExporting(true);
    setExportNote(null);
    try {
      const response = await fetch("/api/v1/reports/export", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
        },
        body: JSON.stringify({ definition, fileName: dataset.label }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          title?: string;
        } | null;
        const message =
          response.status === 403
            ? text.exported.forbidden
            : response.status === 429
              ? (body?.title ?? text.exported.tooMany)
              : response.status === 503
                ? text.exported.unavailable
                : (body?.title ?? text.exported.failed);
        setExportNote({ kind: "error", message });
        return;
      }
      markTouched();
      const blob = await response.blob();
      const header = response.headers.get("Content-Disposition") ?? "";
      const file =
        /filename="([^"]+)"/.exec(header)?.[1] ?? text.exported.fileFallback;
      const rows = Number(response.headers.get("X-Report-Row-Count") ?? 0);
      const truncated = response.headers.get("X-Report-Truncated") === "true";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNote({
        kind: truncated ? "warn" : "ok",
        message: `${text.exported.done(rows, file)}${
          truncated
            ? ` ${text.exported.truncated(catalog!.limits.exportRows)}`
            : ""
        }`,
      });
    } catch {
      setExportNote({ kind: "error", message: text.exported.failed });
    } finally {
      setExporting(false);
    }
  }

  function load(item: SavedReport) {
    const target = catalog?.datasets.find((d) => d.key === item.dataset);
    if (!target) return;
    const def = item.definition;
    if (!def) return;
    setDraft({
      dataset: def.dataset,
      columns: def.columns,
      filters: def.filters.map((f) => {
        const column = target.columns.find((c) => c.key === f.column);
        const list = "values" in f ? f.values : [];
        return {
          id: nextId.current++,
          column: f.column,
          op: f.op,
          value:
            "value" in f
              ? String(f.value)
              : "from" in f
                ? String(f.from)
                : column?.type === "enum"
                  ? ""
                  : list.join(", "),
          to: "to" in f ? String(f.to) : "",
          values: column?.type === "enum" ? list : [],
        };
      }),
      sortColumn: def.sort?.column ?? "",
      direction: def.sort?.direction ?? "asc",
      limit: String(def.limit),
    });
    setErrors({});
    setResult(null);
    setTab("build");
    setNotice(text.saved.loaded());
    void run(def);
  }

  const refreshSaved = () =>
    queryClient.invalidateQueries({ queryKey: ["reports", "saved"] });
  const maxColumns = catalog.limits.maxColumns;
  const saved = savedQuery.data;
  const savedFull = Boolean(saved && saved.items.length >= saved.limit);
  const needsFix = Object.keys(errors).length > 0;

  return (
    <div className="page-enter reports-page">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.heading}
        description={text.intro}
      />
      <section className="reports-see" aria-labelledby="reports-see-title">
        <Info size={20} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="reports-see-title">{text.see.title}</h2>
          <p>{text.see.scope[catalog.scope]}</p>
          <ul>
            {text.see.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      </section>
      <p className="sr-only" role="status" aria-live="polite">
        {running ? text.actions.running : notice}
      </p>
      <section className="panel reports-panel">
        <UTabs
          selectedKey={tab}
          onSelectionChange={(key) =>
            setTab(key === "saved" ? "saved" : "build")
          }
        >
          <div className="reports-tabs-scroll">
            <UTabs.List
              type="underline"
              aria-label={text.tabs.label}
              className="reports-tabs"
            >
              <UTabs.Item id="build">{text.tabs.build}</UTabs.Item>
              <UTabs.Item id="saved">
                {text.tabs.saved}
                {saved ? ` (${saved.items.length})` : ""}
              </UTabs.Item>
            </UTabs.List>
          </div>
          <UTabs.Panel id="build" className="reports-tab-panel">
            {!catalog.datasets.length ? (
              <EmptyBlock
                icon={TableIcon}
                title={text.empty.title}
                description={text.empty.body}
              />
            ) : (
              <div className="reports-build">
                <Step
                  n={1}
                  title={text.steps.data.title}
                  hint={text.steps.data.hint}
                >
                  <RadioGroup
                    aria-label={text.steps.data.group}
                    value={draft.dataset || null}
                    onChange={pickDataset}
                    orientation="horizontal"
                    className="reports-datasets"
                  >
                    {catalog.datasets.map((item) => {
                      const DatasetIcon = datasetIcons[item.key] ?? TableIcon;
                      return (
                        <RadioButton
                          key={item.key}
                          value={item.key}
                          aria-label={item.label}
                          className="reports-dataset"
                          label={
                            <>
                              <span className="reports-dataset-top">
                                <span className="reports-dataset-icon">
                                  <DatasetIcon
                                    size={20}
                                    weight="duotone"
                                    aria-hidden="true"
                                  />
                                </span>
                                <span className="reports-dataset-name">
                                  {item.label}
                                </span>
                              </span>
                              <span className="reports-dataset-desc">
                                {item.description}
                              </span>
                            </>
                          }
                        />
                      );
                    })}
                  </RadioGroup>
                </Step>
                {dataset && (
                  <>
                    <Step
                      n={2}
                      title={text.steps.columns.title}
                      hint={text.steps.columns.hint}
                    >
                      <ColumnChooser
                        dataset={dataset}
                        chosen={draft.columns}
                        max={maxColumns}
                        onToggle={toggleColumn}
                      />
                    </Step>
                    <Step
                      n={3}
                      title={text.steps.filters.title}
                      hint={text.steps.filters.hint}
                    >
                      {draft.filters.length === 0 ? (
                        <p className="reports-quiet">
                          {text.steps.filters.none}
                        </p>
                      ) : (
                        <ol className="reports-filters">
                          {draft.filters.map((row, index) => (
                            <FilterLine
                              key={row.id}
                              n={index + 1}
                              row={row}
                              dataset={dataset}
                              error={errors[row.id]}
                              onChange={(change) =>
                                changeFilter(row.id, change)
                              }
                              onColumn={(key) =>
                                changeFilterColumn(row.id, key)
                              }
                              onRemove={() => removeFilter(row.id)}
                            />
                          ))}
                        </ol>
                      )}
                      <div className="reports-filter-add">
                        <Button
                          variant="secondary"
                          isDisabled={
                            draft.filters.length >= catalog.limits.maxFilters
                          }
                          onPress={addFilter}
                        >
                          <Plus size={16} aria-hidden="true" />
                          {text.steps.filters.add}
                        </Button>
                        {draft.filters.length >= catalog.limits.maxFilters && (
                          <span className="reports-quiet">
                            {text.steps.filters.limit(
                              catalog.limits.maxFilters,
                            )}
                          </span>
                        )}
                      </div>
                    </Step>
                    <Step n={4} title={text.steps.order.title}>
                      <div className="reports-order">
                        <Select
                          label={text.steps.order.sort}
                          selectedKey={draft.sortColumn || none}
                          onSelectionChange={(key) =>
                            patch({
                              sortColumn: key === none ? "" : String(key),
                            })
                          }
                        >
                          <Select.Item
                            id={none}
                            label={text.steps.order.defaultSort}
                          />
                          {dataset.columns.map((column) => (
                            <Select.Item
                              key={column.key}
                              id={column.key}
                              label={column.label}
                            />
                          ))}
                        </Select>
                        <Select
                          label={text.steps.order.direction}
                          selectedKey={draft.direction}
                          isDisabled={!draft.sortColumn}
                          onSelectionChange={(key) =>
                            patch({
                              direction: key === "desc" ? "desc" : "asc",
                            })
                          }
                        >
                          <Select.Item id="asc" label={text.steps.order.asc} />
                          <Select.Item
                            id="desc"
                            label={text.steps.order.desc}
                          />
                        </Select>
                        <Select
                          label={text.steps.order.limit}
                          selectedKey={draft.limit}
                          onSelectionChange={(key) =>
                            patch({ limit: String(key) })
                          }
                        >
                          {[...new Set([...limitChoices, Number(draft.limit)])]
                            .sort((a, b) => a - b)
                            .map((value) => (
                              <Select.Item
                                key={value}
                                id={String(value)}
                                label={text.steps.order.limitOption(value)}
                              />
                            ))}
                        </Select>
                      </div>
                    </Step>
                    <div className="reports-actions">
                      <div className="reports-buttons">
                        <Button
                          variant="primary"
                          isDisabled={
                            running || exporting || draft.columns.length === 0
                          }
                          onPress={() => void run()}
                        >
                          <Play size={16} weight="fill" aria-hidden="true" />
                          {text.actions.run}
                        </Button>
                        {catalog.canExport && (
                          <Button
                            variant="secondary"
                            isDisabled={
                              running || exporting || draft.columns.length === 0
                            }
                            onPress={() => void exportCsv()}
                          >
                            <DownloadSimple size={16} aria-hidden="true" />
                            {text.actions.export}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          isDisabled={
                            draft.columns.length === 0 || savedFull || running
                          }
                          onPress={() => {
                            if (build()) setSaving("save");
                          }}
                        >
                          <FloppyDisk size={16} aria-hidden="true" />
                          {text.actions.save}
                        </Button>
                      </div>
                      <p className="reports-quiet">
                        {catalog.canExport
                          ? text.actions.exportNote(catalog.limits.exportRows)
                          : text.actions.hrOnlyExport}
                      </p>
                      {draft.columns.length === 0 && (
                        <p className="reports-quiet">
                          {text.steps.columns.none}
                        </p>
                      )}
                      {savedFull && (
                        <p className="reports-note reports-note-warn">
                          <Warning
                            size={18}
                            weight="duotone"
                            aria-hidden="true"
                          />
                          <span>{text.saved.limitReached(saved!.limit)}</span>
                        </p>
                      )}
                      {needsFix && (
                        <p
                          className="reports-note reports-note-warn"
                          role="alert"
                        >
                          <Warning
                            size={18}
                            weight="duotone"
                            aria-hidden="true"
                          />
                          <span>{text.steps.filters.fix}</span>
                        </p>
                      )}
                      {runError && (
                        <p
                          className="reports-note reports-note-error"
                          role="alert"
                        >
                          <Warning
                            size={18}
                            weight="duotone"
                            aria-hidden="true"
                          />
                          <span>{runError}</span>
                        </p>
                      )}
                      {running && (
                        <p className="reports-quiet" aria-hidden="true">
                          {text.actions.running}
                        </p>
                      )}
                      {exporting && (
                        <p className="reports-quiet" aria-hidden="true">
                          {text.actions.exporting}
                        </p>
                      )}
                      {exportNote && (
                        <p
                          className={`reports-note reports-note-${
                            exportNote.kind === "ok"
                              ? "ok"
                              : exportNote.kind === "warn"
                                ? "warn"
                                : "error"
                          }`}
                          role={
                            exportNote.kind === "error" ? "alert" : "status"
                          }
                        >
                          {exportNote.kind === "ok" ? (
                            <CheckCircle
                              size={18}
                              weight="duotone"
                              aria-hidden="true"
                            />
                          ) : (
                            <Warning
                              size={18}
                              weight="duotone"
                              aria-hidden="true"
                            />
                          )}
                          <span>{exportNote.message}</span>
                        </p>
                      )}
                    </div>
                  </>
                )}
                <div
                  ref={resultsRef}
                  tabIndex={-1}
                  className="reports-results-anchor"
                  aria-label={result ? text.results.heading : undefined}
                >
                  {result && <Results key={runId} result={result} />}
                </div>
              </div>
            )}
          </UTabs.Panel>
          <UTabs.Panel id="saved" className="reports-tab-panel">
            <SavedList
              query={savedQuery}
              datasets={catalog.datasets}
              onRun={load}
              onRename={(item) => setSaving(item)}
              onArchive={setArchiving}
              onBuild={() => setTab("build")}
            />
          </UTabs.Panel>
        </UTabs>
      </section>
      {saving && (
        <NameDialog
          target={saving}
          onClose={() => setSaving(null)}
          onSubmit={async (name) => {
            if (saving === "save") {
              const definition = build();
              if (!definition) throw new Error(text.dialog.failed);
              await api("/reports/saved", savedReportSchema, {
                method: "POST",
                headers: { "X-CSRF-Token": me.csrfToken },
                body: JSON.stringify({ name, definition }),
              });
              setNotice(text.saved.savedDone());
            } else {
              await api(`/reports/saved/${saving.id}`, savedReportSchema, {
                method: "PUT",
                headers: { "X-CSRF-Token": me.csrfToken },
                body: JSON.stringify({
                  name,
                  definition: saving.definition ?? undefined,
                  version: saving.version,
                }),
              });
              setNotice(text.saved.renamedDone());
            }
            await refreshSaved();
            setSaving(null);
          }}
        />
      )}
      {archiving && (
        <ArchiveDialog
          item={archiving}
          onClose={() => setArchiving(null)}
          onConfirm={async () => {
            await api(
              `/reports/saved/${archiving.id}/archive`,
              savedReportSchema,
              {
                method: "POST",
                headers: { "X-CSRF-Token": me.csrfToken },
                body: JSON.stringify({ version: archiving.version }),
              },
            );
            setNotice(text.saved.archivedDone());
            await refreshSaved();
            setArchiving(null);
          }}
        />
      )}
    </div>
  );
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="reports-step" aria-labelledby={`reports-step-${n}`}>
      <span className="reports-step-n" aria-hidden="true">
        {n}
      </span>
      <div className="reports-step-body">
        <h2 id={`reports-step-${n}`}>{title}</h2>
        {hint && <p className="reports-quiet">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

function ColumnChooser({
  dataset,
  chosen,
  max,
  onToggle,
}: {
  dataset: Dataset;
  chosen: string[];
  max: number;
  onToggle: (key: string, on: boolean) => void;
}) {
  const standard = dataset.columns.filter((column) => !column.sensitive);
  const sensitive = dataset.columns.filter((column) => column.sensitive);
  const full = chosen.length >= max;
  const group = (
    title: string,
    columns: CatalogColumn[],
    isSensitive: boolean,
  ) => (
    <fieldset className="reports-columns-group">
      <legend>{title}</legend>
      {isSensitive && (
        <p className="reports-note reports-note-info">
          <Info size={18} weight="duotone" aria-hidden="true" />
          <span>{text.steps.columns.sensitiveHint}</span>
        </p>
      )}
      <div className="reports-columns-list">
        {columns.map((column) => (
          <Checkbox
            key={column.key}
            isSelected={chosen.includes(column.key)}
            isDisabled={full && !chosen.includes(column.key)}
            onChange={(on: boolean) => onToggle(column.key, on)}
            label={
              <span className="reports-column-label">
                {column.label}
                {column.sensitive && (
                  <StatusBadge color="warning" size="sm" type="pill-color">
                    {text.steps.columns.sensitiveBadge}
                  </StatusBadge>
                )}
              </span>
            }
          />
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="reports-columns">
      <p className="reports-count" aria-live="polite">
        {text.steps.columns.count(chosen.length, max)}
        {full && <> · {text.steps.columns.atMax(max)}</>}
      </p>
      {group(text.steps.columns.standard, standard, false)}
      {sensitive.length > 0 &&
        group(text.steps.columns.sensitive, sensitive, true)}
    </div>
  );
}

function FilterLine({
  n,
  row,
  dataset,
  error,
  onChange,
  onColumn,
  onRemove,
}: {
  n: number;
  row: FilterDraft;
  dataset: Dataset;
  error?: string;
  onChange: (change: Partial<FilterDraft>) => void;
  onColumn: (key: string) => void;
  onRemove: () => void;
}) {
  const column = dataset.columns.find((item) => item.key === row.column);
  const type = column?.type ?? "text";
  const operators = column?.operators ?? [];
  const copy = text.steps.filters;
  const inputType = type === "date" ? "date" : "number";

  let value: ReactNode;
  if (type === "enum" && row.op === "in") {
    value = (
      <fieldset className="reports-filter-multi">
        <legend>{copy.value(n)}</legend>
        {(column?.options ?? []).map((option) => (
          <Checkbox
            key={option}
            label={humanize(option)}
            isSelected={row.values.includes(option)}
            onChange={(on: boolean) =>
              onChange({
                values: on
                  ? [...row.values, option]
                  : row.values.filter((item) => item !== option),
              })
            }
          />
        ))}
      </fieldset>
    );
  } else if (type === "enum") {
    value = (
      <Select
        aria-label={copy.value(n)}
        placeholder={copy.pickPlaceholder}
        selectedKey={row.value || null}
        onSelectionChange={(key) => onChange({ value: String(key) })}
      >
        {(column?.options ?? []).map((option) => (
          <Select.Item key={option} id={option} label={humanize(option)} />
        ))}
      </Select>
    );
  } else if (type === "text" || row.op === "in") {
    value = (
      <Input
        aria-label={copy.value(n)}
        placeholder={
          row.op === "in" ? copy.listPlaceholder : copy.textPlaceholder
        }
        maxLength={row.op === "in" ? 600 : 80}
        value={row.value}
        onChange={(next: string) => onChange({ value: next })}
        autoComplete="off"
      />
    );
  } else if (row.op === "between") {
    value = (
      <div className="reports-filter-pair">
        <RangeInput
          label={copy.value(n)}
          type={inputType}
          step={type === "money" ? "0.01" : "any"}
          value={row.value}
          onChange={(next: string) => onChange({ value: next })}
        />
        <span aria-hidden="true">{copy.and}</span>
        <RangeInput
          label={copy.valueEnd(n)}
          type={inputType}
          step={type === "money" ? "0.01" : "any"}
          value={row.to}
          onChange={(next: string) => onChange({ to: next })}
        />
      </div>
    );
  } else {
    value = (
      <RangeInput
        label={copy.value(n)}
        type={inputType}
        step={type === "money" ? "0.01" : "any"}
        value={row.value}
        onChange={(next: string) => onChange({ value: next })}
      />
    );
  }

  return (
    <li className="reports-filter" aria-label={copy.group(n)}>
      <div className="reports-filter-grid">
        <Select
          aria-label={copy.column(n)}
          selectedKey={row.column}
          onSelectionChange={(key) => onColumn(String(key))}
        >
          {dataset.columns.filter(filterable).map((item) => (
            <Select.Item
              key={item.key}
              id={item.key}
              label={
                item.sensitive
                  ? `${item.label} (${text.steps.columns.sensitiveBadge})`
                  : item.label
              }
            />
          ))}
        </Select>
        <Select
          aria-label={copy.operator(n)}
          selectedKey={row.op}
          onSelectionChange={(key) =>
            onChange({
              op: String(key) as ReportOperator,
              value: "",
              to: "",
              values: [],
            })
          }
        >
          {operators.map((op) => (
            <Select.Item key={op} id={op} label={text.operators[type][op]} />
          ))}
        </Select>
        <div className="reports-filter-value">{value}</div>
        <Button
          variant="ghost"
          className="reports-filter-remove"
          aria-label={copy.remove(n)}
          onPress={onRemove}
        >
          <Trash size={18} aria-hidden="true" />
        </Button>
      </div>
      {type === "money" && <p className="reports-quiet">{copy.rupee}</p>}
      {error && (
        <p className="reports-filter-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

type ResultRow = { id: string; cells: Cell[] };

function Results({ result }: { result: ReportResult }) {
  const rows = useMemo<ResultRow[]>(
    () => result.rows.map((cells, index) => ({ id: String(index), cells })),
    [result],
  );
  const columns = useMemo<TableColumn<ResultRow>[]>(
    () =>
      result.columns.map((column, index) => ({
        id: column.key,
        label: column.label,
        isRowHeader: index === 0,
        className:
          column.type === "money" || column.type === "number"
            ? "reports-cell reports-cell-number"
            : "reports-cell",
        sortValue: (row) => {
          const cell = row.cells[index] ?? null;
          if (typeof cell === "number") return cell;
          return cell === null ? "" : cell.toLowerCase();
        },
        render: (row) => formatCell(row.cells[index] ?? null, column.type),
      })),
    [result],
  );
  const shown = result.rows.length;
  return (
    <div className="reports-results">
      {result.truncated && (
        <p className="reports-note reports-note-warn" role="status">
          <Warning size={18} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{text.results.truncatedTitle}.</strong>{" "}
            {text.results.truncated(shown, totalLabel(result))}
          </span>
        </p>
      )}
      <DataCard
        title={text.results.title}
        description={`${text.results.showing(shown, totalLabel(result))}. ${text.results.sortNote}`}
        label={text.results.label}
        columns={columns}
        rows={rows}
        getKey={(row) => row.id}
        pageSize={25}
        empty={
          <EmptyBlock
            icon={TableIcon}
            title={text.results.emptyTitle}
            description={text.results.emptyBody}
          />
        }
        mobileRow={(row) => (
          <dl className="reports-card">
            {result.columns.map((column, index) => (
              <div key={column.key}>
                <dt>{column.label}</dt>
                <dd>{formatCell(row.cells[index] ?? null, column.type)}</dd>
              </div>
            ))}
          </dl>
        )}
      />
    </div>
  );
}

function SavedList({
  query,
  datasets,
  onRun,
  onRename,
  onArchive,
  onBuild,
}: {
  query: ReturnType<typeof useSavedReports>;
  datasets: Dataset[];
  onRun: (item: SavedReport) => void;
  onRename: (item: SavedReport) => void;
  onArchive: (item: SavedReport) => void;
  onBuild: () => void;
}) {
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (query.isPending || !query.data) return <LoadingState />;
  const { items, limit } = query.data;
  return (
    <div className="reports-saved">
      <div className="reports-saved-head">
        <p className="reports-quiet">{text.saved.intro}</p>
        <StatusBadge color="gray" size="sm" type="pill-color">
          {text.saved.count(items.length, limit)}
        </StatusBadge>
      </div>
      {items.length >= limit && (
        <p className="reports-note reports-note-warn">
          <Warning size={18} weight="duotone" aria-hidden="true" />
          <span>{text.saved.limitReached(limit)}</span>
        </p>
      )}
      {items.length === 0 ? (
        <EmptyBlock
          icon={FloppyDisk}
          title={text.saved.emptyTitle}
          description={text.saved.emptyBody}
          action={
            <Button variant="secondary" onPress={onBuild}>
              {text.saved.goBuild}
            </Button>
          }
        />
      ) : (
        <ul className="reports-saved-list" aria-label={text.saved.list}>
          {items.map((item) => {
            const label =
              datasets.find((d) => d.key === item.dataset)?.label ??
              item.dataset;
            return (
              <li
                key={item.id}
                className="reports-saved-row"
                data-runnable={item.runnable}
              >
                <div className="reports-saved-main">
                  <strong>{item.name}</strong>
                  <span>
                    {item.definition
                      ? text.saved.meta(
                          label,
                          item.definition.columns.length,
                          item.definition.filters.length,
                          day(item.updatedAt),
                        )
                      : text.saved.metaLocked(label, day(item.updatedAt))}
                  </span>
                  {!item.runnable && (
                    <span className="reports-saved-why">
                      {text.saved.notRunnable}
                    </span>
                  )}
                </div>
                <div className="reports-saved-buttons">
                  <Button
                    variant="primary"
                    aria-label={text.saved.runName(item.name)}
                    isDisabled={!item.runnable}
                    onPress={() => onRun(item)}
                  >
                    <Play size={16} weight="fill" aria-hidden="true" />
                    {text.saved.run}
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={text.saved.renameName(item.name)}
                    isDisabled={!item.runnable}
                    onPress={() => onRename(item)}
                  >
                    <PencilSimple size={16} aria-hidden="true" />
                    {text.saved.rename}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={text.saved.archiveName(item.name)}
                    onPress={() => onArchive(item)}
                  >
                    <Archive size={16} aria-hidden="true" />
                    {text.saved.archive}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function failure(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 409 && /name/i.test(e.message))
      return text.dialog.nameTaken;
    if (e.status === 409) return text.dialog.stale;
    return e.message;
  }
  return text.dialog.failed;
}

function NameDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: "save" | SavedReport;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const renaming = target !== "save";
  const [name, setName] = useState(renaming ? target.name : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 80) {
      setError(text.dialog.nameBad);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError(failure(e));
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={renaming ? text.dialog.renameTitle : text.dialog.saveTitle}
      className="reports-dialog"
    >
      <form onSubmit={(event) => void submit(event)} className="reports-form">
        <p className="reports-quiet">
          {renaming ? text.dialog.renameIntro : text.dialog.saveIntro}
        </p>
        <Input
          label={text.dialog.name}
          hint={error ? undefined : text.dialog.nameHint}
          autoFocus
          isRequired
          hideRequiredIndicator
          minLength={3}
          maxLength={80}
          value={name}
          onChange={setName}
          isDisabled={busy}
          autoComplete="off"
        />
        {error && (
          <p className="reports-filter-error" role="alert">
            {error}
          </p>
        )}
        <div className="reports-dialog-actions">
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            {text.dialog.cancel}
          </Button>
          <Button type="submit" variant="primary" isDisabled={busy}>
            {busy
              ? text.dialog.saving
              : renaming
                ? text.dialog.submitRename
                : text.dialog.submitSave}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}

function ArchiveDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: SavedReport;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError(failure(e));
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={text.dialog.archiveTitle}
      className="reports-dialog"
    >
      <div className="reports-form">
        <p>{text.dialog.archiveBody(item.name)}</p>
        {error && (
          <p className="reports-filter-error" role="alert">
            {error}
          </p>
        )}
        <div className="reports-dialog-actions">
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            {text.dialog.keep}
          </Button>
          <Button
            variant="primary"
            isDisabled={busy}
            onPress={() => void confirm()}
          >
            {busy ? text.dialog.archiving : text.dialog.archiveSubmit}
          </Button>
        </div>
      </div>
    </DialogPanel>
  );
}
