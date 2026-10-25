import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Badge, Button, DialogPanel } from "@anvi/ui";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import {
  candidateTaskCreateSchema,
  submissionChanges,
  type CandidateTask,
  type candidateDetailSchema,
} from "@anvi/contracts";
import { api } from "../lib/api";
type Detail = z.infer<typeof candidateDetailSchema>;
const ownerNames = {
  candidate: "Candidate",
  hr: "HR",
  manager: "Manager",
  it: "IT",
  administration: "Administration",
};
const statusNames = {
  pending: "To do",
  blocked: "Blocked",
  completed: "Completed",
};
export function ActivationReadiness({ value }: { value: Detail }) {
  const passed = value.readiness.controls.filter(
    (control) => control.status === "passed",
  ).length;
  return (
    <section
      className="activation-readiness"
      aria-labelledby="activation-readiness-title"
    >
      <div className="readiness-heading">
        <div>
          <p className="eyebrow">Evidence before access</p>
          <h3 id="activation-readiness-title">Activation readiness</h3>
        </div>
        <Badge>{passed}/6 controls</Badge>
      </div>
      <div className="readiness-summary" role="status">
        <strong>Activation remains blocked</strong>
        <span>
          This dossier is derived by the server. Preview completion never
          creates employment, a code or account access.
        </span>
      </div>
      <ol className="readiness-rail">
        {value.readiness.controls.map((control) => (
          <li
            key={control.id}
            className={`readiness-control readiness-${control.status}`}
            data-source={control.source}
          >
            <span className="readiness-marker" aria-hidden="true">
              {control.status === "passed" ? (
                <CheckCircle weight="fill" size={20} />
              ) : (
                <Clock weight="bold" size={18} />
              )}
            </span>
            <div>
              <div className="readiness-control-title">
                <h4>{control.label}</h4>
                <span>
                  {control.source === "external"
                    ? "External gate"
                    : "Preview evidence"}
                </span>
              </div>
              <p>{control.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function OnboardingChecklist({
  value,
  csrf,
  onSaved,
}: {
  value: Detail;
  csrf: string;
  onSaved: () => void;
}) {
  const [owner, setOwner] = useState("all"),
    [status, setStatus] = useState("all"),
    [dialog, setDialog] = useState<"starter" | "create" | CandidateTask | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { tasks, candidate: c } = value,
    required = tasks.filter((t) => t.required),
    complete = required.filter((t) => t.state === "completed").length;
  const filtered = tasks.filter(
    (t) =>
      (owner === "all" || t.owner === owner) &&
      (status === "all" || t.state === status),
  );
  const editable = c.state !== "cancelled";
  function open(next: typeof dialog) {
    setError("");
    setDialog(next);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog) return;
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    let path = `/candidates/${c.id}/`,
      body: unknown;
    if (dialog === "starter") {
      path += "checklist";
      body = { version: c.version, reason: fields.reason };
    } else if (dialog === "create") {
      path += "tasks";
      const parsed = candidateTaskCreateSchema.safeParse({
        ...fields,
        caseVersion: c.version,
        required: fields.required === "on",
        dueOffsetDays: Number(fields.dueOffsetDays),
        dependsOn: fields.dependsOn || null,
      });
      if (!parsed.success) {
        setError("Review the task title, owner, due offset and prerequisite.");
        return;
      }
      body = parsed.data;
    } else {
      path += `tasks/${dialog.id}`;
      body = {
        caseVersion: c.version,
        version: dialog.version,
        state: fields.state,
        reason: fields.reason,
      };
    }
    setBusy(true);
    setError("");
    try {
      await api(path, z.object({ changed: z.boolean() }), {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      setDialog(null);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update checklist.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="onboarding-checklist" aria-label="Onboarding checklist">
      <div className="checklist-heading">
        <div>
          <p className="eyebrow">A welcome, shared</p>
          <h3>Onboarding checklist</h3>
        </div>
        <Badge>
          {complete}/{required.length} required
        </Badge>
      </div>
      {tasks.length > 0 && (
        <>
          <progress
            className="checklist-progress"
            aria-label="Required checklist completion"
            max={Math.max(required.length, 1)}
            value={complete}
          />
          <p className="checklist-context">
            {required.length === 0
              ? "No required tasks have been configured."
              : complete === required.length
                ? "Required checklist tasks are complete."
                : `${required.length - complete} required task${required.length - complete === 1 ? "" : "s"} still need attention.`}{" "}
            Form approval and employment activation are separate.
          </p>
        </>
      )}
      <p className="checklist-context">
        HR coordinates internal owners in this preview. Use fictional notes
        only; completion does not verify identity or grant employee access.
      </p>
      {editable && (
        <div className="intake-actions">
          {!tasks.length && (
            <Button variant="secondary" onPress={() => open("starter")}>
              Use starter checklist
            </Button>
          )}
          <Button
            variant="secondary"
            onPress={() => open("create")}
            isDisabled={tasks.length >= 30}
          >
            <Plus size={15} />
            Add task
          </Button>
        </div>
      )}
      {tasks.length > 0 ? (
        <>
          <div className="checklist-filters">
            <label>
              Task owner
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="all">All owners</option>
                {Object.entries(ownerNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Task status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                {Object.entries(statusNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="checklist-items">
            {filtered.map((t) => (
              <li key={t.id} className={`checklist-item checklist-${t.state}`}>
                <span className="checklist-mark" aria-hidden="true">
                  {t.state === "completed" ? (
                    <CheckCircle size={22} weight="fill" />
                  ) : (
                    <Clock size={22} />
                  )}
                </span>
                <div className="checklist-item-content">
                  <div className="checklist-item-top">
                    <h4>{t.label}</h4>
                    <span className="checklist-owner" data-owner={t.owner}>
                      {ownerNames[t.owner]}
                    </span>
                  </div>
                  <p className="checklist-meta">
                    {t.required ? "Required" : "Optional"} · Due {t.dueOn} ·{" "}
                    {statusNames[t.state]}
                    {t.overdue ? " · Overdue" : ""}
                  </p>
                  {t.waitingOn && (
                    <p className="checklist-waiting">
                      Waiting for:{" "}
                      {tasks.find((d) => d.id === t.dependsOn)?.label ??
                        "prerequisite"}
                    </p>
                  )}
                  {t.note && (
                    <details className="checklist-note">
                      <summary>Latest note</summary>
                      <p>{t.note}</p>
                      <small>
                        {new Date(t.updatedAt).toLocaleString("en-IN")}
                      </small>
                    </details>
                  )}
                  {editable && (
                    <Button
                      variant="ghost"
                      onPress={() => open(t)}
                      aria-label={`Update ${t.label}`}
                    >
                      Update task
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!filtered.length && (
            <p className="checklist-context" role="status">
              No tasks match these filters.
            </p>
          )}
        </>
      ) : (
        <div className="checklist-empty">
          <CheckCircle size={30} />
          <p>
            No checklist yet. Start with five fictional coordination tasks or
            add your own.
          </p>
        </div>
      )}
      {dialog && (
        <DialogPanel
          open
          onOpenChange={(next) => {
            if (!next && !busy) setDialog(null);
          }}
          title={
            dialog === "starter"
              ? "Start a welcome checklist"
              : dialog === "create"
                ? "Add onboarding task"
                : "Update checklist task"
          }
        >
          <form className="intake-form" onSubmit={(e) => void save(e)}>
            {dialog === "starter" ? (
              <>
                <p>
                  Starter v1 adds five fictional tasks across candidate, HR, IT,
                  administration and manager coordination. Required tasks cannot
                  be waived; task metadata is fixed after creation.
                </p>
                <label>
                  Checklist reason
                  <textarea
                    name="reason"
                    required
                    minLength={10}
                    maxLength={300}
                  />
                </label>
              </>
            ) : dialog === "create" ? (
              <>
                <p>
                  Task details are fixed after creation. Due dates are relative
                  to the proposed joining date; negative days are before
                  joining.
                </p>
                <label>
                  Task title
                  <input name="label" minLength={5} maxLength={140} required />
                </label>
                <div className="intake-form-grid">
                  <label>
                    Coordinating owner
                    <select name="owner" defaultValue="hr">
                      {Object.entries(ownerNames).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Days from joining
                    <input
                      type="number"
                      name="dueOffsetDays"
                      min={-30}
                      max={90}
                      defaultValue={0}
                      required
                    />
                  </label>
                  <label>
                    Prerequisite
                    <select name="dependsOn" defaultValue="">
                      <option value="">No prerequisite</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="checklist-required">
                  <input type="checkbox" name="required" defaultChecked />
                  Required task
                </label>
              </>
            ) : (
              <>
                <p>
                  <strong>{dialog.label}</strong>
                </p>
                <p>
                  {dialog.waitingOn
                    ? "Complete its prerequisite before marking this task complete."
                    : "Record what was completed or why this task needs attention."}{" "}
                  Reopen completed dependents before their prerequisite.
                </p>
                <label>
                  New task status
                  <select
                    name="state"
                    defaultValue={
                      dialog.state === "completed"
                        ? "pending"
                        : dialog.waitingOn
                          ? "blocked"
                          : "completed"
                    }
                  >
                    {Object.entries(statusNames).map(([key, label]) => (
                      <option
                        key={key}
                        value={key}
                        disabled={
                          key === dialog.state ||
                          (key === "completed" && dialog.waitingOn)
                        }
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Completion / change note
                  <textarea
                    name="reason"
                    required
                    minLength={10}
                    maxLength={300}
                  />
                </label>
                <p>
                  Fictional evidence only. Do not add private data, passwords or
                  document links.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="intake-actions">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" isDisabled={busy}>
                {busy
                  ? "Saving…"
                  : dialog === "starter"
                    ? "Start checklist"
                    : dialog === "create"
                      ? "Create task"
                      : "Save task status"}
              </Button>
            </div>
          </form>
        </DialogPanel>
      )}
    </section>
  );
}
export function SubmissionComparison({ value }: { value: Detail }) {
  if (value.submissions.length < 2) return null;
  const latest = value.submissions[0]!,
    previous = value.submissions[1]!,
    changes = submissionChanges(previous.payload, latest.payload);
  const display = (v: string | boolean) =>
    typeof v === "boolean"
      ? v
        ? "Acknowledged"
        : "Not acknowledged"
      : v || "Not supplied";
  return (
    <section className="submission-comparison" aria-label="Submission changes">
      <p className="eyebrow">Review with context</p>
      <h3>Changes since previous submission</h3>
      <p className="checklist-context">
        Version {previous.version} → {latest.version} · {changes.length} changed
        field{changes.length === 1 ? "" : "s"}
      </p>
      {changes.length ? (
        <div className="submission-diff">
          {changes.map((change) => (
            <article key={change.field}>
              <h4>{change.label}</h4>
              <div className="submission-diff-columns">
                <div>
                  <span>Before</span>
                  <p>{display(change.before)}</p>
                </div>
                <div>
                  <span>After</span>
                  <p>{display(change.after)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="checklist-context">
          No form fields changed between these submissions.
        </p>
      )}
    </section>
  );
}
