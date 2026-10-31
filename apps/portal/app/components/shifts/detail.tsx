import { useState, type FormEvent } from "react";
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Button, DetailFields, DetailPanel } from "@anvi/ui";
import type { ShfAssignment } from "@anvi/contracts";
import { useEngColleagues } from "../../lib/api";
import { useShfAssignment, useShfWeek } from "../../lib/shifts-api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import { useWorkspace } from "../../routes/workspace";
import {
  ConfirmDialog,
  FormActions,
  FormError,
  Modal,
  SearchBox,
  ShiftBlock,
  StatusPill,
  addDays,
  dateTime,
  dayLong,
  hoursText,
  mondayOf,
  todayIso,
  useDebounced,
  useShfSend,
  weekRange,
  timeRange,
} from "./shared";

// ---- Week navigation and status ----

export function WeekNav({
  monday,
  onChange,
}: {
  monday: string;
  onChange: (next: string) => void;
}) {
  const thisWeek = mondayOf(todayIso());
  return (
    <nav className="shf-weeknav" aria-label={text.week.label}>
      <Button
        variant="secondary"
        aria-label={text.week.previous}
        onPress={() => onChange(addDays(monday, -7))}
      >
        <CaretLeft size={18} />
        <span className="shf-hide-narrow">{text.week.previous}</span>
      </Button>
      <h2 className="shf-weektitle" aria-live="polite">
        {weekRange(monday)}
      </h2>
      <Button
        variant="secondary"
        isDisabled={monday === thisWeek}
        onPress={() => onChange(thisWeek)}
      >
        {text.week.today}
      </Button>
      <Button
        variant="secondary"
        aria-label={text.week.next}
        onPress={() => onChange(addDays(monday, 7))}
      >
        <span className="shf-hide-narrow">{text.week.next}</span>
        <CaretRight size={18} />
      </Button>
    </nav>
  );
}

export function WeekStatus({ monday }: { monday: string }) {
  const week = useShfWeek(true, monday);
  if (!week.data) return <p className="recruit-muted">{text.common.loading}</p>;
  return (
    <p
      className="recruit-notice shf-weekstatus"
      role="note"
      data-published={week.data.published ? "" : undefined}
    >
      <StatusPill
        label={week.data.published ? text.week.published : text.week.draft}
        color={week.data.published ? "success" : "gray"}
      />{" "}
      <span dir="auto">
        {week.data.published && week.data.publishedAt
          ? text.week.publishedNote(
              dateTime(week.data.publishedAt),
              week.data.publishedBy ?? "",
            )
          : text.week.draftNote}
      </span>
    </p>
  );
}

// ---- Shift details panel ----

type Acting = { kind: "swap" | "cancel"; item: ShfAssignment };

// The details panel for one shift: facts, read-only attendance, history, and the actions the
// server says the caller may take. Its dialogs live here so every roster view shares them.
export function AssignmentPanel({
  id,
  onClose,
  onDone,
}: {
  id: string | null;
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const detail = useShfAssignment(id);
  const [acting, setActing] = useState<Acting | null>(null);
  const a =
    detail.data && detail.data.assignment.id === id
      ? detail.data.assignment
      : null;
  const history = detail.data && a ? detail.data.history : [];
  const d = text.detail;
  const ask = (kind: Acting["kind"]) => {
    if (!a) return;
    onClose();
    setActing({ kind, item: a });
  };
  return (
    <>
      <DetailPanel
        open={id !== null}
        onClose={onClose}
        title={a ? a.templateName : d.shift}
        subtitle={
          a ? (
            <span className="flex flex-wrap items-center gap-2" dir="auto">
              {dayLong(a.workDate)}
              {a.status === "cancelled" && (
                <StatusPill label={text.shift.cancelled} color="gray" />
              )}
              {a.onLeave && (
                <StatusPill label={text.shift.onLeave} color="warning" />
              )}
              {a.afterPublish && (
                <StatusPill label={text.shift.afterPublish} color="brand" />
              )}
            </span>
          ) : undefined
        }
        footer={
          a && (a.canSwap || a.canCancel) ? (
            <>
              {a.canSwap && (
                <Button onPress={() => ask("swap")}>
                  {text.actions.requestSwap}
                </Button>
              )}
              {a.canCancel && (
                <Button variant="secondary" onPress={() => ask("cancel")}>
                  {text.actions.cancelShift}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {detail.error ? (
          <p role="alert" className="inline-error">
            {detail.error.message}
          </p>
        ) : !a ? (
          <div className="cv-skeleton h-24 rounded-xl bg-secondary" />
        ) : (
          <div className="flex flex-col gap-5">
            <DetailFields
              title={d.shift}
              fields={[
                {
                  label: d.shift,
                  value: <bdi>{`${a.templateName} · ${a.templateCode}`}</bdi>,
                },
                {
                  label: d.person,
                  value: a.mine ? text.common.you : <bdi>{a.employeeName}</bdi>,
                },
                { label: d.date, value: dayLong(a.workDate) },
                {
                  label: d.time,
                  value: timeRange(a.startAt, a.endAt, a.crossesMidnight),
                },
                {
                  label: d.break,
                  value:
                    a.breakMinutes > 0
                      ? text.shift.break(a.breakMinutes)
                      : text.shift.noBreak,
                },
                { label: d.planned, value: hoursText(a.plannedMinutes) },
                {
                  label: d.week,
                  value: a.published ? text.week.published : text.week.draft,
                },
                { label: d.source, value: text.shift.source[a.source] },
                { label: d.assignedBy, value: <bdi>{a.assignedBy}</bdi> },
              ]}
            />
            {(a.attendanceCheckIn !== null ||
              a.attendanceCheckOut !== null) && (
              <DetailFields
                title={text.mine.attendance}
                fields={[
                  {
                    label: d.attendance,
                    value: text.mine.attendanceBody(
                      a.attendanceCheckIn,
                      a.attendanceCheckOut,
                    ),
                  },
                ]}
              />
            )}
            {(a.attendanceCheckIn !== null ||
              a.attendanceCheckOut !== null) && (
              <p className="recruit-muted">{text.mine.attendanceNote}</p>
            )}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-secondary">
                {d.history}
              </h3>
              {history.length === 0 ? (
                <p className="text-sm text-tertiary">{d.noHistory}</p>
              ) : (
                <ol className="perf-history" aria-label={d.history}>
                  {history.map((h) => (
                    <li key={h.id}>
                      <strong>
                        {d.changeKind[h.kind]}
                        {h.afterPublish ? ` (${d.afterPublishTag})` : ""}
                      </strong>
                      {h.reason && (
                        <span dir="auto">{d.reasonLabel(h.reason)}</span>
                      )}
                      <span className="recruit-muted">
                        <bdi>{h.byLabel}</bdi> · {dateTime(h.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </DetailPanel>
      <SwapDialog
        item={acting?.kind === "swap" ? acting.item : null}
        onClose={() => setActing(null)}
        onDone={(message) => onDone?.(message)}
      />
      <CancelDialog
        item={acting?.kind === "cancel" ? acting.item : null}
        onClose={() => setActing(null)}
      />
    </>
  );
}

// ---- Cancel a shift ----

function CancelDialog({
  item,
  onClose,
}: {
  item: ShfAssignment | null;
  onClose: () => void;
}) {
  const { attempt } = useShfSend();
  const d = text.cancel;
  const published = item?.published ?? false;
  return (
    <ConfirmDialog
      open={item !== null}
      title={d.title}
      body={published ? `${d.body} ${d.bodyPublished}` : d.body}
      label={published ? d.reason : undefined}
      submit={d.submit}
      cancel={d.keep}
      needsReason={published}
      onClose={onClose}
      onSubmit={async (reason) => {
        if (!item) return null;
        return attempt(`roster/${item.id}/cancel`, {
          version: item.version,
          ...(reason ? { reason } : {}),
        });
      }}
    />
  );
}

// ---- Request a swap ----

function SwapDialog({
  item,
  onClose,
  onDone,
}: {
  item: ShfAssignment | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <Modal open={item !== null} title={text.swap.title} onClose={onClose}>
      {item && (
        <SwapFields
          key={item.id}
          item={item}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </Modal>
  );
}

function SwapFields({
  item,
  onClose,
  onDone,
}: {
  item: ShfAssignment;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { me } = useWorkspace();
  const { send, busy, error } = useShfSend();
  const [term, setTerm] = useState("");
  const [colleague, setColleague] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const q = useDebounced(term.trim(), 250);
  const found = useEngColleagues(q.length >= 2, q);
  const options = (found.data?.items ?? []).filter(
    (p) => p.employeeId !== me.employeeId,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!colleague) return;
    const done = await send("swaps", {
      assignmentId: item.id,
      colleagueId: colleague.id,
    });
    if (done !== null) {
      onDone(text.swap.sent);
      onClose();
    }
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.swap.intro}</p>
      <div className="shf-swap-yours">
        <strong>{text.swap.yours}</strong>
        <ShiftBlock shift={item} />
        <span className="recruit-muted">{dayLong(item.workDate)}</span>
      </div>
      {colleague ? (
        <div className="recruit-chosen-row" role="status">
          <strong dir="auto">{text.swap.chosen(colleague.name)}</strong>
          <Button
            variant="icon"
            aria-label={text.swap.change}
            onPress={() => setColleague(null)}
          >
            <X size={16} />
          </Button>
        </div>
      ) : (
        <>
          <SearchBox
            value={term}
            onChange={setTerm}
            label={text.swap.findLabel}
          />
          <p className="recruit-muted">{text.swap.findHint}</p>
          {q.length >= 2 && found.data && (
            <ul className="recruit-results" aria-label={text.swap.findLabel}>
              {options.length === 0 ? (
                <li className="recruit-muted">{text.swap.none}</li>
              ) : (
                options.map((p) => (
                  <li key={p.employeeId}>
                    <button
                      type="button"
                      onClick={() => {
                        setColleague({ id: p.employeeId, name: p.name });
                        setTerm("");
                      }}
                    >
                      <strong dir="auto">{p.name}</strong>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
      <p className="recruit-muted">{text.swap.tell}</p>
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.swap.submit}
        onCancel={onClose}
        disabled={!colleague}
      />
    </form>
  );
}
