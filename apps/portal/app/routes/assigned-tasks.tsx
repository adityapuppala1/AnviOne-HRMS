import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { Badge, Button, DialogPanel, ErrorState, LoadingState } from "@anvi/ui";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { assignedTaskSchema } from "@anvi/contracts";
import { api, useAssignedTasks } from "../lib/api";
import { useWorkspace } from "./workspace";
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
      <header className="task-hero">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.heading}</h1>
          <p>{text.intro}</p>
        </div>
        <div className="task-seal" aria-hidden="true">
          <ClipboardText size={30} weight="duotone" />
          <span>
            {text.sealMy}
            <br />
            {text.sealWork}
          </span>
        </div>
      </header>
      <section className="task-docket" aria-label={text.docketLabel}>
        <div className="task-docket-toolbar">
          <div>
            <span className="docket-kicker">{text.kicker}</span>
            <strong>{text.assigned(query.data?.items.length ?? "—")}</strong>
          </div>
          <label>
            <span className="sr-only">{text.filterLabel}</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="open">{text.filters.open}</option>
              <option value="all">{text.filters.all}</option>
              <option value="completed">{text.filters.completed}</option>
              <option value="blocked">{text.filters.blocked}</option>
            </select>
          </label>
        </div>
        {query.error ? (
          <ErrorState
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : !query.data ? (
          <LoadingState />
        ) : !items?.length ? (
          <div className="task-empty">
            <CheckCircle size={34} weight="duotone" />
            <h2>{text.emptyTitle}</h2>
            <p>{text.emptyBody}</p>
          </div>
        ) : (
          <ol className="docket-list">
            {items.map((task, index) => (
              <li
                key={task.id}
                className={`docket-entry docket-${task.state}`}
                style={{ "--entry-index": index } as React.CSSProperties}
              >
                <div className="docket-date">
                  <span>
                    {new Date(`${task.dueOn}T00:00:00`).toLocaleDateString(
                      "en-IN",
                      { day: "2-digit" },
                    )}
                  </span>
                  <small>
                    {new Date(`${task.dueOn}T00:00:00`)
                      .toLocaleDateString("en-IN", { month: "short" })
                      .toUpperCase()}
                  </small>
                </div>
                <span className="docket-node" aria-hidden="true">
                  {task.state === "completed" ? (
                    <CheckCircle weight="fill" />
                  ) : (
                    <Clock />
                  )}
                </span>
                <article>
                  <div className="docket-entry-head">
                    <Badge>{statusNames[task.state]}</Badge>
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
                  {task.waitingOn && (
                    <p className="docket-warning">{text.waiting}</p>
                  )}
                  {task.note && (
                    <p className="docket-note">{text.latestNote(task.note)}</p>
                  )}
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
                </article>
              </li>
            ))}
          </ol>
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
            <label>
              {text.newStatus}
              <select
                name="state"
                autoFocus
                defaultValue={
                  selected.state === "completed"
                    ? "pending"
                    : selected.waitingOn
                      ? "blocked"
                      : "completed"
                }
              >
                {Object.entries(statusNames).map(([key, label]) => (
                  <option
                    key={key}
                    value={key}
                    disabled={
                      key === selected.state ||
                      (key === "completed" && Boolean(selected.waitingOn))
                    }
                  >
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {text.noteLabel}
              <textarea name="reason" required minLength={10} maxLength={300} />
            </label>
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
