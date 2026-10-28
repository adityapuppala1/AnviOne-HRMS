import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PauseCircle } from "@phosphor-icons/react/dist/csr/PauseCircle";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Rocket } from "@phosphor-icons/react/dist/csr/Rocket";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
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
  RangeInput,
  Select,
  StatCard,
  StatusBadge,
  TextArea,
  UTabs,
} from "@anvi/ui";
import {
  projectSchema,
  type MyTime,
  type Project,
  type ProjectList,
  type ProjectStatus,
  type ProjectTask,
  type ProjectTaskStatus,
  type TimeEntry,
  type TimeEntryStatus,
} from "@anvi/contracts";
import {
  ApiError,
  mutate,
  useDirectory,
  useMyTime,
  useProject,
  useProjectMembers,
  useProjects,
  useProjectTasks,
  useTimeReview,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { projectsCopy as text } from "../lib/copy/projects";
import { useWorkspace } from "./workspace";
// Shared dialog form styles come from the leave screen.
import "./leave.css";
import "./projects.css";

/* Dates and hours -------------------------------------------------------- */

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
/** Plain YYYY-MM-DD dates are shown as written, never shifted by time zone. */
const day = (value: string) =>
  dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
const addDays = (value: string, days: number) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
/** 135 -> "2h 15m"; 120 -> "2h"; 45 -> "45m". */
function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}
const durations = Array.from({ length: 48 }, (_, i) => (i + 1) * 15);
function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/* Shared bits ------------------------------------------------------------ */

type Tone = "gray" | "brand" | "error" | "warning" | "success";
const projectTone: Record<ProjectStatus, Tone> = {
  planned: "gray",
  active: "success",
  on_hold: "warning",
  completed: "brand",
  cancelled: "gray",
};
const entryTone: Record<TimeEntryStatus, Tone> = {
  submitted: "warning",
  approved: "success",
  rejected: "error",
  withdrawn: "gray",
};
const projectStatuses = Object.keys(text.projectStatus) as ProjectStatus[];
const taskStatuses = Object.keys(text.taskStatus) as ProjectTaskStatus[];
const isClosed = (status: ProjectStatus) =>
  status === "completed" || status === "cancelled";

function ProjectPill({ status }: { status: ProjectStatus }) {
  return (
    <StatusBadge color={projectTone[status]} size="sm" type="pill-color">
      {text.projectStatus[status]}
    </StatusBadge>
  );
}
function EntryPill({ status }: { status: TimeEntryStatus }) {
  return (
    <StatusBadge color={entryTone[status]} size="sm" type="pill-color">
      {text.entryStatus[status]}
    </StatusBadge>
  );
}

function useSend() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(
    path: string,
    body: unknown,
    fallback: string,
    options: {
      method?: "POST" | "PUT";
      map?: (message: string) => string | undefined;
    } = {},
  ): Promise<{ data: unknown } | null> {
    setBusy(true);
    setError("");
    try {
      const data = await mutate(
        path,
        me.csrfToken,
        body,
        options.method ?? "POST",
      );
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["time"] });
      return { data };
    } catch (cause) {
      if (cause instanceof ApiError) {
        const message = cause.message;
        if (cause.status === 409 && /changed/i.test(message))
          setError(text.errors.changed);
        else if (cause.status === 404) setError(text.errors.missing);
        else if (cause.status === 403)
          setError(message || text.errors.forbidden);
        else setError(options.map?.(message) ?? (message || fallback));
        if (cause.status === 409 || cause.status === 404) {
          void client.invalidateQueries({ queryKey: ["projects"] });
          void client.invalidateQueries({ queryKey: ["time"] });
        }
      } else setError(fallback);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}

function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="inline-error">
      {message}
    </p>
  ) : null;
}

function FormActions({
  busy,
  submit,
  saving,
  cancel = text.common.cancel,
  onCancel,
  disabled = false,
}: {
  busy: boolean;
  submit: string;
  saving: string;
  cancel?: string;
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

/** A small yes/no dialog for confirmations (remove, withdraw, reopen). */
function ConfirmDialog({
  title,
  intro,
  keep,
  submit,
  saving,
  onCancel,
  onConfirm,
  busy,
  error,
}: {
  title: string;
  intro: string;
  keep: string;
  submit: string;
  saving: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      title={title}
      className="leave-modal projects-modal"
    >
      <form
        className="leave-form"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <p>{intro}</p>
        <FormError message={error} />
        <FormActions
          busy={busy}
          cancel={keep}
          submit={submit}
          saving={saving}
          onCancel={onCancel}
        />
      </form>
    </DialogPanel>
  );
}

type Person = { id: string; name: string; title: string };

/** Search the directory and pick one person. */
function PersonPicker({
  chosen,
  onChoose,
  find,
  hint,
  results,
  none,
  selected,
  change,
  disabled,
  autoFocus = false,
}: {
  chosen: Person | null;
  onChoose: (person: Person | null) => void;
  find: string;
  hint?: string;
  results: string;
  none: string;
  selected: string;
  change: string;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const search = term.trim();
  const people = useDirectory(`q=${encodeURIComponent(search)}&limit=6`);
  if (chosen)
    return (
      <div className="projects-chosen">
        <span>
          <small>{selected}</small>
          <strong>{chosen.name}</strong>
          {chosen.title && <small>{chosen.title}</small>}
        </span>
        <Button
          variant="secondary"
          isDisabled={disabled}
          onPress={() => onChoose(null)}
        >
          {change}
        </Button>
      </div>
    );
  return (
    <>
      <Input
        label={find}
        hint={hint}
        autoComplete="off"
        maxLength={80}
        value={term}
        onChange={(value: string) => setTerm(value)}
        autoFocus={autoFocus}
      />
      {search && people.data && (
        <ul className="projects-people" aria-label={results}>
          {people.data.items.length === 0 ? (
            <li className="projects-muted">{none}</li>
          ) : (
            people.data.items.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() =>
                    onChoose({
                      id: person.id,
                      name: person.name,
                      title: person.title,
                    })
                  }
                >
                  <span className="projects-initials" aria-hidden="true">
                    {initialsOf(person.name)}
                  </span>
                  <span className="projects-person-text">
                    <strong>{person.name}</strong>
                    <small>
                      {person.title} · {person.department}
                    </small>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </>
  );
}

/* Page ------------------------------------------------------------------- */

type View = "projects" | "mine" | "approvals";

export default function Projects() {
  const { me } = useWorkspace();
  const { reduceMotion } = usePreferences();
  const canSelf = me.permissions.includes("project.self");
  const canManage = me.permissions.includes("project.manage");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [weekOf, setWeekOf] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [logging, setLogging] = useState<{ projectId: string | null } | null>(
    null,
  );
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams();
  if (term) params.set("q", term);
  if (status) params.set("status", status);
  const list = useProjects(canSelf || canManage, params.toString());
  const mine = useMyTime(canSelf, weekOf);
  const review = useTimeReview(canManage);
  const views: View[] = [
    ...(canSelf || canManage ? (["projects"] as const) : []),
    ...(canSelf ? (["mine"] as const) : []),
    ...(canManage ? (["approvals"] as const) : []),
  ];
  if (views.length === 0) return <ErrorState message={text.denied} />;
  const waiting = review.data?.total ?? 0;
  const panels: Record<View, ReactNode> = {
    projects: (
      <ProjectsView
        query={list}
        search={search}
        onSearch={setSearch}
        status={status}
        onStatus={setStatus}
        onOpen={setOpenId}
        reduceMotion={reduceMotion}
      />
    ),
    mine: (
      <MineView
        query={mine}
        weekOf={weekOf}
        onWeek={setWeekOf}
        onLog={() => setLogging({ projectId: null })}
      />
    ),
    approvals: <ApprovalsView query={review} />,
  };
  const icons = { projects: FolderSimple, mine: Clock, approvals: ListChecks };
  return (
    <div className="page-enter projects-page">
      <PageHeader
        title={text.title}
        description={canManage ? text.subtitleManage : text.subtitleSelf}
        actions={
          <>
            {list.data?.canCreate && (
              <Button onPress={() => setCreating(true)}>
                <Plus size={18} weight="bold" />
                {text.create.open}
              </Button>
            )}
            {canSelf && (
              <Button
                variant={list.data?.canCreate ? "secondary" : "primary"}
                onPress={() => setLogging({ projectId: null })}
              >
                <Clock size={18} />
                {text.log.open}
              </Button>
            )}
          </>
        }
      />
      {views.length > 1 ? (
        <UTabs className="leave-tabs" keyboardActivation="automatic">
          <UTabs.List type="underline" aria-label={text.tabs.label}>
            {views.map((view) => {
              const Icon = icons[view];
              return (
                <UTabs.Item key={view} id={view}>
                  <Icon size={18} />
                  {text.tabs[view]}
                  {view === "approvals" && waiting > 0 && (
                    <span className="tab-count">{waiting}</span>
                  )}
                </UTabs.Item>
              );
            })}
          </UTabs.List>
          {views.map((view) => (
            <UTabs.Panel key={view} id={view} className="tab-panel">
              {panels[view]}
            </UTabs.Panel>
          ))}
        </UTabs>
      ) : (
        panels[views[0]!]
      )}
      <aside className="projects-help" aria-label={text.honesty}>
        <p>{text.honesty}</p>
      </aside>
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      )}
      {openId && (
        <DetailDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onLog={canSelf ? (id) => setLogging({ projectId: id }) : undefined}
        />
      )}
      {logging && (
        <LogDialog
          initialProjectId={logging.projectId}
          loggable={mine.data?.projects ?? []}
          onClose={() => setLogging(null)}
        />
      )}
    </div>
  );
}

/* Projects list ---------------------------------------------------------- */

function ProjectsView({
  query,
  search,
  onSearch,
  status,
  onStatus,
  onOpen,
  reduceMotion,
}: {
  query: ReturnType<typeof useProjects>;
  search: string;
  onSearch: (value: string) => void;
  status: ProjectStatus | "";
  onStatus: (value: ProjectStatus | "") => void;
  onOpen: (id: string) => void;
  reduceMotion: boolean;
}) {
  // Keep the last answer on screen while a new search loads.
  const last = useRef<ProjectList | undefined>(undefined);
  if (query.data) last.current = query.data;
  const data = query.data ?? last.current;
  const counts = data?.counts;
  const total = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : 0;
  const filtered = Boolean(search.trim() || status);
  return (
    <>
      <div className="projects-stats">
        <StatCard
          label={text.stats.active}
          value={counts?.active ?? 0}
          hint={text.stats.activeHint}
          icon={Rocket}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.planned}
          value={counts?.planned ?? 0}
          hint={text.stats.plannedHint}
          icon={FolderSimple}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.onHold}
          value={counts?.on_hold ?? 0}
          hint={text.stats.onHoldHint}
          icon={PauseCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.closed}
          value={(counts?.completed ?? 0) + (counts?.cancelled ?? 0)}
          hint={text.stats.closedHint}
          icon={Archive}
          animate={!reduceMotion}
        />
      </div>
      <section
        className="panel projects-panel"
        aria-labelledby="projects-list-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="projects-list-heading">{text.list.heading}</h2>
            {data && (
              <p aria-live="polite">{text.list.total(data.items.length)}</p>
            )}
          </div>
        </div>
        <div className="projects-toolbar">
          <Input
            aria-label={text.list.searchLabel}
            placeholder={text.list.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={search}
            onChange={onSearch}
            className="projects-search"
          />
          <div
            className="projects-chips"
            role="group"
            aria-label={text.list.statusLabel}
          >
            <button
              type="button"
              className="projects-chip"
              aria-pressed={status === ""}
              onClick={() => onStatus("")}
            >
              {text.list.all} ({total})
            </button>
            {projectStatuses.map((key) => (
              <button
                key={key}
                type="button"
                className="projects-chip"
                aria-pressed={status === key}
                onClick={() => onStatus(status === key ? "" : key)}
              >
                {text.projectStatus[key]} ({counts?.[key] ?? 0})
              </button>
            ))}
          </div>
        </div>
        {query.error && !data ? (
          <ErrorState
            message={query.error.message || text.list.loadFailed}
            onRetry={() => void query.refetch()}
          />
        ) : !data ? (
          <LoadingState />
        ) : data.items.length === 0 ? (
          filtered ? (
            <EmptyBlock
              icon={FolderSimple}
              title={text.list.noMatchTitle}
              description={text.list.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    onSearch("");
                    onStatus("");
                  }}
                >
                  {text.list.clear}
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              icon={FolderSimple}
              title={text.list.emptyTitle}
              description={text.list.emptyBody}
            />
          )
        ) : (
          <CollectionView
            id="projects-all"
            label={text.list.heading}
            noun="projects"
            items={data.items}
            getKey={(project) => project.id}
            columns={projectColumns(onOpen)}
            renderCard={(project) => (
              <ProjectCard
                project={project}
                onOpen={() => onOpen(project.id)}
              />
            )}
            onOpen={(project) => onOpen(project.id)}
            cardClassName="!p-0 !shadow-none !ring-0"
            defaultView="cards"
          />
        )}
      </section>
    </>
  );
}

function projectColumns(open: (id: string) => void): Column<Project>[] {
  return [
    {
      id: "name",
      label: "Project",
      isRowHeader: true,
      sortValue: (p) => p.name,
      render: (p) => (
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm text-primary">{p.name}</strong>
          <code className="text-xs text-tertiary">{p.code}</code>
        </span>
      ),
    },
    {
      id: "status",
      label: "Status",
      sortValue: (p) => p.status,
      render: (p) => <ProjectPill status={p.status} />,
    },
    {
      id: "owner",
      label: "Owner",
      sortValue: (p) => p.ownerName,
      render: (p) => <span className="text-sm">{p.ownerName}</span>,
    },
    {
      id: "dates",
      label: "Dates",
      sortValue: (p) => p.startDate,
      render: (p) => (
        <span className="text-sm">
          {text.list.dates(day(p.startDate), p.endDate ? day(p.endDate) : null)}
        </span>
      ),
    },
    {
      id: "counts",
      label: "Team and tasks",
      sortValue: (p) => p.openTaskCount,
      render: (p) => (
        <span className="flex flex-col text-sm">
          <span>{text.list.members(p.memberCount)}</span>
          <span className="text-tertiary">
            {text.list.openTasks(p.openTaskCount)}
          </span>
        </span>
      ),
    },
    {
      id: "open",
      label: "",
      render: (p) => (
        <Button
          variant="secondary"
          onPress={() => open(p.id)}
          aria-label={text.list.openLabel(p.name)}
        >
          {text.list.open}
        </Button>
      ),
    },
  ];
}

function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: () => void;
}) {
  return (
    <div className="projects-card" data-status={project.status}>
      <div className="projects-card-head">
        <code>{project.code}</code>
        <ProjectPill status={project.status} />
      </div>
      <h3>{project.name}</h3>
      <p className="projects-muted">{text.list.owner(project.ownerName)}</p>
      <p className="projects-muted">
        {text.list.dates(
          day(project.startDate),
          project.endDate ? day(project.endDate) : null,
        )}
      </p>
      <p className="projects-counts">
        <span>{text.list.members(project.memberCount)}</span>
        <span>{text.list.openTasks(project.openTaskCount)}</span>
      </p>
      <Button
        variant="secondary"
        onPress={onOpen}
        aria-label={text.list.openLabel(project.name)}
      >
        {text.list.open}
      </Button>
    </div>
  );
}

/* New project ------------------------------------------------------------ */

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { me } = useWorkspace();
  const { run, busy, error, setError } = useSend();
  const isHr = me.role === "hr_admin";
  const today = todayIso();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"planned" | "active">("planned");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState("");
  const [owner, setOwner] = useState<Person | null>(null);
  const [badCode, setBadCode] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!/^[A-Z][A-Z0-9_-]{1,19}$/.test(code)) {
      setBadCode(true);
      return;
    }
    const description = String(form.get("description") ?? "").trim();
    setError("");
    const ok = await run(
      "/projects",
      {
        code,
        name: String(form.get("name") ?? "").trim(),
        description: description || null,
        ownerEmployeeId: isHr && owner ? owner.id : null,
        status,
        startDate: start,
        endDate: end || null,
      },
      text.create.failed,
    );
    if (!ok) return;
    const created = projectSchema.safeParse(ok.data);
    if (created.success) onCreated(created.data.id);
    else onClose();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={text.create.title}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.create.intro}</p>
        <Input
          label={text.create.code}
          hint={text.create.codeHint}
          name="code"
          isRequired
          hideRequiredIndicator
          maxLength={20}
          autoComplete="off"
          value={code}
          isInvalid={badCode}
          onChange={(value: string) => {
            setCode(value.toUpperCase());
            setBadCode(false);
          }}
          autoFocus
        />
        {badCode && (
          <p role="alert" className="inline-error">
            {text.create.needCode}
          </p>
        )}
        <Input
          label={text.create.name}
          name="name"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
        <TextArea
          label={text.create.description}
          hint={text.create.descriptionHint}
          name="description"
          textAreaClassName="projects-note-input"
          maxLength={500}
        />
        {isHr && (
          <PersonPicker
            chosen={owner}
            onChoose={setOwner}
            find={text.create.ownerFind}
            hint={text.create.ownerHint}
            results={text.create.ownerResults}
            none={text.create.ownerNone}
            selected={text.create.ownerSelected}
            change={text.create.ownerChange}
            disabled={busy}
          />
        )}
        <Select
          label={text.create.status}
          selectedKey={status}
          onSelectionChange={(key) =>
            setStatus(String(key) === "active" ? "active" : "planned")
          }
        >
          <Select.Item id="planned" label={text.projectStatus.planned} />
          <Select.Item id="active" label={text.projectStatus.active} />
        </Select>
        <RangeInput
          label={text.create.start}
          type="date"
          isRequired
          value={start}
          onChange={(value: string) => setStart(value)}
        />
        <RangeInput
          label={text.create.end}
          hint={text.create.endHint}
          type="date"
          value={end}
          min={start}
          onChange={(value: string) => setEnd(value)}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.create.submit}
          saving={text.create.saving}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}

/* Project details -------------------------------------------------------- */

function DetailDialog({
  id,
  onClose,
  onLog,
}: {
  id: string;
  onClose: () => void;
  onLog?: (projectId: string) => void;
}) {
  const query = useProject(id);
  const project = query.data;
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={text.detail.title}
      className="projects-detail-modal"
    >
      {query.error && !project ? (
        <ErrorState
          message={query.error.message || text.detail.loadFailed}
          onRetry={() => void query.refetch()}
        />
      ) : !project ? (
        <LoadingState />
      ) : (
        <ProjectBody project={project} onLog={onLog} />
      )}
    </DialogPanel>
  );
}

type Action = "edit" | "status" | "reopen";

function ProjectBody({
  project,
  onLog,
}: {
  project: Project;
  onLog?: (projectId: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const closed = isClosed(project.status);
  return (
    <div className="projects-detail">
      <header className="projects-detail-head">
        <div>
          <code>{project.code}</code>
          <h3>{project.name}</h3>
        </div>
        <ProjectPill status={project.status} />
      </header>
      <section aria-labelledby="projects-overview-heading">
        <div className="projects-section-head">
          <h4 id="projects-overview-heading">{text.detail.overview}</h4>
          <div className="projects-actions">
            {project.canLogTime && onLog && (
              <Button onPress={() => onLog(project.id)}>
                <Clock size={18} />
                {text.detail.logTime}
              </Button>
            )}
            {project.canManage && (
              <>
                <Button variant="secondary" onPress={() => setAction("edit")}>
                  {text.detail.edit}
                </Button>
                <Button variant="secondary" onPress={() => setAction("status")}>
                  {text.detail.changeStatus}
                </Button>
              </>
            )}
            {project.canReopen && (
              <Button variant="secondary" onPress={() => setAction("reopen")}>
                {text.detail.reopen}
              </Button>
            )}
          </div>
        </div>
        <dl className="projects-facts">
          <div>
            <dt>{text.detail.owner}</dt>
            <dd>{project.ownerName}</dd>
          </div>
          <div>
            <dt>{text.detail.dates}</dt>
            <dd>
              {text.list.dates(
                day(project.startDate),
                project.endDate ? day(project.endDate) : null,
              )}
            </dd>
          </div>
          <div className="projects-facts-wide">
            <dt>{text.detail.description}</dt>
            <dd>{project.description ?? text.detail.noDescription}</dd>
          </div>
        </dl>
        {closed && !project.canReopen && (
          <p className="projects-note">{text.detail.closedNote}</p>
        )}
      </section>
      <MembersSection project={project} />
      <TasksSection project={project} />
      {action === "edit" && (
        <EditDialog project={project} onClose={() => setAction(null)} />
      )}
      {action === "status" && (
        <StatusDialog project={project} onClose={() => setAction(null)} />
      )}
      {action === "reopen" && (
        <ReopenDialog project={project} onClose={() => setAction(null)} />
      )}
    </div>
  );
}

function EditDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { me } = useWorkspace();
  const { run, busy, error } = useSend();
  const isHr = me.role === "hr_admin";
  const [owner, setOwner] = useState<Person | null>({
    id: project.ownerEmployeeId,
    name: project.ownerName,
    title: "",
  });
  const [start, setStart] = useState(project.startDate.slice(0, 10));
  const [end, setEnd] = useState(project.endDate?.slice(0, 10) ?? "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get("description") ?? "").trim();
    const ok = await run(
      `/projects/${project.id}`,
      {
        version: project.version,
        name: String(form.get("name") ?? "").trim(),
        description: description || null,
        ownerEmployeeId: owner?.id ?? project.ownerEmployeeId,
        startDate: start,
        endDate: end || null,
      },
      text.edit.failed,
      { method: "PUT" },
    );
    if (ok) onClose();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={text.edit.title}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <Input
          label={text.create.name}
          name="name"
          defaultValue={project.name}
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
        <TextArea
          label={text.create.description}
          hint={text.create.descriptionHint}
          name="description"
          defaultValue={project.description ?? ""}
          textAreaClassName="projects-note-input"
          maxLength={500}
        />
        {isHr && (
          <PersonPicker
            chosen={owner}
            onChoose={setOwner}
            find={text.edit.owner}
            hint={text.edit.ownerHint}
            results={text.create.ownerResults}
            none={text.create.ownerNone}
            selected={text.create.ownerSelected}
            change={text.create.ownerChange}
            disabled={busy}
          />
        )}
        <RangeInput
          label={text.create.start}
          type="date"
          isRequired
          value={start}
          onChange={(value: string) => setStart(value)}
        />
        <RangeInput
          label={text.create.end}
          hint={text.create.endHint}
          type="date"
          value={end}
          min={start}
          onChange={(value: string) => setEnd(value)}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.edit.submit}
          saving={text.edit.saving}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}

function StatusDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { run, busy, error } = useSend();
  const options = projectStatuses.filter((s) => s !== project.status);
  const [next, setNext] = useState<ProjectStatus>(options[0]!);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await run(
      `/projects/${project.id}/status`,
      { version: project.version, status: next },
      text.statusChange.failed,
    );
    if (ok) onClose();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={text.statusChange.title}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.statusChange.intro(project.name)}</p>
        <Select
          label={text.statusChange.label}
          selectedKey={next}
          onSelectionChange={(key) => setNext(String(key) as ProjectStatus)}
        >
          {options.map((key) => (
            <Select.Item key={key} id={key} label={text.projectStatus[key]} />
          ))}
        </Select>
        {isClosed(next) && (
          <p className="projects-note">{text.statusChange.closeWarning}</p>
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.statusChange.submit}
          saving={text.statusChange.saving}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}

function ReopenDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { run, busy, error } = useSend();
  return (
    <ConfirmDialog
      title={text.statusChange.reopenTitle}
      intro={text.statusChange.reopenIntro(project.name)}
      keep={text.common.cancel}
      submit={text.statusChange.reopenSubmit}
      saving={text.statusChange.saving}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() =>
        void run(
          `/projects/${project.id}/status`,
          { version: project.version, status: "active" },
          text.statusChange.failed,
        ).then((ok) => ok && onClose())
      }
    />
  );
}

/* Members ---------------------------------------------------------------- */

function MembersSection({ project }: { project: Project }) {
  const query = useProjectMembers(project.id);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{
    version: number;
    employeeId: string;
    name: string;
  } | null>(null);
  const data = query.data;
  const active = data?.items.filter((m) => !m.removedAt) ?? [];
  return (
    <section aria-labelledby="projects-members-heading">
      <div className="projects-section-head">
        <div>
          <h4 id="projects-members-heading">{text.members.heading}</h4>
          {data && (
            <p className="projects-muted" aria-live="polite">
              {text.members.total(active.length)}
            </p>
          )}
        </div>
        {data?.canAdd && (
          <Button variant="secondary" onPress={() => setAdding(true)}>
            <Plus size={18} weight="bold" />
            {text.members.add}
          </Button>
        )}
      </div>
      {query.error && !data ? (
        <ErrorState
          message={query.error.message || text.members.loadFailed}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <LoadingState />
      ) : active.length === 0 ? (
        <p className="projects-muted">{text.members.empty}</p>
      ) : (
        <ul className="projects-members">
          {active.map((member) => (
            <li key={member.id}>
              <span className="projects-initials" aria-hidden="true">
                {initialsOf(member.employeeName)}
              </span>
              <span className="projects-person-text">
                <strong>{member.employeeName}</strong>
                <small>
                  {member.employeeCode} · {text.members.roles[member.role]} ·{" "}
                  {text.members.since(day(member.addedAt))}
                </small>
              </span>
              {member.canRemove && (
                <Button
                  variant="secondary"
                  aria-label={text.members.removeLabel(member.employeeName)}
                  onPress={() =>
                    setRemoving({
                      version: member.version,
                      employeeId: member.employeeId,
                      name: member.employeeName,
                    })
                  }
                >
                  {text.members.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddMemberDialog project={project} onClose={() => setAdding(false)} />
      )}
      {removing && (
        <RemoveMemberDialog
          project={project}
          member={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function AddMemberDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { run, busy, error, setError } = useSend();
  const [chosen, setChosen] = useState<Person | null>(null);
  const [role, setRole] = useState<"member" | "lead">("member");
  const [missing, setMissing] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) {
      setMissing(true);
      return;
    }
    setError("");
    const ok = await run(
      `/projects/${project.id}/members`,
      { employeeId: chosen.id, role },
      text.members.failed,
    );
    if (ok) onClose();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={text.members.addTitle}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <PersonPicker
          chosen={chosen}
          onChoose={(person) => {
            setChosen(person);
            setMissing(false);
          }}
          find={text.members.find}
          hint={text.members.findHint}
          results={text.members.results}
          none={text.members.none}
          selected={text.members.selected}
          change={text.members.change}
          disabled={busy}
          autoFocus
        />
        {missing && (
          <p role="alert" className="inline-error">
            {text.members.needPerson}
          </p>
        )}
        <Select
          label={text.members.role}
          selectedKey={role}
          onSelectionChange={(key) =>
            setRole(String(key) === "lead" ? "lead" : "member")
          }
        >
          <Select.Item id="member" label={text.members.roles.member} />
          <Select.Item id="lead" label={text.members.roles.lead} />
        </Select>
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.members.submit}
          saving={text.members.saving}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}

function RemoveMemberDialog({
  project,
  member,
  onClose,
}: {
  project: Project;
  member: { version: number; employeeId: string; name: string };
  onClose: () => void;
}) {
  const { run, busy, error } = useSend();
  return (
    <ConfirmDialog
      title={text.members.removeTitle}
      intro={text.members.removeIntro(member.name)}
      keep={text.members.keep}
      submit={text.members.removeSubmit}
      saving={text.members.removing}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() =>
        void run(
          `/projects/${project.id}/members/${member.employeeId}/remove`,
          { version: member.version },
          text.members.removeFailed,
        ).then((ok) => ok && onClose())
      }
    />
  );
}

/* Tasks ------------------------------------------------------------------ */

function TasksSection({ project }: { project: Project }) {
  const query = useProjectTasks(project.id);
  const { run, busy, error, setError } = useSend();
  const [editing, setEditing] = useState<ProjectTask | "new" | null>(null);
  const data = query.data;
  const today = todayIso();
  async function move(task: ProjectTask, status: ProjectTaskStatus) {
    setError("");
    await run(
      `/projects/${project.id}/tasks/${task.id}/status`,
      { version: task.version, status },
      text.tasks.moveFailed,
    );
  }
  return (
    <section aria-labelledby="projects-tasks-heading">
      <div className="projects-section-head">
        <h4 id="projects-tasks-heading">{text.tasks.heading}</h4>
        {data?.canAdd && (
          <Button variant="secondary" onPress={() => setEditing("new")}>
            <Plus size={18} weight="bold" />
            {text.tasks.add}
          </Button>
        )}
      </div>
      <FormError message={error} />
      {query.error && !data ? (
        <ErrorState
          message={query.error.message || text.tasks.loadFailed}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          {data.items.length === 0 && (
            <p className="projects-muted">{text.tasks.noTasks}</p>
          )}
          <div className="projects-board">
            {taskStatuses.map((status) => {
              const items = data.items.filter((t) => t.status === status);
              const headingId = `projects-col-${status}`;
              return (
                <section
                  key={status}
                  className="projects-column"
                  aria-labelledby={headingId}
                >
                  <h5 id={headingId}>
                    {text.tasks.columnCount(
                      text.taskStatus[status],
                      items.length,
                    )}
                  </h5>
                  {items.length === 0 ? (
                    <p className="projects-muted">{text.tasks.empty}</p>
                  ) : (
                    <ul>
                      {items.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          today={today}
                          busy={busy}
                          onMove={(next) => void move(task, next)}
                          onEdit={() => setEditing(task)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      {editing && (
        <TaskDialog
          project={project}
          task={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function TaskCard({
  task,
  today,
  busy,
  onMove,
  onEdit,
}: {
  task: ProjectTask;
  today: string;
  busy: boolean;
  onMove: (status: ProjectTaskStatus) => void;
  onEdit: () => void;
}) {
  const overdue = Boolean(
    task.dueDate && task.status !== "done" && task.dueDate.slice(0, 10) < today,
  );
  const tone: Tone =
    task.priority === "high"
      ? "error"
      : task.priority === "normal"
        ? "brand"
        : "gray";
  return (
    <li className="projects-task" data-overdue={overdue}>
      <strong>{task.title}</strong>
      <div className="projects-task-badges">
        <StatusBadge color={tone} size="sm" type="pill-color">
          {text.priorityBadge(text.priority[task.priority])}
        </StatusBadge>
        {task.dueDate && (
          <StatusBadge
            color={overdue ? "error" : "gray"}
            size="sm"
            type="pill-color"
          >
            {overdue
              ? text.tasks.overdue(day(task.dueDate))
              : text.tasks.due_(day(task.dueDate))}
          </StatusBadge>
        )}
      </div>
      {task.assigneeName && (
        <small className="projects-muted">
          {text.tasks.assignedTo(task.assigneeName)}
        </small>
      )}
      <div className="projects-task-actions">
        {task.canChangeStatus &&
          taskStatuses
            .filter((s) => s !== task.status)
            .map((s) => (
              <Button
                key={s}
                variant="secondary"
                isDisabled={busy}
                aria-label={text.tasks.moveLabel(
                  task.title,
                  text.taskStatus[s],
                )}
                onPress={() => onMove(s)}
              >
                {text.tasks.moveTo(text.taskStatus[s])}
              </Button>
            ))}
        {task.canEdit && (
          <Button
            variant="ghost"
            aria-label={text.tasks.editLabel(task.title)}
            onPress={onEdit}
          >
            {text.tasks.edit}
          </Button>
        )}
      </div>
    </li>
  );
}

function TaskDialog({
  project,
  task,
  onClose,
}: {
  project: Project;
  task: ProjectTask | null;
  onClose: () => void;
}) {
  const { run, busy, error } = useSend();
  const members = useProjectMembers(project.id);
  const people = members.data?.items.filter((m) => !m.removedAt) ?? [];
  const [assignee, setAssignee] = useState(task?.assigneeEmployeeId ?? "none");
  const [priority, setPriority] = useState<"low" | "normal" | "high">(
    task?.priority ?? "normal",
  );
  const [due, setDue] = useState(task?.dueDate?.slice(0, 10) ?? "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get("description") ?? "").trim();
    const body = {
      title: String(form.get("title") ?? "").trim(),
      description: description || null,
      assigneeEmployeeId: assignee === "none" ? null : assignee,
      priority,
      dueDate: due || null,
    };
    const ok = task
      ? await run(
          `/projects/${project.id}/tasks/${task.id}`,
          { ...body, version: task.version },
          text.tasks.failed,
          { method: "PUT" },
        )
      : await run(`/projects/${project.id}/tasks`, body, text.tasks.failed);
    if (ok) onClose();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={task ? text.tasks.editTitle : text.tasks.addTitle}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <Input
          label={text.tasks.title}
          hint={text.tasks.titleHint}
          name="title"
          defaultValue={task?.title ?? ""}
          isRequired
          hideRequiredIndicator
          minLength={3}
          maxLength={120}
          autoComplete="off"
          autoFocus
        />
        <TextArea
          label={text.tasks.description}
          hint={text.tasks.descriptionHint}
          name="description"
          defaultValue={task?.description ?? ""}
          textAreaClassName="projects-note-input"
          maxLength={1000}
        />
        <Select
          label={text.tasks.assignee}
          selectedKey={assignee}
          onSelectionChange={(key) => setAssignee(String(key))}
        >
          <Select.Item id="none" label={text.tasks.unassigned} />
          {people.map((m) => (
            <Select.Item
              key={m.employeeId}
              id={m.employeeId}
              label={m.employeeName}
            />
          ))}
        </Select>
        <Select
          label={text.tasks.priority}
          selectedKey={priority}
          onSelectionChange={(key) =>
            setPriority(String(key) as "low" | "normal" | "high")
          }
        >
          {(["low", "normal", "high"] as const).map((key) => (
            <Select.Item key={key} id={key} label={text.priority[key]} />
          ))}
        </Select>
        <RangeInput
          label={text.tasks.due}
          hint={text.tasks.dueHint}
          type="date"
          value={due}
          onChange={(value: string) => setDue(value)}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={task ? text.tasks.submitSave : text.tasks.submitAdd}
          saving={text.tasks.saving}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}

/* My time ---------------------------------------------------------------- */

function EntryRow({
  entry,
  showPerson = false,
  children,
}: {
  entry: TimeEntry;
  showPerson?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="projects-entry">
      <div className="projects-entry-main">
        <div className="projects-entry-title">
          <strong>
            {showPerson ? `${entry.employeeName} · ` : ""}
            {entry.projectName ?? entry.projectCode}
          </strong>
          <span className="projects-hours">{hours(entry.minutes)}</span>
        </div>
        <div className="projects-meta">
          <EntryPill status={entry.status} />
          <small>{day(entry.workDate)}</small>
          <small>{entry.projectCode}</small>
          {entry.taskTitle && <small>{text.mine.task(entry.taskTitle)}</small>}
        </div>
        {entry.note && <small className="projects-muted">{entry.note}</small>}
        {entry.decisionNote && (
          <small className="projects-muted">
            {text.mine.decisionNote(entry.decisionNote)}
          </small>
        )}
      </div>
      {children && <div className="projects-entry-actions">{children}</div>}
    </li>
  );
}

function MineView({
  query,
  weekOf,
  onWeek,
  onLog,
}: {
  query: ReturnType<typeof useMyTime>;
  weekOf: string | undefined;
  onWeek: (value: string | undefined) => void;
  onLog: () => void;
}) {
  const [withdrawing, setWithdrawing] = useState<TimeEntry | null>(null);
  const last = useRef<MyTime | undefined>(undefined);
  if (query.data) last.current = query.data;
  const data = query.data ?? last.current;
  if (query.error && !data)
    return (
      <ErrorState
        message={query.error.message || text.mine.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  if (!data) return <LoadingState />;
  const { week, items } = data;
  const peak = week.projects.reduce((max, p) => Math.max(max, p.minutes), 0);
  const isCurrent = week.end >= todayIso();
  return (
    <>
      <section
        className="panel projects-panel"
        aria-labelledby="projects-week-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="projects-week-heading">{text.mine.totalHeading}</h2>
            <p aria-live="polite">
              {text.mine.total(hours(week.totalMinutes))}
            </p>
          </div>
        </div>
        <div
          className="projects-week"
          role="group"
          aria-label={text.mine.weekLabel}
        >
          <Button
            variant="secondary"
            onPress={() => onWeek(addDays(week.start, -7))}
          >
            {text.mine.prev}
          </Button>
          <strong>{text.mine.range(day(week.start), day(week.end))}</strong>
          <Button
            variant="secondary"
            isDisabled={isCurrent}
            onPress={() => onWeek(addDays(week.start, 7))}
          >
            {text.mine.next}
          </Button>
          {weekOf && (
            <Button variant="ghost" onPress={() => onWeek(undefined)}>
              {text.mine.thisWeek}
            </Button>
          )}
        </div>
        <h3 className="projects-sub">{text.mine.byProject}</h3>
        {week.projects.length === 0 ? (
          <p className="projects-muted projects-pad">
            {text.mine.byProjectEmpty}
          </p>
        ) : (
          <ul className="projects-bars">
            {week.projects.map((p) => (
              <li key={p.projectId}>
                <span className="projects-bar-name">
                  {p.projectName ?? p.projectCode}
                </span>
                <span className="projects-bar-track" aria-hidden="true">
                  <span
                    className="projects-bar"
                    style={
                      {
                        "--w": `${peak ? Math.max(4, Math.round((p.minutes / peak) * 100)) : 0}%`,
                      } as CSSProperties
                    }
                  />
                </span>
                <span className="projects-hours">{hours(p.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        className="panel projects-panel"
        aria-labelledby="projects-entries-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="projects-entries-heading">{text.mine.entries}</h2>
            <p aria-live="polite">{text.mine.entriesTotal(items.length)}</p>
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyBlock
            icon={Clock}
            title={text.mine.emptyTitle}
            description={text.mine.emptyBody}
            action={
              <Button variant="secondary" onPress={onLog}>
                {text.log.open}
              </Button>
            }
          />
        ) : (
          <ul className="projects-entries">
            {items.map((entry) => (
              <EntryRow key={entry.id} entry={entry}>
                {entry.canWithdraw && (
                  <Button
                    variant="secondary"
                    aria-label={text.mine.withdrawLabel(
                      entry.projectName ?? entry.projectCode,
                      day(entry.workDate),
                    )}
                    onPress={() => setWithdrawing(entry)}
                  >
                    {text.mine.withdraw}
                  </Button>
                )}
              </EntryRow>
            ))}
          </ul>
        )}
      </section>
      {withdrawing && (
        <WithdrawDialog
          entry={withdrawing}
          onClose={() => setWithdrawing(null)}
        />
      )}
    </>
  );
}

function WithdrawDialog({
  entry,
  onClose,
}: {
  entry: TimeEntry;
  onClose: () => void;
}) {
  const { run, busy, error } = useSend();
  const project = entry.projectName ?? entry.projectCode;
  return (
    <ConfirmDialog
      title={text.mine.withdrawTitle}
      intro={text.mine.withdrawIntro(
        hours(entry.minutes),
        project,
        day(entry.workDate),
      )}
      keep={text.mine.withdrawKeep}
      submit={text.mine.withdrawSubmit}
      saving={text.mine.withdrawing}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() =>
        void run(
          `/time/mine/${entry.id}/withdraw`,
          { version: entry.version },
          text.mine.withdrawFailed,
        ).then((ok) => ok && onClose())
      }
    />
  );
}

/* Log time --------------------------------------------------------------- */

function LogDialog({
  initialProjectId,
  loggable,
  onClose,
}: {
  initialProjectId: string | null;
  loggable: MyTime["projects"];
  onClose: () => void;
}) {
  const { run, busy, error, setError } = useSend();
  const today = todayIso();
  const [projectId, setProjectId] = useState(
    initialProjectId && loggable.some((p) => p.id === initialProjectId)
      ? initialProjectId
      : (loggable[0]?.id ?? ""),
  );
  const [taskId, setTaskId] = useState("none");
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState("60");
  const [note, setNote] = useState("");
  const tasks = useProjectTasks(projectId || null);
  const open = (tasks.data?.items ?? []).filter((t) => t.status !== "done");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setError("");
    const ok = await run(
      "/time/mine",
      {
        projectId,
        taskId: taskId === "none" ? null : taskId,
        workDate: date,
        minutes: Number(minutes),
        note: note.trim() || null,
      },
      text.log.failed,
      {
        map: (message) =>
          /more than 24 hours/i.test(message)
            ? text.log.dayFull
            : /active project|closed/i.test(message)
              ? text.log.closed
              : undefined,
      },
    );
    if (ok) onClose();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={text.log.title}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.log.intro}</p>
        {loggable.length === 0 ? (
          <p className="projects-note">{text.log.noProjects}</p>
        ) : (
          <>
            <Select
              label={text.log.project}
              selectedKey={projectId || null}
              placeholder={text.log.project}
              onSelectionChange={(key) => {
                setProjectId(String(key));
                setTaskId("none");
              }}
            >
              {loggable.map((p) => (
                <Select.Item
                  key={p.id}
                  id={p.id}
                  label={`${p.code} · ${p.name}`}
                />
              ))}
            </Select>
            <Select
              label={text.log.task}
              hint={text.log.taskHint}
              selectedKey={taskId}
              onSelectionChange={(key) => setTaskId(String(key))}
            >
              <Select.Item id="none" label={text.log.taskNone} />
              {open.map((t) => (
                <Select.Item key={t.id} id={t.id} label={t.title} />
              ))}
            </Select>
            <RangeInput
              label={text.log.date}
              hint={text.log.dateHint}
              type="date"
              isRequired
              value={date}
              min={addDays(today, -60)}
              max={today}
              onChange={(value: string) => setDate(value)}
            />
            <Select
              label={text.log.duration}
              hint={text.log.durationHint}
              selectedKey={minutes}
              onSelectionChange={(key) => setMinutes(String(key))}
            >
              {durations.map((m) => (
                <Select.Item key={m} id={String(m)} label={hours(m)} />
              ))}
            </Select>
            <TextArea
              label={text.log.note}
              hint={`${text.log.noteHint} ${text.log.count(note.length)}`}
              textAreaClassName="projects-note-input"
              maxLength={300}
              value={note}
              onChange={(value: string) => setNote(value)}
            />
          </>
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          disabled={!projectId || !date}
          submit={text.log.submit}
          saving={text.log.saving}
          cancel={text.log.cancel}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}

/* Time approvals --------------------------------------------------------- */

function ApprovalsView({ query }: { query: ReturnType<typeof useTimeReview> }) {
  const { me } = useWorkspace();
  const [deciding, setDeciding] = useState<{
    entry: TimeEntry;
    kind: "approve" | "reject";
  } | null>(null);
  const data = query.data;
  return (
    <section
      className="panel projects-panel"
      aria-labelledby="projects-approvals-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="projects-approvals-heading">{text.approvals.heading}</h2>
          {data && (
            <p aria-live="polite">
              {text.approvals.total(data.total)} ·{" "}
              {text.approvals.awaitingHours(hours(data.awaitingMinutes))}
            </p>
          )}
        </div>
      </div>
      <p className="projects-note projects-honest">{text.approvals.honest}</p>
      {query.error && !data ? (
        <ErrorState
          message={query.error.message || text.approvals.loadFailed}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <LoadingState />
      ) : data.items.length === 0 ? (
        <EmptyBlock
          icon={CheckCircle}
          title={text.approvals.emptyTitle}
          description={text.approvals.emptyBody}
        />
      ) : (
        <ul className="projects-entries">
          {data.items.map((entry) => {
            const when = day(entry.workDate);
            return (
              <EntryRow key={entry.id} entry={entry} showPerson>
                {entry.canDecide ? (
                  <>
                    <Button
                      aria-label={text.approvals.approveLabel(
                        entry.employeeName,
                        when,
                      )}
                      onPress={() => setDeciding({ entry, kind: "approve" })}
                    >
                      {text.approvals.approve}
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={text.approvals.rejectLabel(
                        entry.employeeName,
                        when,
                      )}
                      onPress={() => setDeciding({ entry, kind: "reject" })}
                    >
                      {text.approvals.reject}
                    </Button>
                  </>
                ) : (
                  <small className="projects-muted">
                    {entry.employeeId === me.employeeId
                      ? text.approvals.ownTime
                      : text.approvals.cannotDecide}
                  </small>
                )}
              </EntryRow>
            );
          })}
        </ul>
      )}
      {deciding && (
        <DecideDialog
          entry={deciding.entry}
          kind={deciding.kind}
          onClose={() => setDeciding(null)}
        />
      )}
    </section>
  );
}

function DecideDialog({
  entry,
  kind,
  onClose,
}: {
  entry: TimeEntry;
  kind: "approve" | "reject";
  onClose: () => void;
}) {
  const { run, busy, error } = useSend();
  const approve = kind === "approve";
  const [note, setNote] = useState("");
  const project = entry.projectName ?? entry.projectCode;
  const tooShort = !approve && note.trim().length < 3;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooShort) return;
    const trimmed = note.trim();
    const ok = await run(
      `/time/${entry.id}/${kind}`,
      approve
        ? { version: entry.version, ...(trimmed ? { note: trimmed } : {}) }
        : { version: entry.version, note: trimmed },
      approve ? text.approvals.approveFailed : text.approvals.rejectFailed,
    );
    if (ok) onClose();
  }
  const intro = approve
    ? text.approvals.approveIntro
    : text.approvals.rejectIntro;
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={approve ? text.approvals.approveTitle : text.approvals.rejectTitle}
      className="leave-modal projects-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{intro(hours(entry.minutes), entry.employeeName, project)}</p>
        <TextArea
          label={text.approvals.approveNote}
          hint={`${approve ? text.approvals.approveNoteHint : text.approvals.rejectNoteHint} ${text.common.count(note.length, 500)}`}
          textAreaClassName="projects-note-input"
          isRequired={!approve}
          hideRequiredIndicator
          maxLength={500}
          value={note}
          autoFocus
          onChange={(value: string) => setNote(value)}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          disabled={
            tooShort ||
            (approve && note.trim().length > 0 && note.trim().length < 3)
          }
          submit={
            approve ? text.approvals.approveSubmit : text.approvals.rejectSubmit
          }
          saving={approve ? text.approvals.approving : text.approvals.rejecting}
          onCancel={onClose}
        />
      </form>
    </DialogPanel>
  );
}
