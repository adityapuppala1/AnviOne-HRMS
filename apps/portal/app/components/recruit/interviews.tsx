import { useState, type FormEvent } from "react";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  RangeInput,
  Select,
  StatCard,
  TextArea,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import {
  recruitInterviewSchema,
  type RecruitInterview,
  type RecruitScorecard,
} from "@anvi/contracts";
import { useRecruitInterviews, useRecruitScorecards } from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  PersonPicker,
  SelectField,
  StatusPill,
  dateTime,
  interviewColor,
  useDebounced,
  useRecruitSend,
  type Person,
} from "./shared";

const copy = text.interviews;
const statuses = Object.keys(copy.status);
const modes = Object.keys(copy.mode) as Array<keyof typeof copy.mode>;
const durations = [15, 30, 45, 60, 90, 120];
const competencies = Object.keys(copy.scorecard.competencies) as Array<
  keyof typeof copy.scorecard.competencies
>;
const recommendations = Object.keys(copy.scorecard.recommendations) as Array<
  keyof typeof copy.scorecard.recommendations
>;

type Acting =
  | { kind: "reschedule" | "scorecard"; item: RecruitInterview }
  | {
      kind: "status";
      status: "completed" | "cancelled" | "no_show";
      item: RecruitInterview;
    };

const pill = (item: RecruitInterview) => (
  <StatusPill
    label={copy.status[item.status]}
    color={interviewColor[item.status] ?? "gray"}
  />
);
const panelNames = (item: RecruitInterview) =>
  item.panel.map((p) => p.employeeName).join(", ");

const columns: Column<RecruitInterview>[] = [
  {
    id: "candidate",
    label: copy.columns.candidate,
    isRowHeader: true,
    sortValue: (item) => item.candidateName,
    render: (item) => (
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm text-primary">{item.candidateName}</strong>
        <span className="text-sm text-tertiary">{item.requisitionTitle}</span>
      </span>
    ),
  },
  {
    id: "round",
    label: copy.columns.round,
    render: (item) => <span className="text-sm">{item.roundName}</span>,
  },
  {
    id: "when",
    label: copy.columns.when,
    sortValue: (item) => item.scheduledAt,
    render: (item) => (
      <time dateTime={item.scheduledAt} className="text-sm">
        {dateTime(item.scheduledAt)}
      </time>
    ),
  },
  {
    id: "mode",
    label: copy.columns.mode,
    render: (item) => <span className="text-sm">{copy.mode[item.mode]}</span>,
  },
  {
    id: "panel",
    label: copy.columns.panel,
    render: (item) => (
      <span className="block max-w-xs truncate text-sm text-tertiary">
        {panelNames(item)}
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

export function InterviewsTab({
  canFollow,
  canInterview,
}: {
  canFollow: boolean;
  canInterview: boolean;
}) {
  const [mine, setMine] = useState(!canFollow);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = useRecruitInterviews(true, mine, query.toString());
  const [acting, setActing] = useState<Acting | null>(null);
  const { send, busy, error } = useRecruitSend();
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  const detail: CollectionDetail<RecruitInterview> = {
    title: (item) => `${item.candidateName}, ${item.roundName}`,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {dateTime(item.scheduledAt)}
        {pill(item)}
      </span>
    ),
    body: (item) => (
      <div className="flex flex-col gap-4">
        <InterviewDetail item={item} />
        <FormError message={error} />
      </div>
    ),
    footer: (item, close) => (
      <>
        {item.canSubmitScorecard && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "scorecard", item });
            }}
          >
            {copy.actions.scorecard}
          </Button>
        )}
        {item.canReschedule && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "reschedule", item });
            }}
          >
            {copy.actions.reschedule}
          </Button>
        )}
        {item.canChangeStatus && (
          <>
            <Button
              variant="secondary"
              onPress={() => {
                close();
                setActing({ kind: "status", status: "cancelled", item });
              }}
            >
              {copy.actions.cancel}
            </Button>
            {new Date(item.scheduledAt).getTime() <= Date.now() && (
              <>
                <Button
                  variant="secondary"
                  onPress={() => {
                    close();
                    setActing({ kind: "status", status: "no_show", item });
                  }}
                >
                  {copy.actions.noShow}
                </Button>
                <Button
                  isDisabled={busy}
                  onPress={() =>
                    void send(`interviews/${item.id}/status`, {
                      version: item.version,
                      status: "completed",
                    })
                  }
                >
                  {copy.actions.complete}
                </Button>
              </>
            )}
          </>
        )}
      </>
    ),
  };
  const statusDialog =
    acting?.kind === "status" ? copy.statusDialog[acting.status] : null;
  const counts = list.data?.counts;
  return (
    <div className="recruit-tab">
      {counts && (
        <div className="leave-stats">
          <StatCard
            label={copy.stats.scheduled}
            value={counts.scheduled ?? 0}
            hint={copy.stats.scheduledHint}
            icon={CalendarCheck}
          />
          <StatCard
            label={copy.stats.completed}
            value={counts.completed ?? 0}
            hint={copy.stats.completedHint}
            icon={CalendarCheck}
          />
        </div>
      )}
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
        {canFollow && canInterview && (
          <Select
            aria-label={copy.scope.label}
            selectedKey={mine ? "mine" : "all"}
            onSelectionChange={(key) => {
              setMine(key === "mine");
              setPage(1);
            }}
            className="kit-filter"
          >
            <Select.Item id="all" label={copy.scope.all} />
            <Select.Item id="mine" label={copy.scope.mine} />
          </Select>
        )}
      </div>
      <CollectionView
        id="recruit-interviews"
        label={text.tabs.interviews}
        noun="interviews"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(item) => item.id}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={CalendarCheck}
        emptyTitle={copy.empty}
        emptyDescription={copy.emptyBody}
        onClearFilters={
          search || status !== "all"
            ? () => {
                setSearch("");
                setStatus("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="min-w-0 break-words text-primary">
                {item.candidateName}
              </strong>
              {pill(item)}
            </div>
            <span className="text-sm text-secondary">
              {item.roundName} · {copy.mode[item.mode]}
            </span>
            <time dateTime={item.scheduledAt} className="text-sm text-tertiary">
              {dateTime(item.scheduledAt)} ·{" "}
              {copy.schedule.minutes(item.durationMinutes)}
            </time>
            <span className="text-sm text-tertiary">
              {item.requisitionTitle}
            </span>
          </div>
        )}
        detail={detail}
      />
      {acting?.kind === "reschedule" && (
        <RescheduleDialog item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "scorecard" && (
        <ScorecardDialog item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "status" && statusDialog && (
        <NoteDialog
          open
          title={statusDialog.title}
          body={statusDialog.body}
          label={statusDialog.label}
          submit={statusDialog.submit}
          required={acting.status === "cancelled"}
          onClose={() => setActing(null)}
          onSubmit={async (note) =>
            (await send(`interviews/${acting.item.id}/status`, {
              version: acting.item.version,
              status: acting.status,
              ...(note ? { note } : {}),
            })) !== null
          }
        />
      )}
      {error && !acting && <FormError message={error} />}
    </div>
  );
}

export function ScorecardList({ interviewId }: { interviewId: string }) {
  const cards = useRecruitScorecards(interviewId);
  if (cards.error) return <FormError message={cards.error.message} />;
  if (!cards.data) return <p className="recruit-muted">{text.common.saving}</p>;
  return <ScorecardItems items={cards.data.items} blind={cards.data.blind} />;
}

export function ScorecardItems({
  items,
  blind,
}: {
  items: RecruitScorecard[];
  blind: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {blind && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
          {copy.detail.blind}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-tertiary">{copy.detail.noScorecards}</p>
      ) : (
        <ul className="recruit-cards">
          {items.map((card) => (
            <li key={card.id}>
              <strong>
                {card.interviewerName} {card.mine ? copy.detail.you : ""}
              </strong>
              <span>{copy.detail.overall(card.overall)}</span>
              <span>
                {Object.entries(card.ratings)
                  .map(
                    ([key, value]) =>
                      `${copy.scorecard.competencies[key as keyof typeof copy.scorecard.competencies] ?? key} ${value}`,
                  )
                  .join(" · ")}
              </span>
              <span>{copy.scorecard.recommendations[card.recommendation]}</span>
              {card.comment && <span>{card.comment}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InterviewDetail({ item }: { item: RecruitInterview }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailFields
        title={copy.columns.round}
        fields={[
          { label: copy.detail.candidate, value: item.candidateName },
          { label: copy.detail.requisition, value: item.requisitionTitle },
          { label: copy.detail.round, value: item.roundName },
          { label: copy.detail.when, value: dateTime(item.scheduledAt) },
          {
            label: copy.detail.duration,
            value: copy.schedule.minutes(item.durationMinutes),
          },
          { label: copy.detail.mode, value: copy.mode[item.mode] },
          { label: copy.detail.where, value: item.locationOrLink },
          { label: copy.detail.status, value: copy.status[item.status] },
          { label: copy.detail.note, value: item.statusNote },
        ]}
      />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-secondary">
          {copy.detail.panel}
        </h3>
        <ul className="recruit-panel-list">
          {item.panel.map((member) => (
            <li key={member.employeeId}>
              <strong>{member.employeeName}</strong>
              <span>
                {member.submitted
                  ? copy.detail.panelSubmitted
                  : copy.detail.panelWaiting}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-secondary">
          {copy.detail.scorecards}
        </h3>
        {item.onPanel &&
          !item.myScorecardSubmitted &&
          !item.canSubmitScorecard &&
          item.status === "scheduled" && (
            <p className="text-sm text-tertiary">
              {copy.detail.scorecardLater}
            </p>
          )}
        <ScorecardList interviewId={item.id} />
      </section>
    </div>
  );
}

// Local date-time input value to an ISO instant.
const toIso = (local: string) => new Date(local).toISOString();
const toLocal = (iso: string) => {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
};

function SlotFields({
  when,
  setWhen,
  duration,
  setDuration,
  mode,
  setMode,
  where,
  setWhere,
}: {
  when: string;
  setWhen: (v: string) => void;
  duration: string;
  setDuration: (v: string) => void;
  mode: keyof typeof copy.mode | "";
  setMode: (v: keyof typeof copy.mode) => void;
  where: string;
  setWhere: (v: string) => void;
}) {
  return (
    <>
      <RangeInput
        type="datetime-local"
        label={copy.schedule.when}
        value={when}
        onChange={setWhen}
        isRequired
      />
      <div className="leave-dates">
        <Select
          label={copy.schedule.duration}
          selectedKey={duration}
          onSelectionChange={(key) => setDuration(String(key))}
        >
          {durations.map((n) => (
            <Select.Item
              key={n}
              id={String(n)}
              label={copy.schedule.minutes(n)}
            />
          ))}
        </Select>
        <SelectField
          label={copy.schedule.mode}
          value={mode}
          onChange={setMode}
          options={modes}
          labels={copy.mode}
        />
      </div>
      <Input
        label={copy.schedule.where}
        value={where}
        onChange={setWhere}
        maxLength={200}
      />
    </>
  );
}

export function ScheduleDialog({
  application,
  onClose,
}: {
  application: { id: string; candidateName: string };
  onClose: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  const [round, setRound] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [mode, setMode] = useState<keyof typeof copy.mode | "">("video");
  const [where, setWhere] = useState("");
  const [panel, setPanel] = useState<Person[]>([]);
  const ready = round.trim().length >= 3 && when && mode && panel.length >= 1;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !mode) return;
    const done = await send("interviews", {
      applicationId: application.id,
      roundName: round.trim(),
      scheduledAt: toIso(when),
      durationMinutes: Number(duration),
      mode,
      locationOrLink: where.trim() || null,
      panel: panel.map((p) => p.id),
    });
    if (done !== null) onClose();
  }
  return (
    <Modal open title={copy.schedule.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.schedule.body(application.candidateName)}</p>
        <Input
          label={copy.schedule.round}
          placeholder={copy.schedule.roundPlaceholder}
          value={round}
          onChange={setRound}
          maxLength={60}
          isRequired
          hideRequiredIndicator
          autoFocus
        />
        <SlotFields
          {...{
            when,
            setWhen,
            duration,
            setDuration,
            mode,
            setMode,
            where,
            setWhere,
          }}
        />
        <p>{copy.schedule.panelHint}</p>
        <PersonPicker
          label={copy.schedule.panel}
          selected={panel}
          onChange={setPanel}
          max={6}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.schedule.submit}
          onCancel={onClose}
          disabled={!ready}
        />
      </form>
    </Modal>
  );
}

function RescheduleDialog({
  item,
  onClose,
}: {
  item: RecruitInterview;
  onClose: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  const [when, setWhen] = useState(toLocal(item.scheduledAt));
  const [duration, setDuration] = useState(String(item.durationMinutes));
  const [mode, setMode] = useState<keyof typeof copy.mode | "">(item.mode);
  const [where, setWhere] = useState(item.locationOrLink ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!when || !mode) return;
    const done = await send(
      `interviews/${item.id}`,
      {
        version: item.version,
        scheduledAt: toIso(when),
        durationMinutes: Number(duration),
        mode,
        locationOrLink: where.trim() || null,
      },
      recruitInterviewSchema,
      "PUT",
    );
    if (done !== null) onClose();
  }
  return (
    <Modal open title={copy.reschedule.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <SlotFields
          {...{
            when,
            setWhen,
            duration,
            setDuration,
            mode,
            setMode,
            where,
            setWhere,
          }}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.reschedule.submit}
          onCancel={onClose}
          disabled={!when}
        />
      </form>
    </Modal>
  );
}

function ScorecardDialog({
  item,
  onClose,
}: {
  item: RecruitInterview;
  onClose: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [recommendation, setRecommendation] = useState<
    keyof typeof copy.scorecard.recommendations | ""
  >("");
  const [comment, setComment] = useState("");
  const rated = competencies.filter(
    (key) => ratings[key] && ratings[key] !== "none",
  );
  const ready = rated.length > 0 && recommendation;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send(`interviews/${item.id}/scorecard`, {
      ratings: Object.fromEntries(
        rated.map((key) => [key, Number(ratings[key])]),
      ),
      recommendation,
      comment: comment.trim() || null,
    });
    if (done !== null) onClose();
  }
  return (
    <Modal open title={copy.scorecard.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{`${item.candidateName}, ${item.roundName}. ${copy.scorecard.body}`}</p>
        <p>{copy.scorecard.blindNote}</p>
        <div className="leave-dates">
          {competencies.map((key) => (
            <Select
              key={key}
              label={copy.scorecard.competencies[key]}
              selectedKey={ratings[key] ?? "none"}
              onSelectionChange={(value) =>
                setRatings((prev) => ({ ...prev, [key]: String(value) }))
              }
            >
              <Select.Item id="none" label={copy.scorecard.unrated} />
              {[1, 2, 3, 4, 5].map((n) => (
                <Select.Item key={n} id={String(n)} label={String(n)} />
              ))}
            </Select>
          ))}
        </div>
        <SelectField
          label={copy.scorecard.recommendation}
          value={recommendation}
          onChange={setRecommendation}
          options={recommendations}
          labels={copy.scorecard.recommendations}
        />
        <TextArea
          label={copy.scorecard.comment}
          value={comment}
          onChange={setComment}
          maxLength={1000}
        />
        {rated.length === 0 && (
          <p className="recruit-muted">{copy.scorecard.needRating}</p>
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.scorecard.submit}
          onCancel={onClose}
          disabled={!ready}
        />
      </form>
    </Modal>
  );
}
