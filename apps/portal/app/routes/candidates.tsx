import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { Badge, Button, DialogPanel, ErrorState, LoadingState } from "@anvi/ui";
import {
  candidateListSchema,
  candidateOptionsSchema,
  candidateDetailSchema,
  candidateSchema,
  candidateCreateSchema,
  candidateDeliverySchema,
  type Candidate,
} from "@anvi/contracts";
import { api } from "../lib/api";
import { useWorkspace } from "./workspace";
import "./onboarding.css";
const labels: Record<Candidate["state"], string> = {
  draft: "Draft",
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Ready for review",
  changes_requested: "Changes requested",
  approved: "Form approved",
  cancelled: "Cancelled",
};
export default function Candidates() {
  const { me } = useWorkspace();
  return me.permissions.includes("onboarding.manage") ? (
    <Intake />
  ) : (
    <ErrorState message="Candidate intake requires an assigned HR admin workspace." />
  );
}
function Intake() {
  const { me } = useWorkspace(),
    client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false),
    [error, setError] = useState("");
  const q = params.get("q") ?? "",
    selected = params.get("case") ?? "";
  const list = useQuery({
    queryKey: ["candidates", q],
    queryFn: ({ signal }) =>
      api(`/candidates?q=${encodeURIComponent(q)}`, candidateListSchema, {
        signal,
      }),
  });
  const detail = useQuery({
    queryKey: ["candidate", selected],
    enabled: Boolean(selected),
    queryFn: ({ signal }) =>
      api(`/candidates/${selected}`, candidateDetailSchema, { signal }),
  });
  async function refresh(id?: string) {
    await client.invalidateQueries({ queryKey: ["candidates"] });
    await client.invalidateQueries({ queryKey: ["candidate"] });
    if (id) {
      const next = new URLSearchParams(params);
      next.set("case", id);
      setParams(next);
    }
  }
  return (
    <div className="page-enter intake-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">An introduction. A considered next step.</p>
          <h1>Make room for someone new.</h1>
          <p>
            Invite, review and guide your next colleague through their first
            form.
          </p>
        </div>
        <Button onPress={() => setCreating(true)}>
          <UserPlus size={19} />
          New intake
        </Button>
      </div>
      <div className="intake-notice">
        <ShieldCheck size={22} />
        <p>
          <strong>Synthetic onboarding preview</strong> · Only @anvi.example
          addresses. The local delivery tray previews messages; no email is
          sent. Form approval is followed by separate activation checks.
        </p>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="intake-layout">
        <section className="panel intake-ledger">
          <div className="panel-heading">
            <div>
              <h2>Candidate intake</h2>
              <p>Latest 50 records in your legal entity.</p>
            </div>
            <Badge>{list.data?.items.length ?? "…"} shown</Badge>
          </div>
          <label className="intake-search">
            <span className="sr-only">Search intake</span>
            <input
              placeholder="Find a name or nominated address…"
              maxLength={80}
              value={q}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set("q", e.target.value);
                setParams(next, { replace: true });
              }}
            />
          </label>
          {list.error ? (
            <ErrorState
              message={list.error.message}
              onRetry={() => void list.refetch()}
            />
          ) : !list.data ? (
            <LoadingState />
          ) : !list.data.items.length ? (
            <div className="state-card">
              <UserPlus size={32} />
              <h2>A thoughtful first welcome.</h2>
              <p>Create a synthetic intake to start the invitation journey.</p>
            </div>
          ) : (
            <div className="intake-rows">
              {list.data.items.map((c) => (
                <button
                  key={c.id}
                  className={`intake-row ${selected === c.id ? "selected" : ""}`}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("case", c.id);
                    setParams(next);
                  }}
                >
                  <span className="intake-initial">
                    {c.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.title}</small>
                    <span className="intake-row-state">{labels[c.state]}</span>
                  </span>
                  <ArrowUpRight size={18} />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="panel intake-detail">
          {!selected ? (
            <div className="state-card">
              <PaperPlaneTilt size={36} />
              <h2>Every welcome has a story.</h2>
              <p>
                Select an intake to see the form, review history and next
                action.
              </p>
            </div>
          ) : detail.error ? (
            <ErrorState
              message={detail.error.message}
              onRetry={() => void detail.refetch()}
            />
          ) : !detail.data ? (
            <LoadingState />
          ) : (
            <CaseReview
              key={selected}
              value={detail.data}
              onSaved={() => void refresh()}
              onError={setError}
            />
          )}
        </section>
      </div>
      {creating && (
        <CreateIntake
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            void refresh(c.id);
          }}
          csrf={me.csrfToken}
        />
      )}
    </div>
  );
}
function CreateIntake({
  onClose,
  onCreated,
  csrf,
}: {
  onClose: () => void;
  onCreated: (c: Candidate) => void;
  csrf: string;
}) {
  const options = useQuery({
    queryKey: ["candidate-options"],
    queryFn: ({ signal }) =>
      api("/candidates/options", candidateOptionsSchema, { signal }),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = candidateCreateSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        "Review all fields. Use a synthetic @anvi.example address and active assignments.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      onCreated(
        await api("/candidates", candidateSchema, {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create intake.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="New candidate intake"
      className="intake-create"
    >
      <form className="intake-form" onSubmit={(e) => void submit(e)}>
        <p>Prepare a synthetic welcome for your current legal entity.</p>
        <label>
          Full name
          <input name="name" required minLength={2} maxLength={120} />
        </label>
        <label>
          Nominated email
          <input
            name="email"
            type="email"
            required
            placeholder="new.colleague@anvi.example"
          />
        </label>
        <label>
          Proposed role
          <input name="title" required minLength={2} maxLength={80} />
        </label>
        <label>
          Proposed joining date
          <input name="joinedOn" type="date" required />
        </label>
        {options.error ? (
          <ErrorState message={options.error.message} />
        ) : !options.data ? (
          <LoadingState />
        ) : (
          <div className="intake-form-grid">
            {[
              {
                name: "departmentId",
                label: "Department",
                items: options.data.departments,
              },
              {
                name: "locationId",
                label: "Location",
                items: options.data.locations,
              },
              {
                name: "managerId",
                label: "Reporting manager",
                items: options.data.managers,
              },
            ].map((field) => (
              <label key={field.name}>
                {field.label}
                <select name={field.name} required defaultValue="">
                  <option value="" disabled>
                    Select…
                  </option>
                  {field.items.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="intake-actions">
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={busy || !options.data}>
            {busy ? "Creating…" : "Create intake"}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
type Detail = ReturnType<typeof candidateDetailSchema.parse>;
function CaseReview({
  value,
  onSaved,
  onError,
}: {
  value: Detail;
  onSaved: () => void;
  onError: (s: string) => void;
}) {
  const { me } = useWorkspace();
  const c = value.candidate;
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [delivery, setDelivery] = useState<ReturnType<
      typeof candidateDeliverySchema.parse
    > | null>(null),
    [deliveryOpen, setDeliveryOpen] = useState(false);
  async function action(
    kind: "invitation" | "revoke" | "review",
    decision?: string,
  ) {
    if (reason.trim().length < 10) {
      onError("Explain the action in at least 10 characters.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      await api(`/candidates/${c.id}/${kind}`, candidateSchema, {
        method: "POST",
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({
          version: c.version,
          reason,
          ...(decision ? { decision } : {}),
        }),
      });
      setReason("");
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update intake.");
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    try {
      setDelivery(
        await api(
          `/candidates/${c.id}/delivery-preview`,
          candidateDeliverySchema,
        ),
      );
      setDeliveryOpen(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Preview unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="intake-detail-header">
        <p className="eyebrow">A welcome in progress</p>
        <h2>{c.name}</h2>
        <p>{c.title}</p>
        <Badge>{labels[c.state]}</Badge>
      </div>
      <dl className="intake-facts">
        <div>
          <dt>Nominated address</dt>
          <dd>{c.email}</dd>
        </div>
        <div>
          <dt>Assignment</dt>
          <dd>
            {c.department} · {c.location}
          </dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>{c.manager}</dd>
        </div>
        <div>
          <dt>Joining date</dt>
          <dd>{c.joinedOn}</dd>
        </div>
      </dl>
      <div className="intake-submission">
        <h3>
          {["submitted", "approved"].includes(c.state)
            ? "Submitted form"
            : "Saved draft"}
        </h3>
        <p>
          <strong>Preferred name:</strong>{" "}
          {c.draft.preferredName || "Not supplied"}
        </p>
        <p className="intake-introduction">
          {c.draft.introduction ||
            "The candidate has not added an introduction yet."}
        </p>
        {c.reviewNote && (
          <p className="intake-feedback">Latest review: {c.reviewNote}</p>
        )}
      </div>
      {value.submissions.length > 0 && (
        <details className="intake-history">
          <summary>
            {value.submissions.length} immutable submission
            {value.submissions.length === 1 ? "" : "s"}
          </summary>
          {value.submissions.map((s) => (
            <article key={s.version}>
              <strong>Version {s.version}</strong>
              <p>{s.payload.preferredName}</p>
              <p className="intake-introduction">{s.payload.introduction}</p>
              <small>{new Date(s.submittedAt).toLocaleString("en-IN")}</small>
            </article>
          ))}
        </details>
      )}
      {c.state !== "cancelled" && (
        <div className="intake-review-actions">
          <label htmlFor="intake-reason">Action / review reason</label>
          <textarea
            id="intake-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Record the reason; avoid confidential details."
          />
          <div className="intake-actions">
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => void action("invitation")}
            >
              {c.invitationExpiresAt
                ? "Rotate invitation preview"
                : "Create invitation preview"}
            </Button>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => void preview()}
            >
              Open delivery tray
            </Button>
          </div>
          {c.state === "submitted" && (
            <div className="intake-actions">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => void action("review", "changes_requested")}
              >
                Request changes
              </Button>
              <Button
                isDisabled={busy}
                onPress={() => void action("review", "approved")}
              >
                Approve form
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            isDisabled={busy}
            onPress={() => void action("revoke")}
          >
            Cancel intake and revoke access
          </Button>
          <small>
            Approval covers this form only. Employee activation and its
            remaining checks are separate.
          </small>
        </div>
      )}
      <DialogPanel
        open={deliveryOpen}
        onOpenChange={setDeliveryOpen}
        title="Local delivery tray"
      >
        <div className="intake-delivery">
          <Badge>Development preview · no email sent</Badge>
          <p>
            Only synthetic addresses are supported. These previews expire and
            are cleared after verification.
          </p>
          {delivery?.invitationUrl && (
            <p>
              <a
                className="text-link"
                href={delivery.invitationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open candidate invitation <ArrowUpRight size={16} />
              </a>
            </p>
          )}
          {delivery?.code && (
            <p className="intake-code">
              Verification code <strong>{delivery.code}</strong>
            </p>
          )}
          {!delivery?.code && !delivery?.invitationUrl && (
            <p>
              No active preview message. Request a verification code from the
              latest invitation, then refresh.
            </p>
          )}
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => void preview()}
          >
            Refresh delivery tray
          </Button>
        </div>
      </DialogPanel>
    </>
  );
}
