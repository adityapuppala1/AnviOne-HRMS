import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { candidatePortalSchema, type CandidateDraft } from "@anvi/contracts";
import "@fontsource-variable/outfit";
import "@fontsource-variable/public-sans";
import "@anvi/ui/theme.css";
import "./style.css";
type Portal = ReturnType<typeof candidatePortalSchema.parse>;
const invitation =
  new URLSearchParams(location.hash.slice(1)).get("invite") ?? "";
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);
async function request(
  path: string,
  body?: unknown,
  csrf?: string,
  method = "POST",
) {
  const response = await fetch(`/api/candidate/${path}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = (await response.json().catch(() => null)) as {
    title?: string;
  } | null;
  if (!response.ok)
    throw new Error(
      value?.title ??
        "The onboarding service is unavailable. Try again shortly.",
    );
  return value;
}
function Welcome() {
  const [phase, setPhase] = useState<"loading" | "entry" | "code" | "form">(
      invitation ? "entry" : "loading",
    ),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [portal, setPortal] = useState<Portal | null>(null);
  const [formPending, setFormPending] = useState(false);
  useEffect(() => {
    if (invitation) return;
    let active = true;
    void request("session")
      .then((data) => {
        if (active) {
          setPortal(candidatePortalSchema.parse(data));
          setPhase("form");
        }
      })
      .catch(() => {
        if (active) setPhase("entry");
      });
    return () => {
      active = false;
    };
  }, []);
  async function begin() {
    setError("");
    setBusy(true);
    try {
      const result = (await request("challenge", {
        token: invitation,
      })) as unknown as { challengeId: string };
      setChallenge(result.challengeId);
      setPhase("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request code.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await request("exchange", {
        token: invitation,
        challengeId: challenge,
        code,
      });
      setPortal(candidatePortalSchema.parse(await request("session")));
      setCode("");
      setPhase("form");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!portal) return;
    setBusy(true);
    try {
      await request("logout", {}, portal.csrfToken);
      setPortal(null);
      setPhase("entry");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="candidate-shell">
      <header className="candidate-top">
        <a className="candidate-logo" href="/">
          MyAnvi<span>.</span>
        </a>
        <span>Your first chapter</span>
        {portal && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void logout()}
          >
            Sign out
          </button>
        )}
      </header>
      <main className="candidate-main">
        <aside className="candidate-story">
          <p className="candidate-eyebrow">A place for your perspective</p>
          <h1>
            A little about you.
            <br />
            <span>A good beginning.</span>
          </h1>
          <p>
            Take a moment to introduce yourself. Your HR team will help with
            each next step.
          </p>
          <div className="candidate-rings" aria-hidden="true">
            <i />
            <i />
          </div>
          <ol className="candidate-progress">
            <li
              className={
                phase !== "entry" && phase !== "loading" ? "complete" : ""
              }
            >
              <span>01</span>Verify your invitation
            </li>
            <li className={phase === "form" ? "complete" : ""}>
              <span>02</span>Your introduction
            </li>
            <li
              className={
                portal?.candidate.state === "submitted" ||
                portal?.candidate.state === "approved"
                  ? "complete"
                  : ""
              }
            >
              <span>03</span>HR form review
            </li>
          </ol>
          <p className="candidate-preview">
            Synthetic preview · no real email delivery.
            <br />
            Use only fictional information.
          </p>
        </aside>
        <section className="candidate-panel" aria-label="Your onboarding">
          <div className="candidate-card">
            {error && (
              <p className="candidate-error" role="alert">
                {error}
              </p>
            )}
            {phase === "loading" ? (
              <p role="status">Opening your onboarding…</p>
            ) : phase === "form" && portal ? (
              <>
                <Introduction
                  portal={portal}
                  onSaved={setPortal}
                  onPendingChange={setFormPending}
                />
                <CandidateChecklist
                  portal={portal}
                  onSaved={setPortal}
                  formPending={formPending}
                />
              </>
            ) : phase === "code" ? (
              <>
                <p className="candidate-eyebrow">Step 01 · Verify</p>
                <h2>A quick check, then you’re in.</h2>
                <p>
                  Use the six-digit code from the local delivery tray. HR can
                  refresh that tray in the employee preview.
                </p>
                <form onSubmit={(e) => void verify(e)}>
                  <label htmlFor="candidate-code">Verification code</label>
                  <input
                    id="candidate-code"
                    className="candidate-otp"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                  />
                  <button
                    className="button button-primary"
                    disabled={busy || code.length !== 6}
                  >
                    {busy ? "Verifying…" : "Verify and continue"}
                  </button>
                </form>
                <p className="candidate-small">
                  Codes expire after 10 minutes. For an expired or replaced
                  link, contact HR for the latest invitation.
                </p>
              </>
            ) : (
              <>
                <p className="candidate-eyebrow">Welcome to MyAnvi</p>
                <h2>Your next chapter starts here.</h2>
                <p>
                  {invitation
                    ? "This invitation opens your own introduction form. Choose Continue to request a verification code."
                    : "Open the latest invitation from your HR team to begin. If your session expired, ask HR for a fresh invitation."}
                </p>
                {invitation && (
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void begin()}
                  >
                    {busy
                      ? "Preparing verification…"
                      : "Continue with invitation"}
                  </button>
                )}
                <div className="candidate-privacy">
                  <strong>Private by design</strong>
                  <p>
                    This workspace opens only your candidate form. Employee
                    sign-in starts after a separate approved activation.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <footer>
        MyAnvi · People, connected.
        <span>Need help? Contact the HR team who invited you.</span>
      </footer>
    </div>
  );
}
function CandidateChecklist({
  portal,
  onSaved,
  formPending,
}: {
  portal: Portal;
  onSaved: (p: Portal) => void;
  formPending: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    lastEdited = useRef<string | null>(null),
    taskButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!editing && lastEdited.current)
      taskButtons.current.get(lastEdited.current)?.focus();
  }, [editing]);
  if (!portal.tasks.length) return null;
  const required = portal.tasks.filter((t) => t.required),
    complete = required.filter((t) => t.state === "completed").length;
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const task = portal.tasks.find((t) => t.id === editing);
    if (!task || formPending) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const result = candidatePortalSchema.parse(
        await request(
          `tasks/${task.id}`,
          {
            caseVersion: portal.candidate.version,
            version: task.version,
            state: data.state,
            reason: data.reason,
          },
          portal.csrfToken,
        ),
      );
      if (mounted.current) {
        onSaved(result);
        setEditing(null);
      }
    } catch (err) {
      if (mounted.current)
        setError(
          err instanceof Error
            ? err.message
            : "Unable to save task. Reload to review the current status.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="candidate-checklist" aria-label="Your checklist">
      <p className="candidate-eyebrow">A welcome, shared</p>
      <h2>Your part of the welcome.</h2>
      <p>
        {complete} of {required.length} required tasks complete. These tasks are
        separate from your introduction form.
      </p>
      <progress
        aria-label="Your required checklist completion"
        value={complete}
        max={Math.max(required.length, 1)}
      />
      <p className="candidate-small">
        Use fictional notes only. Task completion does not activate employment
        or verify identity.
      </p>
      {formPending && (
        <p className="candidate-small" role="status">
          Finish saving your introduction before updating a task.
        </p>
      )}
      {error && (
        <p className="candidate-error" role="alert">
          {error} Reload to review the latest status.
        </p>
      )}
      <ul>
        {portal.tasks.map((task) => (
          <li
            key={task.id}
            className={`candidate-task candidate-task-${task.state}`}
          >
            <div className="candidate-task-heading">
              <span aria-hidden="true">
                {task.state === "completed" ? "✓" : "○"}
              </span>
              <h3>{task.label}</h3>
            </div>
            <p className="candidate-small">
              {task.required ? "Required" : "Optional"} · Due {task.dueOn} ·{" "}
              {task.state === "completed"
                ? "Completed"
                : task.state === "blocked"
                  ? "Blocked"
                  : "To do"}
              {task.overdue ? " · Overdue" : ""}
            </p>
            {task.waitingOn && (
              <p className="candidate-task-waiting">
                Waiting for a prerequisite. Your HR team can help.
              </p>
            )}
            {task.note && (
              <details>
                <summary>Latest task note</summary>
                <p>{task.note}</p>
              </details>
            )}
            {editing === task.id ? (
              <form onSubmit={(e) => void update(e)}>
                <label htmlFor={`task-state-${task.id}`}>New task status</label>
                <select
                  id={`task-state-${task.id}`}
                  name="state"
                  autoFocus
                  defaultValue={
                    task.state === "completed"
                      ? "pending"
                      : task.waitingOn
                        ? "blocked"
                        : "completed"
                  }
                >
                  {[
                    ["pending", "To do"],
                    ["blocked", "Blocked"],
                    ["completed", "Completed"],
                  ].map(([value, label]) => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        value === task.state ||
                        (value === "completed" && task.waitingOn)
                      }
                    >
                      {label}
                    </option>
                  ))}
                </select>
                <label htmlFor={`task-note-${task.id}`}>
                  Completion / change note
                </label>
                <textarea
                  id={`task-note-${task.id}`}
                  name="reason"
                  required
                  minLength={10}
                  maxLength={300}
                  rows={3}
                />
                <div className="candidate-task-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel task update
                  </button>
                  <button
                    className="button button-primary"
                    disabled={busy || formPending}
                  >
                    {busy ? "Saving task…" : "Save task status"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="button button-secondary"
                disabled={busy || formPending}
                onClick={() => {
                  setError("");
                  lastEdited.current = task.id;
                  setEditing(task.id);
                }}
                aria-label={`Update ${task.label}`}
                ref={(node) => {
                  if (node) taskButtons.current.set(task.id, node);
                  else taskButtons.current.delete(task.id);
                }}
              >
                Update task
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
function Introduction({
  portal,
  onSaved,
  onPendingChange,
}: {
  portal: Portal;
  onSaved: (value: Portal) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const c = portal.candidate;
  const [draft, setDraft] = useState<CandidateDraft>(c.draft),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("All changes saved"),
    [submitting, setSubmitting] = useState(false);
  const current = useRef(portal),
    dirty =
      JSON.stringify(draft) !== JSON.stringify(current.current.candidate.draft);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const editable = ["invited", "in_progress", "changes_requested"].includes(
    c.state,
  );
  useEffect(() => {
    onPendingChange(dirty || saving || submitting || Boolean(error));
  }, [dirty, saving, submitting, error, onPendingChange]);
  useEffect(() => {
    current.current = portal;
  }, [portal]);
  useEffect(() => {
    if (!dirty || !editable || saving || error) return;
    const timer = setTimeout(() => {
      setSaving(true);
      setError("");
      setSaved("Saving…");
      void request(
        "draft",
        { version: current.current.candidate.version, draft },
        current.current.csrfToken,
        "PUT",
      )
        .then((data) => {
          if (mounted.current) {
            const result = candidatePortalSchema.parse(data);
            current.current = result;
            onSaved(result);
            setSaved("All changes saved");
          }
        })
        .catch((err) => {
          if (mounted.current) {
            setError(err instanceof Error ? err.message : "Could not save.");
            setSaved("Changes need attention");
          }
        })
        .finally(() => {
          if (mounted.current) setSaving(false);
        });
    }, 800);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, dirty, editable, onSaved, saving, error]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty || saving) return;
    setSubmitting(true);
    setError("");
    try {
      const result = candidatePortalSchema.parse(
        await request(
          "submit",
          { version: current.current.candidate.version },
          current.current.csrfToken,
        ),
      );
      current.current = result;
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }
  if (!editable)
    return (
      <div className="candidate-finish">
        <span className="candidate-finish-mark" aria-hidden="true">
          ✓
        </span>
        <p className="candidate-eyebrow">Your introduction</p>
        <h2>
          {c.state === "approved"
            ? "Your form is approved."
            : "Thank you. Over to HR."}
        </h2>
        <p>
          {c.state === "approved"
            ? "HR has reviewed this form. Employment activation and its required checks are separate; your team will guide you."
            : "Your submitted introduction is saved. HR will review it and let you know if anything needs updating."}
        </p>
        <div className="candidate-receipt">
          <strong>{draft.preferredName}</strong>
          <p>{draft.introduction}</p>
        </div>
        {c.reviewNote && (
          <p className="candidate-review-note">HR note: {c.reviewNote}</p>
        )}
        <button
          className="button button-secondary"
          onClick={() => location.reload()}
        >
          Check review status
        </button>
      </div>
    );
  return (
    <>
      <p className="candidate-eyebrow">Step 02 · Your introduction</p>
      <h2>Good to meet you, {c.name.split(" ")[0]}.</h2>
      <p>
        Proposed role: {c.title} · Joining {c.joinedOn}
      </p>
      {c.reviewNote && (
        <div className="candidate-review-note">
          <strong>HR requested an update</strong>
          <p>{c.reviewNote}</p>
        </div>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor="preferred-name">What should we call you?</label>
        <input
          id="preferred-name"
          value={draft.preferredName}
          maxLength={120}
          minLength={2}
          required
          onChange={(e) =>
            setDraft({ ...draft, preferredName: e.target.value })
          }
          disabled={submitting}
        />
        <label htmlFor="candidate-introduction">
          A professional introduction
        </label>
        <textarea
          id="candidate-introduction"
          rows={6}
          minLength={20}
          maxLength={2000}
          required
          value={draft.introduction}
          onChange={(e) => setDraft({ ...draft, introduction: e.target.value })}
          disabled={submitting}
        />
        <small>
          At least 20 characters. Avoid private contact, bank, tax or health
          information.
        </small>
        <label className="candidate-check">
          <input
            type="checkbox"
            checked={draft.acknowledged}
            required
            onChange={(e) =>
              setDraft({ ...draft, acknowledged: e.target.checked })
            }
            disabled={submitting}
          />
          <span>
            I understand this is a synthetic preview and will provide fictional
            information only.
          </span>
        </label>
        <p role="status" className="candidate-save">
          {dirty && !saving ? "Changes will save automatically…" : saved}
        </p>
        {error && (
          <p role="alert" className="candidate-error">
            {error} Reload to review the current saved version.
          </p>
        )}
        <button
          className="button button-primary"
          disabled={saving || dirty || submitting || !draft.acknowledged}
        >
          {submitting ? "Submitting…" : "Submit introduction"}
        </button>
      </form>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Welcome />
  </React.StrictMode>,
);
