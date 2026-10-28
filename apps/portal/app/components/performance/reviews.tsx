import { useState, type FormEvent } from "react";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  TextArea,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { PerfCompetency, PerfReview } from "@anvi/contracts";
import { usePerfReview, usePerfReviews } from "../../lib/api";
import { performanceCopy as text } from "../../lib/copy/performance";
import {
  EntryCard,
  FormActions,
  FormError,
  ListFilters,
  Modal,
  RatingField,
  StatusPill,
  competencies,
  dateOnly,
  reviewColor,
  useDebounced,
  usePerfSend,
} from "./shared";

const copy = text.review;
const statuses = Object.keys(copy.status);

export type ReviewMode = "mine" | "team" | "finalise";
type Acting =
  | { kind: "submit"; submit: "self" | "manager"; item: PerfReview }
  | { kind: "finalise"; item: PerfReview };

const pill = (item: PerfReview) => (
  <StatusPill
    label={copy.status[item.status]}
    color={reviewColor[item.status] ?? "gray"}
  />
);
const due = (item: PerfReview) =>
  copy.cardDue(dateOnly(item.selfDue), dateOnly(item.managerDue));

const columns: Column<PerfReview>[] = [
  {
    id: "person",
    label: copy.columns.person,
    isRowHeader: true,
    sortValue: (item) => item.employeeName,
    render: (item) => <strong className="text-sm">{item.employeeName}</strong>,
  },
  {
    id: "cycle",
    label: copy.columns.cycle,
    sortValue: (item) => item.cycleName,
    render: (item) => <span className="text-sm">{item.cycleName}</span>,
  },
  {
    id: "manager",
    label: copy.columns.manager,
    sortValue: (item) => item.managerName,
    render: (item) => <span className="text-sm">{item.managerName}</span>,
  },
  {
    id: "due",
    label: copy.columns.due,
    render: (item) => (
      <span className="text-sm">
        {dateOnly(item.selfDue)} / {dateOnly(item.managerDue)}
      </span>
    ),
  },
  {
    id: "status",
    label: copy.columns.status,
    sortValue: (item) => item.status,
    render: pill,
  },
];

export function ReviewsTab({
  mode,
  canManage,
}: {
  mode: ReviewMode;
  canManage: boolean;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(
    mode === "finalise" ? "calibration" : "all",
  );
  const q = useDebounced(search.trim());
  const view = mode === "mine" ? "mine" : mode === "team" ? "team" : "all";
  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
    q,
    view,
  });
  if (status !== "all") query.set("status", status);
  const list = usePerfReviews(true, query.toString());
  const [acting, setActing] = useState<Acting | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  const detail: CollectionDetail<PerfReview> = {
    title: (item) =>
      mode === "mine"
        ? `${item.cycleName}`
        : `${item.employeeName}, ${item.cycleName}`,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {copy.cardManager(item.managerName)}
        {pill(item)}
      </span>
    ),
    body: (item) => (
      <ReviewBody item={item} mode={mode} canManage={canManage} />
    ),
    footer: (item, close) => (
      <>
        {item.canSubmitSelf && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "submit", submit: "self", item });
            }}
          >
            {copy.actions.self}
          </Button>
        )}
        {item.canSubmitManager && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "submit", submit: "manager", item });
            }}
          >
            {copy.actions.manager}
          </Button>
        )}
        {item.canFinalise && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "finalise", item });
            }}
          >
            {copy.actions.finalise}
          </Button>
        )}
      </>
    ),
  };

  const filtered =
    Boolean(search) || status !== (mode === "finalise" ? "calibration" : "all");
  const emptyTitle = filtered
    ? copy.emptyFiltered
    : mode === "finalise"
      ? copy.emptyFinalise
      : copy.empty;
  const emptyBody =
    mode === "mine"
      ? copy.emptyMine
      : mode === "team"
        ? copy.emptyTeam
        : undefined;
  return (
    <div className="perf-tab">
      <div className="recruit-toolbar">
        <ListFilters
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          status={status}
          onStatus={(value) => {
            setStatus(value);
            setPage(1);
          }}
          statuses={statuses}
          labels={copy.status}
        />
      </div>
      <CollectionView
        id={`perf-reviews-${mode}`}
        label={
          mode === "mine"
            ? text.tabs.myReviews
            : mode === "team"
              ? text.tabs.teamReviews
              : text.tabs.finalise
        }
        noun="reviews"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(item) => item.id}
        columns={columns}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={ClipboardText}
        emptyTitle={emptyTitle}
        emptyDescription={emptyBody}
        onClearFilters={
          filtered
            ? () => {
                setSearch("");
                setStatus(mode === "finalise" ? "calibration" : "all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="min-w-0 break-words text-primary">
                {mode === "mine" ? item.cycleName : item.employeeName}
              </strong>
              {pill(item)}
            </div>
            <span className="text-sm text-tertiary">
              {mode === "mine"
                ? copy.cardManager(item.managerName)
                : item.cycleName}
            </span>
            {mode === "mine" && (
              <span className="text-sm text-secondary">
                {copy.mineStatus[item.status]}
              </span>
            )}
            {item.finalRating !== null && (
              <span className="text-sm text-secondary">
                {copy.finalRating(item.finalRating)}
              </span>
            )}
            <span className="text-sm text-tertiary">{due(item)}</span>
          </div>
        )}
        detail={detail}
      />
      <SubmitForm
        open={acting?.kind === "submit"}
        acting={acting?.kind === "submit" ? acting : null}
        onClose={() => setActing(null)}
      />
      <FinaliseForm
        open={acting?.kind === "finalise"}
        item={acting?.kind === "finalise" ? acting.item : null}
        onClose={() => setActing(null)}
      />
    </div>
  );
}

// The panel body loads the review with only the entries this person may see.
function ReviewBody({
  item,
  mode,
  canManage,
}: {
  item: PerfReview;
  mode: ReviewMode;
  canManage: boolean;
}) {
  const full = usePerfReview(item.id);
  const review = full.data?.review ?? item;
  const d = copy.detail;
  const fourEyes =
    canManage && (review.mine || review.iAmManager) && !review.canFinalise;
  return (
    <div className="flex flex-col gap-5">
      {mode === "mine" && review.status !== "finalised" && (
        <p className="perf-note">
          {review.selfSubmittedAt ? copy.blind.mineDone : copy.blind.mine}
        </p>
      )}
      {mode === "mine" && (
        <p className="perf-status-line">{copy.mineStatus[review.status]}</p>
      )}
      {full.data?.blind && <p className="perf-note">{copy.blind.manager}</p>}
      {fourEyes && review.status !== "finalised" && (
        <p className="perf-note" role="note">
          {copy.fourEyes}
        </p>
      )}
      <DetailFields
        title={d.review}
        fields={[
          { label: d.employee, value: review.employeeName },
          { label: d.manager, value: review.managerName },
          { label: d.cycle, value: review.cycleName },
          { label: d.selfDue, value: dateOnly(review.selfDue) },
          { label: d.managerDue, value: dateOnly(review.managerDue) },
          {
            label: d.selfSubmitted,
            value: review.selfSubmittedAt
              ? dateOnly(review.selfSubmittedAt)
              : null,
          },
          {
            label: d.managerSubmitted,
            value: review.managerSubmittedAt
              ? dateOnly(review.managerSubmittedAt)
              : null,
          },
        ]}
      />
      {review.status === "finalised" && review.finalRating !== null && (
        <DetailFields
          title={d.result}
          fields={[
            {
              label: d.finalRating,
              value: copy.finalRating(review.finalRating),
            },
            { label: d.reason, value: review.finalReason },
            { label: d.finalisedBy, value: review.finalisedBy },
            {
              label: d.finalisedAt,
              value: review.finalisedAt ? dateOnly(review.finalisedAt) : null,
            },
          ]}
        />
      )}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-secondary">{d.entries}</h3>
        {full.error ? (
          <p role="alert" className="inline-error">
            {full.error.message}
          </p>
        ) : !full.data ? (
          <div className="cv-skeleton h-16 rounded-xl bg-secondary" />
        ) : full.data.entries.length === 0 ? (
          <p className="text-sm text-tertiary">{d.noEntries}</p>
        ) : (
          full.data.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))
        )}
      </section>
    </div>
  );
}

function SubmitForm({
  open,
  acting,
  onClose,
}: {
  open: boolean;
  acting: Extract<Acting, { kind: "submit" }> | null;
  onClose: () => void;
}) {
  const title = acting
    ? acting.submit === "self"
      ? copy.form.selfTitle
      : copy.form.managerTitle(acting.item.employeeName)
    : "";
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {open && acting && (
        <SubmitFields
          key={`${acting.item.id}-${acting.submit}`}
          kind={acting.submit}
          item={acting.item}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function SubmitFields({
  kind,
  item,
  onClose,
}: {
  kind: "self" | "manager";
  item: PerfReview;
  onClose: () => void;
}) {
  const { send, busy, error } = usePerfSend();
  const full = usePerfReview(kind === "manager" ? item.id : null);
  const [ratings, setRatings] = useState<Record<PerfCompetency, number>>({
    quality: 0,
    delivery: 0,
    collaboration: 0,
    ownership: 0,
    growth: 0,
  });
  const [comment, setComment] = useState("");
  const complete = competencies.every((area) => ratings[area] > 0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    const done = await send(`reviews/${item.id}/${kind}`, {
      version: item.version,
      ratings,
      comment: comment.trim() || null,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.form.note}</p>
      {kind === "manager" && full.data?.blind && (
        <p className="perf-note">{copy.blind.manager}</p>
      )}
      {competencies.map((area) => (
        <RatingField
          key={area}
          legend={copy.competency[area]}
          value={ratings[area]}
          onChange={(value) =>
            setRatings((current) => ({ ...current, [area]: value }))
          }
        />
      ))}
      <TextArea
        label={copy.form.comment}
        value={comment}
        onChange={setComment}
        maxLength={2000}
      />
      {!complete && <p className="recruit-muted">{copy.form.incomplete}</p>}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={copy.form.submit}
        onCancel={onClose}
        disabled={!complete}
      />
    </form>
  );
}

function FinaliseForm({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: PerfReview | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={item ? copy.finalise.title(item.employeeName) : ""}
      onClose={onClose}
    >
      {open && item && (
        <FinaliseFields key={item.id} item={item} onClose={onClose} />
      )}
    </Modal>
  );
}

function FinaliseFields({
  item,
  onClose,
}: {
  item: PerfReview;
  onClose: () => void;
}) {
  const { send, busy, error } = usePerfSend();
  const full = usePerfReview(item.id);
  const [rating, setRating] = useState(0);
  const [reason, setReason] = useState("");
  const ready = rating > 0 && reason.trim().length >= 10;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send(`reviews/${item.id}/finalise`, {
      version: item.version,
      finalRating: rating,
      reason: reason.trim(),
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.finalise.note}</p>
      {full.data?.entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
      <RatingField
        legend={copy.finalise.rating}
        value={rating}
        onChange={setRating}
      />
      <TextArea
        label={copy.finalise.reason}
        hint={copy.finalise.reasonHint}
        value={reason}
        onChange={setReason}
        maxLength={500}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={copy.finalise.submit}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}
