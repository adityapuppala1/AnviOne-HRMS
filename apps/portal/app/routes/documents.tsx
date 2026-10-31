import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FileImage } from "@phosphor-icons/react/dist/csr/FileImage";
import { FilePdf } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FolderLock } from "@phosphor-icons/react/dist/csr/FolderLock";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { XCircle } from "@phosphor-icons/react/dist/csr/XCircle";
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple";
import {
  Avatar,
  Button,
  CollectionView,
  DetailFields,
  type CollectionDetail,
  type Column,
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
  UTabs,
} from "@anvi/ui";
import type { DocumentCategory, EmployeeDocument } from "@anvi/contracts";
import { api, ApiError, useDocumentReview, useDocuments } from "../lib/api";
import { useWorkspace } from "./workspace";
import { usePreferences } from "../lib/preferences";
import { documentsCopy as text } from "../lib/copy/documents";
// Shared card, form and list styles come from the leave screen.
import "./leave.css";
import "./documents.css";

const MAX_BYTES = 5 * 1024 * 1024;
const categories: Record<DocumentCategory, string> = text.categories;
const statusLabels: Record<EmployeeDocument["status"], string> = text.status;
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
  if (!canOwn && !canReview) return <ErrorState message={text.denied} />;
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
      <PageHeader
        title={text.title}
        description={canOwn ? text.subtitleOwner : text.subtitleReviewer}
        actions={
          canOwn && (
            <Button onPress={() => setUploading(true)}>
              <UploadSimple size={18} weight="bold" />
              {text.uploadButton}
            </Button>
          )
        }
      />
      {canOwn && canReview ? (
        <UTabs className="leave-tabs" keyboardActivation="automatic">
          <UTabs.List type="underline" aria-label={text.tabs.label}>
            <UTabs.Item id="mine">{text.tabs.mine}</UTabs.Item>
            <UTabs.Item id="review">{text.tabs.review}</UTabs.Item>
          </UTabs.List>
          <UTabs.Panel id="mine" className="tab-panel">
            <Mine query={mine} send={send} refresh={refresh} />
          </UTabs.Panel>
          <UTabs.Panel id="review" className="tab-panel">
            <Review query={review} send={send} refresh={refresh} />
          </UTabs.Panel>
        </UTabs>
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

const statusColor = (status: EmployeeDocument["status"]) =>
  status === "verified"
    ? "success"
    : status === "pending"
      ? "warning"
      : status === "rejected"
        ? "error"
        : "gray";
const fullDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
function documentColumns(
  showOwner: boolean,
  actions: (d: EmployeeDocument) => ReactNode,
): Column<EmployeeDocument>[] {
  return [
    {
      id: "title",
      label: showOwner ? "Employee and document" : "Document",
      isRowHeader: true,
      sortValue: (d) => (showOwner ? d.employeeName : d.title),
      render: (d) => (
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm text-primary">
            {showOwner ? d.employeeName : d.title}
          </strong>
          {showOwner && (
            <span className="text-sm text-tertiary">{d.title}</span>
          )}
        </span>
      ),
    },
    {
      id: "category",
      label: "Category",
      sortValue: (d) => categories[d.category],
      render: (d) => <span className="text-sm">{categories[d.category]}</span>,
    },
    {
      id: "status",
      label: "Status",
      sortValue: (d) => d.status,
      render: (d) => (
        <StatusBadge color={statusColor(d.status)} size="sm" type="pill-color">
          {statusLabels[d.status]}
        </StatusBadge>
      ),
    },
    {
      id: "uploaded",
      label: "Uploaded",
      sortValue: (d) => d.uploadedAt,
      render: (d) => <span className="text-sm">{when(d.uploadedAt)}</span>,
    },
    {
      id: "actions",
      label: "",
      render: (d) => (
        <span className="flex flex-wrap gap-2">
          {d.status !== "withdrawn" && (
            <a
              className="button button-secondary"
              href={`/api/v1/documents/${d.id}/content`}
              download
              aria-label={text.row.downloadLabel(d.title)}
            >
              <DownloadSimple size={17} />
              {text.row.download}
            </a>
          )}
          {actions(d)}
        </span>
      ),
    },
  ];
}
const documentDetail: CollectionDetail<EmployeeDocument> = {
  title: (d) => d.title,
  subtitle: (d) => (
    <StatusBadge color={statusColor(d.status)} size="sm" type="pill-color">
      {statusLabels[d.status]}
    </StatusBadge>
  ),
  body: (d) => (
    <>
      <DetailFields
        title="File"
        fields={[
          { label: "Owner", value: d.employeeName },
          { label: "Department", value: d.department },
          { label: "Category", value: categories[d.category] },
          { label: "File name", value: d.fileName },
          { label: "Type", value: d.contentType },
          { label: "Size", value: size(d.sizeBytes) },
          { label: "Uploaded", value: fullDate(d.uploadedAt) },
          { label: "Version", value: String(d.version) },
        ]}
      />
      <DetailFields
        title="Review"
        fields={[
          { label: "Status", value: statusLabels[d.status] },
          { label: "Reviewed by", value: d.reviewedBy },
          { label: "Reviewed", value: d.reviewedAt && fullDate(d.reviewedAt) },
          { label: "Note", value: d.reviewNote },
        ]}
      />
    </>
  ),
};

function DocumentRow({
  document: d,
  actions,
  showOwner = false,
}: {
  document: EmployeeDocument;
  actions?: ReactNode;
  showOwner?: boolean;
}) {
  const color =
    d.status === "verified"
      ? "success"
      : d.status === "pending"
        ? "warning"
        : d.status === "rejected"
          ? "error"
          : "gray";
  return (
    <div className={`document-row document-${d.status}`}>
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
          <StatusBadge color={color} size="sm" type="pill-color">
            {statusLabels[d.status]}
          </StatusBadge>
        </div>
        <p>
          {showOwner ? text.row.titleWithComma(d.title) : ""}
          {text.row.detail(
            categories[d.category],
            d.fileName,
            size(d.sizeBytes),
            when(d.uploadedAt),
          )}
        </p>
        {d.reviewNote && (
          <p className="leave-decision">
            {text.row.reviewNote(
              statusLabels[d.status],
              d.reviewedBy ?? "",
              d.reviewNote,
            )}
          </p>
        )}
      </div>
      <div className="document-actions">
        {d.status !== "withdrawn" && (
          <a
            className="button button-secondary"
            href={`/api/v1/documents/${d.id}/content`}
            download
            aria-label={text.row.downloadLabel(d.title)}
          >
            <DownloadSimple size={17} />
            {text.row.download}
          </a>
        )}
        {actions}
      </div>
    </div>
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
  const { reduceMotion } = usePreferences();
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
      setError(
        cause instanceof Error ? cause.message : text.mine.withdrawFailed,
      );
    }
  }
  const mineActions = (d: EmployeeDocument) =>
    d.canWithdraw && (
      <Button
        variant="secondary"
        onPress={() => void withdraw(d)}
        aria-label={text.mine.withdrawLabel(d.title)}
      >
        {text.mine.withdraw}
      </Button>
    );
  const items = query.data.items;
  const count = (status: EmployeeDocument["status"]) =>
    items.filter((d) => d.status === status).length;
  return (
    <>
      <div className="documents-stats">
        <StatCard
          label={text.stats.pending}
          value={count("pending")}
          hint={text.stats.pendingHint}
          icon={Hourglass}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.verified}
          value={count("verified")}
          hint={text.stats.verifiedHint}
          icon={CheckCircle}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.rejected}
          value={count("rejected")}
          hint={text.stats.rejectedHint}
          icon={XCircle}
          animate={!reduceMotion}
        />
      </div>
      <section
        className="panel documents-list"
        aria-labelledby="your-documents"
      >
        <div className="panel-heading">
          <div>
            <h2 id="your-documents">{text.mine.heading}</h2>
            <p>{text.mine.hint}</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="inline-error documents-error">
            {error}
          </p>
        )}
        {query.data.items.length === 0 ? (
          <EmptyBlock
            icon={FolderLock}
            title={text.mine.emptyTitle}
            description={text.mine.emptyBody}
          />
        ) : (
          <CollectionView
            id="documents-mine"
            label={text.mine.heading}
            noun="documents"
            items={query.data.items}
            getKey={(d) => d.id}
            columns={documentColumns(false, mineActions)}
            renderCard={(d) => (
              <DocumentRow document={d} actions={mineActions(d)} />
            )}
            detail={documentDetail}
          />
        )}
      </section>
    </>
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
  const { reduceMotion } = usePreferences();
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
      setError(cause instanceof Error ? cause.message : text.review.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  const reviewActions = (d: EmployeeDocument) =>
    d.canReview && (
      <>
        <Button
          isDisabled={busy === d.id}
          onPress={() => void decide(d, "verify", null)}
          aria-label={text.review.verifyLabel(d.title, d.employeeName)}
        >
          {text.review.verify}
        </Button>
        <Button
          variant="secondary"
          isDisabled={busy === d.id}
          onPress={() => {
            setError("");
            setRejecting(d);
          }}
          aria-label={text.review.rejectLabel(d.title, d.employeeName)}
        >
          {text.review.reject}
        </Button>
      </>
    );
  const { pending, recent } = query.data;
  return (
    <div className="leave-approvals">
      <div className="documents-stats documents-stats-two">
        <StatCard
          label={text.stats.waiting}
          value={pending.length}
          hint={text.stats.waitingHint}
          icon={Hourglass}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.recent}
          value={recent.length}
          hint={text.stats.recentHint}
          icon={CheckCircle}
          animate={!reduceMotion}
        />
      </div>
      {error && !rejecting && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section className="panel documents-list" aria-labelledby="to-verify">
        <div className="panel-heading">
          <div>
            <h2 id="to-verify">{text.review.pendingHeading}</h2>
            <p>{text.review.pendingHint}</p>
          </div>
        </div>
        {pending.length === 0 ? (
          <EmptyBlock
            icon={FolderLock}
            title={text.review.emptyTitle}
            description={text.review.emptyBody}
          />
        ) : (
          <CollectionView
            id="documents-review"
            label={text.review.pendingHeading}
            noun="documents"
            items={pending}
            getKey={(d) => d.id}
            columns={documentColumns(true, reviewActions)}
            renderCard={(d) => (
              <DocumentRow document={d} showOwner actions={reviewActions(d)} />
            )}
            detail={documentDetail}
          />
        )}
      </section>
      {recent.length > 0 && (
        <section className="panel documents-list" aria-labelledby="reviewed">
          <div className="panel-heading">
            <div>
              <h2 id="reviewed">{text.review.recentHeading}</h2>
              <p>{text.review.recentHint}</p>
            </div>
          </div>
          <ul className="documents">
            {recent.map((d) => (
              <li key={d.id} className="document-recent">
                <Avatar initials={d.initials} size="small" />
                <span>
                  <strong>{d.employeeName}</strong>, {d.title}
                </span>
                <StatusBadge
                  color={d.status === "verified" ? "success" : "gray"}
                  size="sm"
                  type="pill-color"
                >
                  {statusLabels[d.status]}
                </StatusBadge>
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
        title={text.review.dialogTitle}
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
            <p>{text.review.dialogIntro(rejecting.employeeName)}</p>
            <TextArea
              label={text.review.noteLabel}
              name="note"
              isRequired
              hideRequiredIndicator
              minLength={3}
              maxLength={300}
              autoFocus
            />
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
                {text.review.goBack}
              </Button>
              <Button type="submit" isDisabled={Boolean(busy)}>
                {busy ? text.review.saving : text.review.rejectSubmit}
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
      setError(text.upload.chooseFile);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(text.upload.tooLarge);
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
          problem?.title ?? text.upload.incomplete,
          response.status,
        );
      }
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.upload.failed);
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
      title={text.upload.dialogTitle}
      className="leave-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <Select
          label={text.upload.categoryLabel}
          name="category"
          defaultSelectedKey="identity"
          autoFocus
        >
          {Object.entries(categories).map(([value, label]) => (
            <Select.Item key={value} id={value} label={label} />
          ))}
        </Select>
        <Input
          label={text.upload.titleLabel}
          name="title"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={80}
          placeholder={text.upload.titlePlaceholder}
        />
        <label>
          {text.upload.fileLabel}
          <input
            type="file"
            name="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          />
        </label>
        <p className="leave-hint">{text.upload.hint}</p>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="leave-actions">
          <Button variant="secondary" isDisabled={busy} onPress={close}>
            {text.upload.cancel}
          </Button>
          <Button type="submit" isDisabled={busy}>
            {busy ? text.upload.uploading : text.upload.submit}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
