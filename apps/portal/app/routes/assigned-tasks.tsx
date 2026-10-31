import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  Button,
  CollectionView,
  DetailFields,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Select,
  TextArea,
} from "@anvi/ui";
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { assignedTaskSchema } from "@anvi/contracts";
import { api, useAssignedTasks } from "../lib/api";
import { useWorkspace } from "./workspace";
import { usePreferences } from "../lib/preferences";
import { assignedTasksCopy as text } from "../lib/copy/onboarding";
import "./assigned-tasks.css";

type AssignedTask = z.infer<typeof assignedTaskSchema>;
const statusNames = text.statuses;

export default function AssignedTasks() {
  const { me } = useWorkspace();
  return me.permissions.includes("onboarding.task.update") ? (
    <TaskDocket csrf={me.csrfToken} />
  ) : (
    <ErrorState message={text.denied} />
  );
}

function TaskDocket({ csrf }: { csrf: string }) {
  const query = useAssignedTasks();
  const { reduceMotion } = usePreferences();
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<AssignedTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = useMemo(
    () =>
      query.data?.items.filter(
        (task) =>
          filter === "all" ||
          (filter === "open"
            ? task.state !== "completed"
            : task.state === filter),
      ),
    [filter, query.data],
  );
  const all = query.data?.items ?? [];
  const dueText = (dueOn: string) =>
    new Date(`${dueOn}T00:00:00`).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  const statusBadge = (task: AssignedTask) => (
    <StatusBadge
      color={
        task.state === "completed"
          ? "success"
          : task.state === "blocked"
            ? "error"
            : "gray"
      }
      size="sm"
      type="pill-color"
    >
      {statusNames[task.state]}
    </StatusBadge>
  );
  const updateButton = (task: AssignedTask) => (
    <Button
      variant="secondary"
      onPress={() => {
        setError("");
        setSelected(task);
      }}
      aria-label={text.updateLabel(task.label)}
    >
      {text.updateWork}
    </Button>
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api(
        `/onboarding/tasks/${selected.id}`,
        z.object({ changed: z.boolean() }),
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
          body: JSON.stringify({
            taskVersion: selected.version,
            state: fields.state,
            reason: fields.reason,
          }),
        },
      );
      setSelected(null);
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.updateFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-enter task-workspace">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.heading}
        description={text.intro}
        actions={
          <div className="task-seal" aria-hidden="true">
            <ClipboardText size={30} weight="duotone" />
            <span>
              {text.sealMy}
              <br />
              {text.sealWork}
            </span>
          </div>
        }
      ></PageHeader>
      <div className="task-stats">
        <StatCard
          label={text.stats.open}
          value={all.filter((t) => t.state !== "completed").length}
          hint={text.stats.openHint}
          icon={ListChecks}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.blocked}
          value={all.filter((t) => t.state === "blocked").length}
          hint={text.stats.blockedHint}
          icon={Prohibit}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.completed}
          value={all.filter((t) => t.state === "completed").length}
          hint={text.stats.completedHint}
          icon={CheckCircle}
          animate={!reduceMotion}
        />
      </div>
      <section className="task-docket" aria-label={text.docketLabel}>
        <div className="task-docket-toolbar">
          <div>
            <span className="docket-kicker">{text.kicker}</span>
            <strong>{text.assigned(query.data?.items.length ?? "—")}</strong>
          </div>
          <Select
            aria-label={text.filterLabel}
            selectedKey={filter}
            onSelectionChange={(key) => setFilter(String(key))}
            className="kit-filter"
          >
            <Select.Item id="open" label={text.filters.open} />
            <Select.Item id="all" label={text.filters.all} />
            <Select.Item id="completed" label={text.filters.completed} />
            <Select.Item id="blocked" label={text.filters.blocked} />
          </Select>
        </div>
        {query.error ? (
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : !query.data ? (
          <LoadingState />
        ) : !items?.length ? (
          <EmptyBlock
            icon={CheckCircle}
            title={text.emptyTitle}
            description={text.emptyBody}
          />
        ) : (
          <CollectionView
            id="assigned-tasks"
            label={text.docketLabel}
            noun="tasks"
            items={items}
            getKey={(task) => task.id}
            urlState
            columns={[
              {
                id: "task",
                label: "Task",
                isRowHeader: true,
                sortValue: (task) => task.label.toLowerCase(),
                render: (task) => task.label,
              },
              {
                id: "candidate",
                label: "Candidate",
                sortValue: (task) => task.candidateName.toLowerCase(),
                render: (task) =>
                  `${task.candidateName} · ${task.candidateTitle}`,
              },
              {
                id: "due",
                label: "Due",
                sortValue: (task) => task.dueOn,
                render: (task) => dueText(task.dueOn),
              },
              {
                id: "state",
                label: "Status",
                sortValue: (task) => task.state,
                render: (task) => statusBadge(task),
              },
              {
                id: "action",
                label: "",
                render: (task) => updateButton(task),
              },
            ]}
            renderCard={(task) => (
              <article className={`docket-card docket-${task.state}`}>
                <div className="docket-entry-head">
                  {statusBadge(task)}
                  <span>
                    {task.required ? text.required : text.optional} ·{" "}
                    {task.owner}
                  </span>
                </div>
                <h2>{task.label}</h2>
                <p className="docket-person">
                  {text.forCandidate} <strong>{task.candidateName}</strong> ·{" "}
                  {task.candidateTitle}
                </p>
                <p className="docket-person">Due {dueText(task.dueOn)}</p>
                {task.waitingOn && (
                  <p className="docket-warning">{text.waiting}</p>
                )}
                {task.note && (
                  <p className="docket-note">{text.latestNote(task.note)}</p>
                )}
                {updateButton(task)}
              </article>
            )}
            detail={{
              title: (task) => task.label,
              subtitle: (task) => statusNames[task.state],
              body: (task) => (
                <DetailFields
                  fields={[
                    { label: "Candidate", value: task.candidateName },
                    { label: "Role", value: task.candidateTitle },
                    { label: "Owner", value: task.owner },
                    { label: "Due", value: dueText(task.dueOn) },
                    {
                      label: "Required",
                      value: task.required ? text.required : text.optional,
                    },
                    {
                      label: "Waiting on",
                      value: task.waitingOn ? text.waiting : undefined,
                    },
                    { label: "Latest note", value: task.note },
                  ]}
                />
              ),
            }}
          />
        )}
      </section>
      <DialogPanel
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
        title={text.dialogTitle}
      >
        {selected && (
          <form className="intake-form" onSubmit={(event) => void save(event)}>
            <p>
              <strong>{selected.label}</strong>
              <br />
              {text.forCandidate} {selected.candidateName}
            </p>
            <Select
              label={text.newStatus}
              name="state"
              autoFocus
              defaultSelectedKey={
                selected.state === "completed"
                  ? "pending"
                  : selected.waitingOn
                    ? "blocked"
                    : "completed"
              }
              disabledKeys={Object.keys(statusNames).filter(
                (key) =>
                  key === selected.state ||
                  (key === "completed" && Boolean(selected.waitingOn)),
              )}
            >
              {Object.entries(statusNames).map(([key, label]) => (
                <Select.Item key={key} id={key} label={label} />
              ))}
            </Select>
            <TextArea
              label={text.noteLabel}
              name="reason"
              isRequired
              hideRequiredIndicator
              minLength={10}
              maxLength={300}
            />
            <p>{text.noteHelp}</p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="intake-actions">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => setSelected(null)}
              >
                {text.cancel}
              </Button>
              <Button type="submit" isDisabled={busy}>
                {busy ? text.saving : text.save}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}
