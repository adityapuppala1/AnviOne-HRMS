import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import {
  Button,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Input,
  Select,
  TextArea,
} from "@anvi/ui";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
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
import { usePreferences } from "../lib/preferences";
import "./onboarding.css";
import {
  ActivationReadiness,
  OnboardingChecklist,
  SubmissionComparison,
} from "../components/onboarding-checklist";
import { LocalReadinessReview } from "../components/local-readiness-review";
import { candidatesCopy as text } from "../lib/copy/onboarding";
const labels: Record<Candidate["state"], string> = text.states;
const stateColor = (state: Candidate["state"]) =>
  state === "approved"
    ? "success"
    : state === "submitted"
      ? "brand"
      : state === "changes_requested"
        ? "warning"
        : state === "cancelled"
          ? "error"
          : "gray";
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
  const { reduceMotion } = usePreferences();
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
  const count = (state: Candidate["state"]) =>
    list.data?.items.filter((c) => c.state === state).length ?? 0;
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
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.heading}
        description={text.intro}
        actions={
          <Button onPress={() => setCreating(true)}>
            <UserPlus size={19} />
            {text.newIntake}
          </Button>
        }
      ></PageHeader>
      <div className="intake-stats">
        <StatCard
          label={text.stats.total}
          value={list.data?.items.length ?? 0}
          hint={text.stats.totalHint}
          icon={Users}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.review}
          value={count("submitted")}
          hint={text.stats.reviewHint}
          icon={ClipboardText}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.changes}
          value={count("changes_requested")}
          hint={text.stats.changesHint}
          icon={WarningCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.approved}
          value={count("approved")}
          hint={text.stats.approvedHint}
          icon={CheckCircle}
          animate={!reduceMotion}
        />
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
            <StatusBadge color="gray" size="sm" type="pill-color">
              {text.shown(list.data?.items.length ?? "…")}
            </StatusBadge>
          </div>
          <Input
            aria-label={text.searchLabel}
            placeholder={text.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={q}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              next.set("q", value);
              setParams(next, { replace: true });
            }}
            className="intake-search"
          />
          {list.error ? (
            <ErrorState
              message={list.error.message}
              onRetry={() => void list.refetch()}
            />
          ) : !list.data ? (
            <LoadingState />
          ) : !list.data.items.length ? (
            <EmptyBlock
              icon={UserPlus}
              title={text.emptyTitle}
              description={text.emptyBody}
            />
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
        <Input
          label={text.create.fullName}
          name="name"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={120}
        />
        <Input
          label={text.create.email}
          name="email"
          type="email"
          isRequired
          hideRequiredIndicator
          placeholder={text.create.emailPlaceholder}
        />
        <Input
          label={text.create.role}
          name="title"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={80}
        />
        <Input
          label={text.create.joiningDate}
          name="joinedOn"
          type="date"
          isRequired
          hideRequiredIndicator
        />
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
              <Select
                key={field.name}
                label={field.label}
                name={field.name}
                isRequired
                placeholder={text.create.select}
              >
                {field.items.map((o) => (
                  <Select.Item key={o.id} id={o.id} label={o.name} />
                ))}
              </Select>
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
        <StatusBadge color={stateColor(c.state)} size="sm" type="pill-color">
          {labels[c.state]}
        </StatusBadge>
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
          <TextArea
            label={text.review.reasonLabel}
            rows={3}
            maxLength={300}
            value={reason}
            onChange={setReason}
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
          <StatusBadge color="warning" size="sm" type="pill-color">
            {text.delivery.badge}
          </StatusBadge>
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
