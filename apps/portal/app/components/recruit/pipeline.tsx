import { useEffect, useState, type FormEvent } from "react";
import { Kanban } from "@phosphor-icons/react/dist/csr/Kanban";
import {
  Button,
  DetailFields,
  DetailPanel,
  EmptyBlock,
  ErrorState,
  Select,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import type { RecruitApplication, RecruitStage } from "@anvi/contracts";
import {
  useRecruitApplication,
  useRecruitApplications,
  useRecruitRequisitions,
} from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import { ScheduleDialog, ScorecardItems } from "./interviews";
import { OfferCreateDialog } from "./offers";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  SelectField,
  dateOnly,
  dateTime,
  useDebounced,
  useRecruitSend,
} from "./shared";

const copy = text.pipeline;
const order: RecruitStage[] = [
  "applied",
  "screening",
  "interview",
  "assessment",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
];
const forward = order.slice(0, 6);
const reasons = Object.keys(copy.rejectionReason) as Array<
  keyof typeof copy.rejectionReason
>;
const sourceLabels = text.candidates.sources;

type Acting = {
  kind: "move" | "schedule" | "offer";
  item: RecruitApplication;
} | null;

export function PipelineTab() {
  const requisitions = useRecruitRequisitions(true, "limit=100");
  const [requisitionId, setRequisitionId] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const rows = requisitions.data?.items ?? [];
  useEffect(() => {
    if (!requisitionId && rows.length > 0) setRequisitionId(rows[0]!.id);
  }, [requisitionId, rows]);
  const query = new URLSearchParams({ limit: "100", q });
  if (requisitionId) query.set("requisitionId", requisitionId);
  const apps = useRecruitApplications(Boolean(requisitionId), query.toString());
  const [acting, setActing] = useState<Acting>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  if (requisitions.error)
    return (
      <ErrorState
        message={requisitions.error.message}
        onRetry={() => void requisitions.refetch()}
      />
    );
  if (requisitions.data && rows.length === 0)
    return (
      <EmptyBlock
        icon={Kanban}
        title={copy.noRequisitions}
        description={copy.noRequisitionsBody}
      />
    );
  if (apps.error)
    return (
      <ErrorState
        message={apps.error.message}
        onRetry={() => void apps.refetch()}
      />
    );
  const items = apps.data?.items ?? [];
  return (
    <div className="recruit-tab">
      <div className="recruit-toolbar">
        <ListFilters
          search={search}
          onSearch={setSearch}
          status="all"
          onStatus={() => undefined}
        />
        <Select
          aria-label={copy.requisition}
          selectedKey={requisitionId || null}
          onSelectionChange={(key) => key && setRequisitionId(String(key))}
          placeholder={copy.pickRequisition}
          className="kit-filter"
        >
          {rows.map((row) => (
            <Select.Item
              key={row.id}
              id={row.id}
              label={`${row.code} ${row.title}`}
            />
          ))}
        </Select>
      </div>
      {apps.data && apps.data.total > items.length && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
          {copy.limit(items.length, apps.data.total)}
        </p>
      )}
      <div className="recruit-board" role="group" aria-label={copy.boardLabel}>
        {order.map((stage) => {
          const column = items.filter((item) => item.stage === stage);
          return (
            <section
              key={stage}
              className="recruit-column"
              aria-labelledby={`stage-${stage}`}
            >
              <h3 id={`stage-${stage}`}>
                {copy.stage[stage]}
                <span className="tab-count">{column.length}</span>
              </h3>
              {column.length === 0 ? (
                <p className="recruit-muted">{copy.emptyColumn}</p>
              ) : (
                <ul>
                  {column.map((item) => (
                    <li key={item.id} className="recruit-app">
                      <strong>{item.candidateName}</strong>
                      <span>
                        {item.candidateCompany ?? text.common.none} ·{" "}
                        {text.common.months(item.candidateExperienceMonths)}
                      </span>
                      <span>{text.common.daysIn(item.daysInStage)}</span>
                      <span>
                        {item.ratingAverage !== null
                          ? copy.card.rating(
                              item.ratingAverage,
                              item.scorecardCount,
                            )
                          : copy.card.noRating}
                      </span>
                      {item.rejectionReason && (
                        <StatusBadge color="gray" size="sm" type="pill-color">
                          {copy.card.reason(
                            copy.rejectionReason[item.rejectionReason],
                          )}
                        </StatusBadge>
                      )}
                      <div className="recruit-app-actions">
                        <Button
                          variant="secondary"
                          aria-label={copy.card.details(item.candidateName)}
                          onPress={() => setOpenId(item.id)}
                        >
                          {copy.card.detailsLabel}
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={copy.card.moveAria(item.candidateName)}
                          onPress={() => setActing({ kind: "move", item })}
                        >
                          {copy.card.move}
                        </Button>
                        {item.canScheduleInterview && (
                          <Button
                            variant="secondary"
                            onPress={() =>
                              setActing({ kind: "schedule", item })
                            }
                          >
                            {copy.card.schedule}
                          </Button>
                        )}
                        {item.canMakeOffer && (
                          <Button
                            variant="secondary"
                            onPress={() => setActing({ kind: "offer", item })}
                          >
                            {copy.card.offer}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {acting?.kind === "move" && (
        <MoveDialog item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "schedule" && (
        <ScheduleDialog
          application={{
            id: acting.item.id,
            candidateName: acting.item.candidateName,
          }}
          onClose={() => setActing(null)}
        />
      )}
      <OfferCreateDialog
        open={acting?.kind === "offer"}
        applicationId={acting?.kind === "offer" ? acting.item.id : undefined}
        onClose={() => setActing(null)}
      />
      <ApplicationPanel id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function MoveDialog({
  item,
  onClose,
}: {
  item: RecruitApplication;
  onClose: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  // Offer and Hired are reached only through an offer, whatever the API lists.
  const options = item.allowedStages.filter(
    (stage) => stage !== item.stage && stage !== "offer" && stage !== "hired",
  );
  const [stage, setStage] = useState<RecruitStage | "">("");
  const [rejection, setRejection] = useState<
    keyof typeof copy.rejectionReason | ""
  >("");
  const [reason, setReason] = useState("");
  const back =
    stage !== "" &&
    forward.includes(stage) &&
    forward.indexOf(stage) < forward.indexOf(item.stage);
  const rejecting = stage === "rejected";
  const ready =
    stage !== "" &&
    (!rejecting || rejection) &&
    (!back || reason.trim().length >= 3);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !stage) return;
    const done = await send(`applications/${item.id}/stage`, {
      version: item.version,
      stage,
      ...(rejecting ? { rejectionReason: rejection } : {}),
      ...(reason.trim().length >= 3 ? { reason: reason.trim() } : {}),
    });
    if (done !== null) onClose();
  }
  return (
    <Modal open title={copy.move.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.move.body(item.candidateName, copy.stage[item.stage])}</p>
        {options.length === 0 ? (
          <p>{copy.move.noMoves}</p>
        ) : (
          <SelectField
            label={copy.move.stage}
            value={stage}
            onChange={setStage}
            options={options}
            labels={copy.stage}
          />
        )}
        {rejecting && (
          <SelectField
            label={copy.move.rejection}
            value={rejection}
            onChange={setRejection}
            options={reasons}
            labels={copy.rejectionReason}
          />
        )}
        {back && <p>{copy.move.backNeedsReason}</p>}
        {stage !== "" && (
          <TextArea
            label={copy.move.reason}
            value={reason}
            onChange={setReason}
            maxLength={500}
          />
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.move.submit}
          onCancel={onClose}
          disabled={!ready}
        />
      </form>
    </Modal>
  );
}

function ApplicationPanel({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detail = useRecruitApplication(id);
  const data = detail.data;
  const app = data?.application;
  return (
    <DetailPanel
      open={id !== null}
      onClose={onClose}
      title={app?.candidateName ?? ""}
      subtitle={app && `${app.requisitionCode} ${app.requisitionTitle}`}
    >
      {detail.error && <FormError message={detail.error.message} />}
      {data && app && (
        <div className="flex flex-col gap-5">
          <DetailFields
            fields={[
              { label: copy.detail.stage, value: copy.stage[app.stage] },
              {
                label: copy.detail.requisition,
                value: `${app.requisitionCode} ${app.requisitionTitle}`,
              },
              { label: copy.detail.source, value: sourceLabels[app.source] },
              { label: copy.detail.company, value: app.candidateCompany },
              {
                label: copy.detail.experience,
                value: text.common.months(app.candidateExperienceMonths),
              },
              {
                label: copy.detail.rating,
                value:
                  app.ratingAverage !== null
                    ? copy.card.rating(app.ratingAverage, app.scorecardCount)
                    : copy.card.noRating,
              },
            ]}
          />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-secondary">
              {copy.detail.history}
            </h3>
            {data.history.length === 0 ? (
              <p className="text-sm text-tertiary">{copy.detail.noHistory}</p>
            ) : (
              <ul className="recruit-panel-list">
                {data.history.map((entry) => (
                  <li key={`${entry.at}-${entry.toStage}`}>
                    <strong>
                      {entry.fromStage
                        ? copy.detail.move(
                            copy.stage[entry.fromStage],
                            copy.stage[entry.toStage],
                          )
                        : copy.detail.first}
                    </strong>
                    <span>{copy.detail.by(entry.by, dateTime(entry.at))}</span>
                    {entry.rejectionReason && (
                      <span>{copy.rejectionReason[entry.rejectionReason]}</span>
                    )}
                    {entry.reason && <span>{entry.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-secondary">
              {copy.detail.interviews}
            </h3>
            {data.interviews.length === 0 ? (
              <p className="text-sm text-tertiary">
                {copy.detail.noInterviews}
              </p>
            ) : (
              <ul className="recruit-panel-list">
                {data.interviews.map((interview) => (
                  <li key={interview.id}>
                    <strong>{interview.roundName}</strong>
                    <span>
                      {dateTime(interview.scheduledAt)} ·{" "}
                      {text.interviews.status[interview.status]}
                    </span>
                    <span>
                      {interview.panel.map((p) => p.employeeName).join(", ")}
                    </span>
                    {interview.canSubmitScorecard && (
                      <span>{copy.detail.scorecardsHidden}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-secondary">
              {copy.detail.scorecards}
            </h3>
            <ScorecardItems
              items={data.scorecards.items}
              blind={data.scorecards.blind}
            />
          </section>
          {data.offers.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-secondary">
                {copy.detail.offers}
              </h3>
              <ul className="recruit-panel-list">
                {data.offers.map((offer) => (
                  <li key={offer.id}>
                    <strong>{offer.title}</strong>
                    <span>
                      {text.offers.status[offer.status]} ·{" "}
                      {dateOnly(offer.proposedJoiningDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </DetailPanel>
  );
}
