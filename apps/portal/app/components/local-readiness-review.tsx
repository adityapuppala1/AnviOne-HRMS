import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button, DialogPanel, StatusBadge } from "@anvi/ui";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { UserCircleCheck } from "@phosphor-icons/react/dist/csr/UserCircleCheck";
import type { candidateDetailSchema } from "@anvi/contracts";
import { api } from "../lib/api";

type Detail = z.infer<typeof candidateDetailSchema>;
type Review = Detail["localReviews"][number];
type Dialog = "propose" | "approve" | "reject" | "withdraw" | null;

const stateNames: Record<Review["state"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));

export function LocalReadinessReview({
  value,
  actorId,
  csrf,
  onSaved,
}: {
  value: Detail;
  actorId: string;
  csrf: string;
  onSaved: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const required = value.tasks.filter((task) => task.required);
  const eligible =
    value.candidate.state === "approved" &&
    required.length > 0 &&
    required.every((task) => task.state === "completed");
  const pending = value.localReviews.find(
    (review) => review.state === "pending",
  );
  const history = value.localReviews.filter(
    (review) => review.state !== "pending",
  );
  const isMaker = pending?.proposedBy === actorId;

  function open(next: Exclude<Dialog, null>) {
    setError("");
    setDialog(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const reason = String(
      new FormData(event.currentTarget).get("reason") ?? "",
    );
    setBusy(true);
    setError("");
    try {
      const deciding = dialog !== "propose";
      await api(
        deciding
          ? `/candidates/${value.candidate.id}/local-reviews/${pending?.id}`
          : `/candidates/${value.candidate.id}/local-reviews`,
        z.object({ changed: z.boolean() }),
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
          body: JSON.stringify(
            deciding
              ? {
                  caseVersion: value.candidate.version,
                  reviewVersion: pending?.version,
                  decision:
                    dialog === "withdraw"
                      ? "withdrawn"
                      : dialog === "approve"
                        ? "approved"
                        : "rejected",
                  reason,
                }
              : { caseVersion: value.candidate.version, reason },
          ),
        },
      );
      setDialog(null);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The review changed. Reload and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const dialogCopy = {
    propose: {
      title: "Hand over for independent review",
      label: "Handoff note",
      action: "Request independent review",
      help: "Summarize the fictional evidence another HR reviewer should verify.",
    },
    approve: {
      title: "Approve local readiness",
      label: "Decision note",
      action: "Approve readiness",
      help: "Record why the preview evidence supports this local decision.",
    },
    reject: {
      title: "Reject local readiness",
      label: "Decision note",
      action: "Reject readiness",
      help: "Record what needs attention before a new request is made.",
    },
    withdraw: {
      title: "Withdraw review request",
      label: "Withdrawal note",
      action: "Withdraw request",
      help: "Explain why this handoff is being withdrawn. The record remains visible.",
    },
  } as const;
  const copy = dialog ? dialogCopy[dialog] : null;

  return (
    <section className="local-review" aria-labelledby="local-review-title">
      <div className="local-review-heading">
        <div>
          <p className="eyebrow">Two people, one accountable handoff</p>
          <h3 id="local-review-title">Independent readiness review</h3>
        </div>
        <StatusBadge
          color={pending ? "warning" : eligible ? "success" : "gray"}
          size="sm"
          type="pill-color"
        >
          {pending ? "Decision pending" : eligible ? "Ready" : "Gated"}
        </StatusBadge>
      </div>

      <div className="local-review-baton">
        <article
          className={pending ? "baton-stage baton-stage-active" : "baton-stage"}
        >
          <span className="baton-marker" aria-hidden="true">
            <UserCircleCheck size={22} weight="duotone" />
          </span>
          <div>
            <span className="baton-kicker">01 · Maker</span>
            <h4>{pending ? pending.proposerLabel : "Prepare the evidence"}</h4>
            <p>
              {pending
                ? `Handed over ${formatDate(pending.proposedAt)}`
                : eligible
                  ? "Ready to hand over"
                  : "Approve the form and complete every required checklist task first."}
            </p>
          </div>
        </article>
        <span className="baton-link" aria-hidden="true">
          <ArrowRight size={20} />
        </span>
        <article
          className={
            pending ? "baton-stage baton-stage-waiting" : "baton-stage"
          }
        >
          <span className="baton-marker" aria-hidden="true">
            {pending ? (
              <Clock size={21} />
            ) : (
              <ShieldCheck size={22} weight="duotone" />
            )}
          </span>
          <div>
            <span className="baton-kicker">02 · Checker</span>
            <h4>
              {pending ? "Independent decision" : "A different HR identity"}
            </h4>
            <p>
              {pending
                ? isMaker
                  ? "Waiting for another HR reviewer. You cannot decide your own request."
                  : "Review the same evidence and record an independent decision."
                : "The checker can approve or reject, but cannot be the person who requested review."}
            </p>
          </div>
        </article>
      </div>

      {pending && (
        <blockquote className="local-review-note">
          “{pending.proposalNote}”
        </blockquote>
      )}

      <div className="local-review-actions">
        {!pending && eligible && (
          <Button onPress={() => open("propose")}>
            Request independent review
          </Button>
        )}
        {pending && isMaker && (
          <Button variant="secondary" onPress={() => open("withdraw")}>
            Withdraw request
          </Button>
        )}
        {pending && !isMaker && (
          <>
            <Button variant="secondary" onPress={() => open("reject")}>
              Reject readiness
            </Button>
            <Button onPress={() => open("approve")}>Approve readiness</Button>
          </>
        )}
        <small>
          Local sign-off records evidence only. It never creates an employee,
          account or access.
        </small>
      </div>

      {history.length > 0 && (
        <details className="local-review-history" open>
          <summary>Immutable decision history · {history.length}</summary>
          {history.map((review) => (
            <article key={review.id}>
              <CheckCircle size={18} weight="duotone" aria-hidden="true" />
              <div>
                <strong>{stateNames[review.state]}</strong>
                <span>
                  {review.state === "withdrawn"
                    ? `Withdrawn by ${review.deciderLabel}`
                    : `Decided by ${review.deciderLabel}`}{" "}
                  · {formatDate(review.decidedAt ?? review.proposedAt)}
                </span>
                <p>{review.decisionNote ?? review.proposalNote}</p>
              </div>
            </article>
          ))}
        </details>
      )}

      <DialogPanel
        open={Boolean(copy)}
        onOpenChange={(openState) => {
          if (!openState && !busy) setDialog(null);
        }}
        title={copy?.title ?? "Independent review"}
      >
        {copy && (
          <form
            className="intake-form"
            onSubmit={(event) => void submit(event)}
          >
            <p>{copy.help}</p>
            <label>
              {copy.label}
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={300}
                autoFocus
              />
            </label>
            <p>
              Use fictional evidence only. Do not include private documents or
              credentials.
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
                onPress={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" isDisabled={busy}>
                {busy ? "Saving…" : copy.action}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </section>
  );
}
