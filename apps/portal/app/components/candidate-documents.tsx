import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button, DialogPanel, StatusBadge, TextArea } from "@anvi/ui";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { Lock } from "@phosphor-icons/react/dist/csr/Lock";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import {
  type candidateDetailSchema,
  type CandidateDocument,
  type CandidateDocumentCategory,
  MANDATORY_CANDIDATE_DOCUMENT_CATEGORIES,
} from "@anvi/contracts";
import { api } from "../lib/api";
import { candidateDocumentsCopy as text } from "../lib/copy/onboarding";

type Detail = z.infer<typeof candidateDetailSchema>;

const CATEGORIES: {
  category: CandidateDocumentCategory;
  label: string;
  description: string;
  required: boolean;
}[] = [
  {
    category: "government_id",
    label: text.categories.government_id.label,
    description: text.categories.government_id.description,
    required: text.categories.government_id.required,
  },
  {
    category: "proof_of_address",
    label: text.categories.proof_of_address.label,
    description: text.categories.proof_of_address.description,
    required: text.categories.proof_of_address.required,
  },
  {
    category: "education_certificate",
    label: text.categories.education_certificate.label,
    description: text.categories.education_certificate.description,
    required: text.categories.education_certificate.required,
  },
  {
    category: "previous_employment",
    label: text.categories.previous_employment.label,
    description: text.categories.previous_employment.description,
    required: text.categories.previous_employment.required,
  },
];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const formatDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(value))
    : "";

export function CandidateDocumentReview({
  value,
  csrf,
  onSaved,
}: {
  value: Detail;
  csrf: string;
  onSaved: () => void;
}) {
  const [reviewingDoc, setReviewingDoc] = useState<{
    doc: CandidateDocument;
    catLabel: string;
  } | null>(null);

  const mandatoryVerified = MANDATORY_CANDIDATE_DOCUMENT_CATEGORIES.filter(
    (cat) =>
      value.documents.some(
        (d) => d.category === cat && d.status === "verified",
      ),
  ).length;

  return (
    <section
      className="candidate-docs-section"
      aria-labelledby="candidate-docs-title"
    >
      <div className="candidate-docs-heading">
        <div>
          <p className="eyebrow">Evidence before access</p>
          <h3 id="candidate-docs-title">{text.sectionTitle}</h3>
        </div>
        <StatusBadge
          color={mandatoryVerified === 3 ? "success" : "brand"}
          size="sm"
          type="pill-color"
        >
          {mandatoryVerified}/3 mandatory verified
        </StatusBadge>
      </div>
      <p className="candidate-docs-subtitle">{text.sectionSubtitle}</p>

      <div className="candidate-docs-list">
        {CATEGORIES.map((cat) => {
          const doc = value.documents.find((d) => d.category === cat.category);
          const status = doc?.status ?? "missing";

          const badgeColor =
            status === "verified"
              ? "success"
              : status === "pending"
                ? "brand"
                : status === "rejected"
                  ? "error"
                  : "gray";

          const badgeLabel =
            status === "verified"
              ? text.badgeStatus.verified
              : status === "pending"
                ? text.badgeStatus.pending
                : status === "rejected"
                  ? text.badgeStatus.rejected
                  : text.badgeStatus.missing;

          return (
            <article
              key={cat.category}
              className={`candidate-doc-item candidate-doc-${status}`}
            >
              <div className="candidate-doc-top">
                <div className="candidate-doc-title-group">
                  <span className="candidate-doc-icon" aria-hidden="true">
                    {status === "verified" ? (
                      <CheckCircle
                        weight="fill"
                        size={20}
                        className="icon-success"
                      />
                    ) : status === "rejected" ? (
                      <WarningCircle
                        weight="fill"
                        size={20}
                        className="icon-error"
                      />
                    ) : status === "pending" ? (
                      <Clock weight="bold" size={18} className="icon-brand" />
                    ) : (
                      <FileText
                        weight="regular"
                        size={18}
                        className="icon-muted"
                      />
                    )}
                  </span>
                  <div>
                    <h4>{cat.label}</h4>
                    <span className="candidate-doc-tag">
                      {cat.required ? "Required" : "Optional"}
                    </span>
                  </div>
                </div>
                <StatusBadge color={badgeColor} size="sm" type="pill-color">
                  {badgeLabel}
                </StatusBadge>
              </div>

              <p className="candidate-doc-desc">{cat.description}</p>

              {doc ? (
                <div className="candidate-doc-body">
                  <div className="candidate-doc-file-info">
                    <span className="candidate-doc-filename">
                      {doc.fileName}
                    </span>
                    <span className="candidate-doc-filesize">
                      ({formatSize(doc.sizeBytes)})
                    </span>
                    <span className="candidate-doc-version">
                      v{doc.version}
                    </span>
                    <a
                      href={`/api/v1/candidates/${value.candidate.id}/documents/${doc.id}/content`}
                      download={doc.fileName}
                      className="candidate-doc-download-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <DownloadSimple size={14} />
                      {text.download}
                    </a>
                  </div>

                  <p className="candidate-doc-date">
                    Uploaded {formatDate(doc.createdAt)}
                  </p>

                  {doc.status === "verified" && (
                    <div className="candidate-doc-verified-note">
                      <Lock size={14} />
                      <span>{text.verifiedHint}</span>
                      {doc.reviewedAt && (
                        <small> · Verified {formatDate(doc.reviewedAt)}</small>
                      )}
                    </div>
                  )}

                  {doc.status === "rejected" && doc.reviewNote && (
                    <div className="candidate-doc-rejection-note" role="alert">
                      <strong>Rejection note:</strong> {doc.reviewNote}
                    </div>
                  )}

                  {doc.status === "pending" && (
                    <div className="candidate-doc-actions">
                      <Button
                        variant="secondary"
                        onPress={() =>
                          setReviewingDoc({ doc, catLabel: cat.label })
                        }
                      >
                        {text.reviewButton}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="candidate-doc-empty">
                  <span>Candidate has not uploaded this document yet.</span>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {reviewingDoc && (
        <ReviewDialog
          candidateId={value.candidate.id}
          candidateName={value.candidate.name}
          item={reviewingDoc}
          csrf={csrf}
          onClose={() => setReviewingDoc(null)}
          onSaved={() => {
            setReviewingDoc(null);
            onSaved();
          }}
        />
      )}
    </section>
  );
}

function ReviewDialog({
  candidateId,
  candidateName,
  item,
  csrf,
  onClose,
  onSaved,
}: {
  candidateId: string;
  candidateName: string;
  item: { doc: CandidateDocument; catLabel: string };
  csrf: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { doc, catLabel } = item;
  const [decision, setDecision] = useState<"verified" | "rejected">("verified");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reasonTrimmed = reason.trim();
  const isValid =
    decision === "verified" ||
    (decision === "rejected" && reasonTrimmed.length >= 10);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isValid) {
      if (decision === "rejected" && reasonTrimmed.length < 10) {
        setError(text.errorMinReason);
      }
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api(
        `/candidates/${candidateId}/documents/${doc.id}/review`,
        z.object({ changed: z.boolean() }).or(z.any()),
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
          body: JSON.stringify({
            decision,
            version: doc.version,
            ...(reasonTrimmed ? { reason: reasonTrimmed } : {}),
          }),
        },
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : text.reviewFailed);
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
      title={text.dialog.title}
      className="candidate-doc-review-dialog"
    >
      <form onSubmit={(e) => void submit(e)} className="doc-review-form">
        <p className="doc-review-intro">{text.dialog.intro}</p>

        <div className="doc-review-meta">
          <div>
            <strong>Candidate:</strong> {candidateName}
          </div>
          <div>
            <strong>Category:</strong> {catLabel}
          </div>
          <div>
            <strong>File:</strong> {doc.fileName} ({formatSize(doc.sizeBytes)})
          </div>
          <div>
            <a
              href={`/api/v1/candidates/${candidateId}/documents/${doc.id}/content`}
              download={doc.fileName}
              target="_blank"
              rel="noreferrer"
              className="candidate-doc-download-link"
            >
              <DownloadSimple size={14} />
              Open / Download original file
            </a>
          </div>
        </div>

        <div className="doc-review-decision-group">
          <label className="doc-review-decision-label">
            {text.dialog.decisionLabel}
          </label>
          <div className="doc-review-radios">
            <label
              className={`decision-radio-card ${decision === "verified" ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="decision"
                value="verified"
                checked={decision === "verified"}
                onChange={() => setDecision("verified")}
                disabled={busy}
              />
              <div>
                <strong>{text.dialog.verifyOption}</strong>
                <span>Document matches requirements and is verified.</span>
              </div>
            </label>
            <label
              className={`decision-radio-card ${decision === "rejected" ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="decision"
                value="rejected"
                checked={decision === "rejected"}
                onChange={() => setDecision("rejected")}
                disabled={busy}
              />
              <div>
                <strong>{text.dialog.rejectOption}</strong>
                <span>
                  Document is unreadable, expired, or incorrect. Candidate will
                  be asked to re-upload.
                </span>
              </div>
            </label>
          </div>
        </div>

        <TextArea
          label={text.dialog.reasonLabel}
          value={reason}
          onChange={setReason}
          rows={3}
          maxLength={300}
          isRequired={decision === "rejected"}
          placeholder="Record notes on document review..."
        />
        <p className="doc-review-hint">
          {decision === "rejected"
            ? text.dialog.reasonRequiredHelp
            : text.dialog.reasonOptionalHelp}
        </p>

        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}

        <div className="intake-actions">
          <Button variant="secondary" onPress={onClose} isDisabled={busy}>
            {text.dialog.cancel}
          </Button>
          <Button type="submit" isDisabled={busy || !isValid}>
            {busy ? text.dialog.saving : text.dialog.confirm}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
