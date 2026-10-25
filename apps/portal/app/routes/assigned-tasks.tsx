import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { Badge, Button, DialogPanel, ErrorState, LoadingState } from "@anvi/ui";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { assignedTaskSchema } from "@anvi/contracts";
import { api, useAssignedTasks } from "../lib/api";
import { useWorkspace } from "./workspace";
import "./assigned-tasks.css";

type AssignedTask = z.infer<typeof assignedTaskSchema>;
const statusNames = {
  pending: "To do",
  blocked: "Blocked",
  completed: "Completed",
};

export default function AssignedTasks() {
  const { me } = useWorkspace();
  return me.permissions.includes("onboarding.task.update") ? (
    <TaskDocket csrf={me.csrfToken} />
  ) : (
    <ErrorState message="Assigned onboarding work requires an employee or manager workspace." />
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
      setError(
        cause instanceof Error ? cause.message : "Could not update this task.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-enter task-workspace">
      <header className="task-hero">
        <div>
          <p className="eyebrow">Assigned onboarding</p>
          <h1>Work in your name.</h1>
          <p>
            A private docket of the onboarding steps assigned to you—nothing
            more.
          </p>
        </div>
        <div className="task-seal" aria-hidden="true">
          <ClipboardText size={30} weight="duotone" />
          <span>
            MY
            <br />
            WORK
          </span>
        </div>
      </header>
      <section className="task-docket" aria-label="My onboarding tasks">
        <div className="task-docket-toolbar">
          <div>
            <span className="docket-kicker">LIVE DOCKET</span>
            <strong>{query.data?.items.length ?? "—"} assigned</strong>
          </div>
          <label>
            <span className="sr-only">Filter assigned tasks</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="open">Needs attention</option>
              <option value="all">All tasks</option>
              <option value="completed">Completed</option>
              <option value="blocked">Blocked</option>
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
            <h2>Your docket is clear.</h2>
            <p>No assigned tasks match this view.</p>
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
                      {task.required ? "Required" : "Optional"} · {task.owner}
                    </span>
                  </div>
                  <h2>{task.label}</h2>
                  <p className="docket-person">
                    For <strong>{task.candidateName}</strong> ·{" "}
                    {task.candidateTitle}
                  </p>
                  {task.waitingOn && (
                    <p className="docket-warning">
                      Waiting for a prerequisite to be completed.
                    </p>
                  )}
                  {task.note && (
                    <p className="docket-note">Latest note: {task.note}</p>
                  )}
                  <Button
                    variant="secondary"
                    onPress={() => {
                      setError("");
                      setSelected(task);
                    }}
                    aria-label={`Update ${task.label}`}
                  >
                    Update work
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
        title="Update assigned task"
      >
        {selected && (
          <form className="intake-form" onSubmit={(event) => void save(event)}>
            <p>
              <strong>{selected.label}</strong>
              <br />
              For {selected.candidateName}
            </p>
            <label>
              New task status
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
              Completion / change note
              <textarea name="reason" required minLength={10} maxLength={300} />
            </label>
            <p>
              Use fictional operational notes only. Candidate contact details
              are intentionally unavailable here.
            </p>
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
                Cancel
              </Button>
              <Button type="submit" isDisabled={busy}>
                {busy ? "Saving…" : "Save task status"}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}
