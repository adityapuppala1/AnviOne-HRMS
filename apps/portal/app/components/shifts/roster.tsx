import { useState } from "react";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { Button, CollectionView, ErrorState, type Column } from "@anvi/ui";
import type { ShfAssignment } from "@anvi/contracts";
import { useShfRoster } from "../../lib/shifts-api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import { AssignmentPanel, WeekNav, WeekStatus } from "./detail";
import {
  ShiftBlock,
  StatusPill,
  addDays,
  dayLong,
  dayName,
  dayShort,
  hoursText,
  mondayOf,
  timeRange,
  todayIso,
} from "./shared";

const mode = text.week;

export function flagPills(a: ShfAssignment) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {a.status === "cancelled" && (
        <StatusPill label={text.shift.cancelled} color="gray" />
      )}
      {a.onLeave && <StatusPill label={text.shift.onLeave} color="warning" />}
      {a.afterPublish && (
        <StatusPill label={text.shift.afterPublish} color="brand" />
      )}
      {!a.published && <StatusPill label={text.shift.draftFlag} color="gray" />}
    </span>
  );
}

const cardLabel = (a: ShfAssignment) =>
  text.shift.ariaLabel(
    a.templateName,
    dayLong(a.workDate),
    timeRange(a.startAt, a.endAt, a.crossesMidnight),
  );

// Seven day columns on a desktop that fold into a day-by-day list on a phone (CSS only).
function WeekGrid({
  monday,
  items,
  onOpen,
}: {
  monday: string;
  items: ShfAssignment[];
  onOpen: (id: string) => void;
}) {
  const today = todayIso();
  return (
    <ol className="shf-week" aria-label={text.week.weekOf(monday)}>
      {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((date) => {
        const shifts = items.filter((a) => a.workDate === date);
        return (
          <li
            key={date}
            className="shf-day"
            data-today={date === today ? "" : undefined}
          >
            <h3 className="shf-day-head">
              <span>{dayName(date)}</span>
              <span className="recruit-muted">{dayShort(date)}</span>
              {date === today && (
                <span className="shf-today">{text.week.todayTag}</span>
              )}
            </h3>
            {shifts.length === 0 ? (
              <p className="shf-off">{text.week.dayOff}</p>
            ) : (
              shifts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="shf-card"
                  aria-label={cardLabel(a)}
                  onClick={() => onOpen(a.id)}
                >
                  <ShiftBlock shift={a} flags={a} />
                </button>
              ))
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function MyRosterTab() {
  const [monday, setMonday] = useState(mondayOf(todayIso()));
  const [view, setView] = useState<"week" | "list">("week");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const list = useShfRoster(
    true,
    `view=mine&from=${monday}&to=${addDays(monday, 6)}&limit=100`,
  );
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const items = list.data?.items ?? [];
  const minutes = items.reduce((sum, a) => sum + a.plannedMinutes, 0);

  const columns: Column<ShfAssignment>[] = [
    {
      id: "date",
      label: text.mine.columns.date,
      isRowHeader: true,
      sortValue: (a) => a.startAt,
      render: (a) => <strong className="text-sm">{dayLong(a.workDate)}</strong>,
    },
    {
      id: "shift",
      label: text.mine.columns.shift,
      sortValue: (a) => a.templateName,
      render: (a) => (
        <span className="text-sm" dir="auto">
          {a.templateName} · {a.templateCode}
        </span>
      ),
    },
    {
      id: "time",
      label: text.mine.columns.time,
      render: (a) => (
        <span className="text-sm">
          {timeRange(a.startAt, a.endAt, a.crossesMidnight)}
        </span>
      ),
    },
    {
      id: "planned",
      label: text.mine.columns.planned,
      render: (a) => (
        <span className="text-sm">{hoursText(a.plannedMinutes)}</span>
      ),
    },
    {
      id: "status",
      label: text.mine.columns.status,
      render: (a) => flagPills(a),
    },
  ];

  return (
    <div className="perf-tab hd-tab shf-tab">
      <div className="shf-toolbar">
        <WeekNav monday={monday} onChange={setMonday} />
        <div
          className="shf-toggle"
          role="group"
          aria-label={text.week.viewLabel}
        >
          <Button
            variant={view === "week" ? "primary" : "secondary"}
            aria-pressed={view === "week"}
            onPress={() => setView("week")}
          >
            {mode.viewWeek}
          </Button>
          <Button
            variant={view === "list" ? "primary" : "secondary"}
            aria-pressed={view === "list"}
            onPress={() => setView("list")}
          >
            {mode.viewList}
          </Button>
        </div>
      </div>
      <WeekStatus monday={monday} />
      {notice && (
        <p role="status" className="recruit-notice">
          {notice}
        </p>
      )}
      {view === "week" ? (
        !list.data ? (
          <div className="cv-skeleton h-40 rounded-xl bg-secondary" />
        ) : (
          <>
            <p className="shf-total">
              {text.week.totalHours(hoursText(minutes))} ·{" "}
              {text.week.shiftsCount(items.length)}
            </p>
            {items.length === 0 && (
              <p className="recruit-muted">{text.mine.emptyBody}</p>
            )}
            <WeekGrid monday={monday} items={items} onOpen={setOpenId} />
          </>
        )
      ) : (
        <CollectionView
          id="shf-mine"
          label={text.tabs.mine}
          noun="shifts"
          items={items}
          loading={!list.data}
          getKey={(a) => a.id}
          columns={columns}
          onOpen={(a) => setOpenId(a.id)}
          emptyIcon={CalendarBlank}
          emptyTitle={text.mine.empty}
          emptyDescription={text.mine.emptyBody}
          renderCard={(a) => (
            <div className="flex min-w-0 flex-col gap-2">
              <strong className="text-primary">{dayLong(a.workDate)}</strong>
              <ShiftBlock shift={a} flags={a} />
            </div>
          )}
        />
      )}
      <AssignmentPanel
        id={openId}
        onClose={() => setOpenId(null)}
        onDone={setNotice}
      />
    </div>
  );
}
