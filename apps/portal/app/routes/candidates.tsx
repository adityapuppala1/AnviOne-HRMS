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
import {
  ActivationReadiness,
  OnboardingChecklist,
  SubmissionComparison,
} from "../components/onboarding-checklist";
import { LocalReadinessReview } from "../components/local-readiness-review";
import { candidatesCopy as text } from "../lib/copy/onboarding";
const labels: Record<Candidate["state"], string> = text.states;
export default function Candidates() {
  const { me } = useWorkspace();
  return me.permissions.includes("onboarding.manage") ? (
    <Intake />
  ) : (
    <ErrorState message={text.denied} />
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
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.heading}</h1>
          <p>{text.intro}</p>
        </div>
        <Button onPress={() => setCreating(true)}>
          <UserPlus size={19} />
          {text.newIntake}
        </Button>
      </div>
      <div className="intake-notice">
        <ShieldCheck size={22} />
        <p>
          <strong>{text.noticeTitle}</strong>
          {text.noticeBody}
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
              <h2>{text.ledgerTitle}</h2>
              <p>{text.ledgerSubtitle}</p>
            </div>
            <Badge>{text.shown(list.data?.items.length ?? "…")}</Badge>
          </div>
          <label className="intake-search">
            <span className="sr-only">{text.searchLabel}</span>
            <input
              placeholder={text.searchPlaceholder}
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
              <h2>{text.emptyTitle}</h2>
              <p>{text.emptyBody}</p>
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
              <h2>{text.noSelectionTitle}</h2>
              <p>{text.noSelectionBody}</p>
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
      setError(text.create.reviewFields);
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
      setError(err instanceof Error ? err.message : text.create.failed);
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
      title={text.create.title}
      className="intake-create"
    >
      <form className="intake-form" onSubmit={(e) => void submit(e)}>
        <p>{text.create.intro}</p>
        <label>
          {text.create.fullName}
          <input name="name" required minLength={2} maxLength={120} />
        </label>
        <label>
          {text.create.email}
          <input
            name="email"
            type="email"
            required
            placeholder={text.create.emailPlaceholder}
          />
        </label>
        <label>
          {text.create.role}
          <input name="title" required minLength={2} maxLength={80} />
        </label>
        <label>
          {text.create.joiningDate}
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
                label: text.create.department,
                items: options.data.departments,
              },
              {
                name: "locationId",
                label: text.create.location,
                items: options.data.locations,
              },
              {
                name: "managerId",
                label: text.create.manager,
                items: options.data.managers,
              },
            ].map((field) => (
              <label key={field.name}>
                {field.label}
                <select name={field.name} required defaultValue="">
                  <option value="" disabled>
                    {text.create.select}
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
            {text.create.cancel}
          </Button>
          <Button type="submit" isDisabled={busy || !options.data}>
            {busy ? text.create.creating : text.create.submit}
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
      onError(text.review.reasonTooShort);
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
      onError(err instanceof Error ? err.message : text.review.updateFailed);
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
      onError(
        err instanceof Error ? err.message : text.review.previewUnavailable,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="intake-detail-header">
        <p className="eyebrow">{text.review.eyebrow}</p>
        <h2>{c.name}</h2>
        <p>{c.title}</p>
        <Badge>{labels[c.state]}</Badge>
      </div>
      <dl className="intake-facts">
        <div>
          <dt>{text.review.nominatedAddress}</dt>
          <dd>{c.email}</dd>
        </div>
        <div>
          <dt>{text.review.assignment}</dt>
          <dd>
            {c.department} · {c.location}
          </dd>
        </div>
        <div>
          <dt>{text.review.manager}</dt>
          <dd>{c.manager}</dd>
        </div>
        <div>
          <dt>{text.review.joiningDate}</dt>
          <dd>{c.joinedOn}</dd>
        </div>
      </dl>
      <div className="intake-submission">
        <h3>
          {["submitted", "approved"].includes(c.state)
            ? text.review.submittedForm
            : text.review.savedDraft}
        </h3>
        <p>
          <strong>{text.review.preferredName}</strong>{" "}
          {c.draft.preferredName || text.review.notSupplied}
        </p>
        <p className="intake-introduction">
          {c.draft.introduction || text.review.noIntroduction}
        </p>
        {c.reviewNote && (
          <p className="intake-feedback">
            {text.review.latestReview(c.reviewNote)}
          </p>
        )}
      </div>
      <SubmissionComparison value={value} />
      <ActivationReadiness value={value} />
      <LocalReadinessReview
        value={value}
        actorId={me.actorId}
        csrf={me.csrfToken}
        onSaved={onSaved}
      />
      <OnboardingChecklist
        value={value}
        csrf={me.csrfToken}
        onSaved={onSaved}
      />
      {value.submissions.length > 0 && (
        <details className="intake-history">
          <summary>{text.review.submissions(value.submissions.length)}</summary>
          {value.submissions.map((s) => (
            <article key={s.version}>
              <strong>{text.review.version(s.version)}</strong>
              <p>{s.payload.preferredName}</p>
              <p className="intake-introduction">{s.payload.introduction}</p>
              <small>{new Date(s.submittedAt).toLocaleString("en-IN")}</small>
            </article>
          ))}
        </details>
      )}
      {c.state !== "cancelled" && (
        <div className="intake-review-actions">
          <label htmlFor="intake-reason">{text.review.reasonLabel}</label>
          <textarea
            id="intake-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={text.review.reasonPlaceholder}
          />
          <div className="intake-actions">
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => void action("invitation")}
            >
              {c.invitationExpiresAt
                ? text.review.rotateInvitation
                : text.review.createInvitation}
            </Button>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => void preview()}
            >
              {text.review.openTray}
            </Button>
          </div>
          {c.state === "submitted" && (
            <div className="intake-actions">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => void action("review", "changes_requested")}
              >
                {text.review.requestChanges}
              </Button>
              <Button
                isDisabled={busy}
                onPress={() => void action("review", "approved")}
              >
                {text.review.approve}
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            isDisabled={busy}
            onPress={() => void action("revoke")}
          >
            {text.review.cancelIntake}
          </Button>
          <small>{text.review.approvalNote}</small>
        </div>
      )}
      <DialogPanel
        open={deliveryOpen}
        onOpenChange={setDeliveryOpen}
        title={text.delivery.title}
      >
        <div className="intake-delivery">
          <Badge>{text.delivery.badge}</Badge>
          <p>{text.delivery.note}</p>
          {delivery?.invitationUrl && (
            <p>
              <a
                className="text-link"
                href={delivery.invitationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {text.delivery.openInvitation} <ArrowUpRight size={16} />
              </a>
            </p>
          )}
          {delivery?.code && (
            <p className="intake-code">
              {text.delivery.verificationCode} <strong>{delivery.code}</strong>
            </p>
          )}
          {!delivery?.code && !delivery?.invitationUrl && (
            <p>{text.delivery.none}</p>
          )}
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => void preview()}
          >
            {text.delivery.refresh}
          </Button>
        </div>
      </DialogPanel>
    </>
  );
}
