import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileImage } from "@phosphor-icons/react/dist/csr/FileImage";
import { FilePdf } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FolderLock } from "@phosphor-icons/react/dist/csr/FolderLock";
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple";
import {
  Avatar,
  Badge,
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@anvi/ui";
import type { DocumentCategory, EmployeeDocument } from "@anvi/contracts";
import { api, ApiError, useDocumentReview, useDocuments } from "../lib/api";
import { useWorkspace } from "./workspace";
// Shared card, form and list styles come from the leave screen.
import "./leave.css";
import "./documents.css";

const MAX_BYTES = 5 * 1024 * 1024;
const categories: Record<DocumentCategory, string> = {
  identity: "Identity",
  education: "Education",
  employment: "Previous employment",
  other: "Other",
};
const statusLabels: Record<EmployeeDocument["status"], string> = {
  pending: "Awaiting HR",
  verified: "Verified",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

type Send = (path: string, body: unknown) => Promise<unknown>;

export default function Documents() {
  const { me } = useWorkspace();
  const canOwn = me.permissions.includes("document.self");
  const canReview = me.permissions.includes("document.review");
  const mine = useDocuments(canOwn);
  const review = useDocumentReview(canReview);
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
  if (!canOwn && !canReview)
    return (
      <ErrorState message="Documents are available in employee, manager and HR workspaces. Switch role to continue." />
    );
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["documents"] }),
      client.invalidateQueries({ queryKey: ["approvals"] }),
    ]);
  const send: Send = (path, body) =>
    api(path, z.unknown(), {
      method: "POST",
      headers: { "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify(body),
    });
  return (
    <div className="page-enter documents-page">
      <header className="leave-hero">
        <div>
          <h1>Your papers, kept private.</h1>
          <p>
            {canOwn
              ? "Upload the documents HR asks for. Only you and HR can open them; your manager cannot."
              : "Verify the documents people upload. Only the owner and HR can open them."}
          </p>
        </div>
        {canOwn && (
          <Button onPress={() => setUploading(true)}>
            <UploadSimple size={18} weight="bold" />
            Upload a document
          </Button>
        )}
      </header>
      {canOwn && canReview ? (
        <Tabs className="leave-tabs">
          <TabList aria-label="Document views" className="tabs-list">
            <Tab id="mine" className="tab">
              Your documents
            </Tab>
            <Tab id="review" className="tab">
              Review
            </Tab>
          </TabList>
          <TabPanel id="mine" className="tab-panel">
            <Mine query={mine} send={send} refresh={refresh} />
          </TabPanel>
          <TabPanel id="review" className="tab-panel">
            <Review query={review} send={send} refresh={refresh} />
          </TabPanel>
        </Tabs>
      ) : canOwn ? (
        <Mine query={mine} send={send} refresh={refresh} />
      ) : (
        <Review query={review} send={send} refresh={refresh} />
      )}
      {canOwn && (
        <UploadDialog
          open={uploading}
          onClose={() => setUploading(false)}
          csrf={me.csrfToken}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function DocumentRow({
  document: d,
  actions,
  showOwner = false,
}: {
  document: EmployeeDocument;
  actions?: ReactNode;
  showOwner?: boolean;
}) {
  const tone =
    d.status === "verified"
      ? "green"
      : d.status === "pending"
        ? "amber"
        : "neutral";
  return (
    <li className={`document-row document-${d.status}`}>
      <span className="document-icon" aria-hidden="true">
        {d.contentType === "application/pdf" ? (
          <FilePdf size={26} weight="duotone" />
        ) : (
          <FileImage size={26} weight="duotone" />
        )}
      </span>
      <div className="document-body">
        <div className="leave-item-head">
          <strong>{showOwner ? d.employeeName : d.title}</strong>
          <Badge tone={tone}>{statusLabels[d.status]}</Badge>
        </div>
        <p>
          {showOwner ? `${d.title}, ` : ""}
          {categories[d.category]}. {d.fileName}, {size(d.sizeBytes)}. Uploaded{" "}
          {when(d.uploadedAt)}.
        </p>
        {d.reviewNote && (
          <p className="leave-decision">
            {statusLabels[d.status]} by {d.reviewedBy}: {d.reviewNote}
          </p>
        )}
      </div>
      <div className="document-actions">
        {d.status !== "withdrawn" && (
          <a
            className="button button-secondary"
            href={`/api/v1/documents/${d.id}/content`}
            download
            aria-label={`Download ${d.title}`}
          >
            <DownloadSimple size={17} />
            Download
          </a>
        )}
        {actions}
      </div>
    </li>
  );
}

function Mine({
  query,
  send,
  refresh,
}: {
  query: ReturnType<typeof useDocuments>;
  send: Send;
  refresh: () => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  async function withdraw(d: EmployeeDocument) {
    setError("");
    try {
      await send(`/documents/${d.id}/withdraw`, { version: d.version });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not withdraw.");
    }
  }
  return (
    <section className="panel documents-list" aria-labelledby="your-documents">
      <div className="panel-heading">
        <div>
          <h2 id="your-documents">Your documents</h2>
          <p>Newest first. Withdraw a file while HR has not reviewed it.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="inline-error documents-error">
          {error}
        </p>
      )}
      {query.data.items.length === 0 ? (
        <div className="leave-empty">
          <FolderLock size={34} weight="duotone" />
          <h3>No documents yet</h3>
          <p>Upload a PDF, PNG or JPEG of up to 5 MB.</p>
        </div>
      ) : (
        <ul className="documents">
          {query.data.items.map((d) => (
            <DocumentRow
              key={d.id}
              document={d}
              actions={
                d.canWithdraw && (
                  <Button
                    variant="secondary"
                    onPress={() => void withdraw(d)}
                    aria-label={`Withdraw ${d.title}`}
                  >
                    Withdraw
                  </Button>
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Review({
  query,
  send,
  refresh,
}: {
  query: ReturnType<typeof useDocumentReview>;
  send: Send;
  refresh: () => Promise<unknown>;
}) {
  const [rejecting, setRejecting] = useState<EmployeeDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  async function decide(
    d: EmployeeDocument,
    decision: "verify" | "reject",
    note: string | null,
  ) {
    setBusy(d.id);
    setError("");
    try {
      await send(`/documents/${d.id}/decision`, {
        version: d.version,
        decision,
        note,
      });
      setRejecting(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }
  const { pending, recent } = query.data;
  return (
    <div className="leave-approvals">
      {error && !rejecting && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section className="panel documents-list" aria-labelledby="to-verify">
        <div className="panel-heading">
          <div>
            <h2 id="to-verify">Waiting for verification</h2>
            <p>Open the file, check it, then verify or reject with a note.</p>
          </div>
        </div>
        {pending.length === 0 ? (
          <div className="leave-empty">
            <FolderLock size={34} weight="duotone" />
            <h3>Nothing to verify</h3>
            <p>New uploads appear here and in Approvals.</p>
          </div>
        ) : (
          <ul className="documents">
            {pending.map((d) => (
              <DocumentRow
                key={d.id}
                document={d}
                showOwner
                actions={
                  d.canReview && (
                    <>
                      <Button
                        isDisabled={busy === d.id}
                        onPress={() => void decide(d, "verify", null)}
                        aria-label={`Verify ${d.title} for ${d.employeeName}`}
                      >
                        Verify
                      </Button>
                      <Button
                        variant="secondary"
                        isDisabled={busy === d.id}
                        onPress={() => {
                          setError("");
                          setRejecting(d);
                        }}
                        aria-label={`Reject ${d.title} for ${d.employeeName}`}
                      >
                        Reject
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>
      {recent.length > 0 && (
        <section className="panel documents-list" aria-labelledby="reviewed">
          <div className="panel-heading">
            <div>
              <h2 id="reviewed">Recently reviewed</h2>
              <p>The latest 20 decisions and withdrawals.</p>
            </div>
          </div>
          <ul className="documents">
            {recent.map((d) => (
              <li key={d.id} className="document-recent">
                <Avatar initials={d.initials} size="small" />
                <span>
                  <strong>{d.employeeName}</strong>, {d.title}
                </span>
                <Badge tone={d.status === "verified" ? "green" : "neutral"}>
                  {statusLabels[d.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      <DialogPanel
        open={Boolean(rejecting)}
        onOpenChange={(open) => {
          if (!open && !busy) setRejecting(null);
        }}
        title="Reject this document?"
      >
        {rejecting && (
          <form
            className="leave-form"
            onSubmit={(event) => {
              event.preventDefault();
              const note = String(
                new FormData(event.currentTarget).get("note") ?? "",
              );
              void decide(rejecting, "reject", note);
            }}
          >
            <p>
              {rejecting.employeeName} will see your note and can upload a
              replacement.
            </p>
            <label>
              What needs to change?
              <textarea
                name="note"
                required
                minLength={3}
                maxLength={300}
                autoFocus
              />
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="leave-actions">
              <Button
                variant="secondary"
                isDisabled={Boolean(busy)}
                onPress={() => setRejecting(null)}
              >
                Go back
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy ? "Saving…" : "Reject document"}
              </Button>
            </div>
          </form>
        )}
      </DialogPanel>
    </div>
  );
}

function UploadDialog({
  open,
  onClose,
  csrf,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  csrf: string;
  refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files can be up to 5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Multipart: the browser sets the boundary, so no Content-Type header here.
      const response = await fetch("/api/v1/documents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
        body: form,
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as {
          title?: string;
        } | null;
        throw new ApiError(
          problem?.title ?? "The upload did not complete. Try again.",
          response.status,
        );
      }
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Upload a document"
      className="leave-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <label>
          What is it?
          <select name="category" defaultValue="identity" autoFocus>
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            name="title"
            required
            minLength={2}
            maxLength={80}
            placeholder="For example, Passport"
          />
        </label>
        <label>
          File
          <input
            type="file"
            name="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          />
        </label>
        <p className="leave-hint">
          PDF, PNG or JPEG, up to 5 MB. Use synthetic files in this preview.
        </p>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="leave-actions">
          <Button variant="secondary" isDisabled={busy} onPress={close}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
