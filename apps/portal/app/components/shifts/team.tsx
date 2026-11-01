import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import {
  Button,
  Checkbox,
  EmptyBlock,
  ErrorState,
  RangeInput,
  Select,
  TextArea,
} from "@anvi/ui";
import { shfAssignResultSchema, type ShfAssignment } from "@anvi/contracts";
import {
  useShfHours,
  useShfRoster,
  useShfTemplates,
  useShfWeek,
} from "../../lib/shifts-api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import { useWorkspace } from "../../routes/workspace";
import { PersonPicker, type Person } from "../recruit/shared";
import { AssignmentPanel, WeekNav, WeekStatus } from "./detail";
import {
  ConfirmDialog,
  FormActions,
  FormError,
  Modal,
  SearchBox,
  ShiftBlock,
  addDays,
  dayLong,
  dayName,
  dayShort,
  hoursText,
  mondayOf,
  timeRange,
  todayIso,
  useShfSend,
  weekRange,
} from "./shared";

const label = (a: ShfAssignment) =>
  text.shift.ariaLabel(
    `${a.employeeName}: ${a.templateName}`,
    dayLong(a.workDate),
    timeRange(a.startAt, a.endAt, a.crossesMidnight),
  );

export function TeamRosterTab() {
  const { me } = useWorkspace();
  const manage = me.permissions.includes("shift.manage");
  const [monday, setMonday] = useState(mondayOf(todayIso()));
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState("");
  const view = manage ? "all" : "team";
  const week = useShfWeek(true, monday);
  const list = useShfRoster(
    true,
    `view=${view}&from=${monday}&to=${addDays(monday, 6)}&limit=100&page=${page}`,
  );
  const hours = useShfHours(true, `view=${view}&weekStart=${monday}&limit=100`);
  const { attempt } = useShfSend();
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const items = list.data?.items ?? [];
  const byPerson = new Map<
    string,
    { id: string; name: string; shifts: ShfAssignment[] }
  >();
  for (const a of items) {
    const row = byPerson.get(a.employeeId) ?? {
      id: a.employeeId,
      name: a.employeeName,
      shifts: [],
    };
    row.shifts.push(a);
    byPerson.set(a.employeeId, row);
  }
  const needle = search.trim().toLowerCase();
  const people = [...byPerson.values()]
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const minutesOf = (id: string, shifts: ShfAssignment[]) =>
    hours.data?.items.find((h) => h.employeeId === id)?.plannedMinutes ??
    shifts.reduce((sum, a) => sum + a.plannedMinutes, 0);
  const total = list.data?.total ?? 0;
  const limit = list.data?.limit ?? 100;
  const pages = Math.max(1, Math.ceil(total / limit));
  const canPublish = week.data?.canPublish ?? false;

  return (
    <div className="perf-tab hd-tab shf-tab">
      <div className="shf-toolbar">
        <WeekNav
          monday={monday}
          onChange={(next) => {
            setMonday(next);
            setPage(1);
          }}
        />
        <div className="shf-actions">
          <Button
            onPress={() => {
              setNotice("");
              setAssigning(true);
            }}
          >
            <Plus size={18} />
            {text.team.assign}
          </Button>
          {canPublish && (
            <Button variant="secondary" onPress={() => setPublishing(true)}>
              {text.team.publish}
            </Button>
          )}
        </div>
      </div>
      <WeekStatus monday={monday} />
      <div className="recruit-filters">
        <SearchBox
          value={search}
          onChange={setSearch}
          label={text.team.searchPlaceholder}
        />
      </div>
      {notice && (
        <p role="status" className="recruit-notice">
          {notice}
        </p>
      )}
      {!list.data ? (
        <div className="cv-skeleton h-40 rounded-xl bg-secondary" />
      ) : people.length === 0 ? (
        <EmptyBlock
          icon={CalendarBlank}
          title={text.team.empty}
          description={text.team.emptyBody}
        />
      ) : (
        <div className="shf-grid-wrap">
          <table className="shf-grid">
            <caption className="sr-only">
              {text.week.weekOf(weekRange(monday))}
            </caption>
            <thead>
              <tr>
                <th scope="col">{text.team.person}</th>
                {days.map((d) => (
                  <th scope="col" key={d}>
                    <span>{dayName(d)}</span>{" "}
                    <span className="recruit-muted">{dayShort(d)}</span>
                  </th>
                ))}
                <th scope="col">{text.team.hours}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <th scope="row" dir="auto">
                    {p.name}
                  </th>
                  {days.map((d) => {
                    const cell = p.shifts.filter((a) => a.workDate === d);
                    return (
                      <td
                        key={d}
                        data-label={dayLong(d)}
                        data-empty={cell.length === 0 ? "" : undefined}
                      >
                        {cell.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            className="shf-card"
                            aria-label={label(a)}
                            onClick={() => setOpenId(a.id)}
                          >
                            <ShiftBlock shift={a} flags={a} />
                          </button>
                        ))}
                      </td>
                    );
                  })}
                  <td data-label={text.team.hours}>
                    <strong>{hoursText(minutesOf(p.id, p.shifts))}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="shf-pager">
          <Button
            variant="secondary"
            isDisabled={page <= 1}
            onPress={() => setPage(page - 1)}
          >
            {text.team.previousPage}
          </Button>
          <span aria-live="polite">{text.team.pageOf(page, pages)}</span>
          <Button
            variant="secondary"
            isDisabled={page >= pages}
            onPress={() => setPage(page + 1)}
          >
            {text.team.nextPage}
          </Button>
          <p className="recruit-muted">{text.team.more(items.length, total)}</p>
        </div>
      )}
      <AssignmentPanel id={openId} onClose={() => setOpenId(null)} />
      <Modal
        open={assigning}
        title={text.assign.title}
        onClose={() => setAssigning(false)}
      >
        {assigning && (
          <AssignFields
            monday={monday}
            onClose={() => setAssigning(false)}
            onDone={setNotice}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={publishing}
        title={text.publish.title}
        body={text.publish.body(weekRange(monday))}
        submit={text.publish.submit}
        needsReason={false}
        onClose={() => setPublishing(false)}
        onSubmit={async () => {
          const problem = await attempt(`weeks/${monday}/publish`, {});
          if (problem === null) setNotice(text.publish.done);
          return problem;
        }}
      />
    </div>
  );
}

// ---- Assign dialog ----

const weekdays = [1, 2, 3, 4, 5, 6, 7];

function AssignFields({
  monday,
  onClose,
  onDone,
}: {
  monday: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { send, busy, error } = useShfSend();
  const templates = useShfTemplates(true, "active=true&limit=100");
  const active = templates.data?.items ?? [];
  const [person, setPerson] = useState<Person[]>([]);
  const [templateId, setTemplateId] = useState("");
  const today = todayIso();
  const [from, setFrom] = useState(monday < today ? today : monday);
  const [to, setTo] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [reason, setReason] = useState("");
  const startWeek = useShfWeek(Boolean(from), mondayOf(from || today));
  const endWeek = useShfWeek(Boolean(to), mondayOf(to || from || today));
  const published =
    (startWeek.data?.published ?? false) ||
    (to !== "" && (endWeek.data?.published ?? false));
  const ranged = to !== "";
  const ready =
    person.length === 1 &&
    templateId !== "" &&
    from !== "" &&
    (!ranged || (to >= from && days.length > 0)) &&
    (!published || reason.trim().length >= 3);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send(
      "roster",
      {
        employeeId: person[0]!.id,
        templateId,
        from,
        ...(ranged ? { to, weekdays: days } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      "POST",
      shfAssignResultSchema,
    );
    if (done) {
      onDone(text.assign.done(done.created));
      onClose();
    }
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.assign.intro}</p>
      <PersonPicker
        label={text.assign.person}
        selected={person}
        onChange={setPerson}
      />
      {templates.data && active.length === 0 ? (
        <p className="recruit-muted">{text.assign.noTemplates}</p>
      ) : (
        <Select
          label={text.assign.template}
          placeholder={text.assign.templatePlaceholder}
          selectedKey={templateId || null}
          onSelectionChange={(key) => key && setTemplateId(String(key))}
        >
          {active.map((t) => (
            <Select.Item
              key={t.id}
              id={t.id}
              label={`${t.name} · ${t.code} · ${t.startTime}–${t.endTime}`}
            />
          ))}
        </Select>
      )}
      <div className="leave-dates">
        <RangeInput
          type="date"
          label={text.assign.from}
          value={from}
          onChange={setFrom}
          min={today}
          max={addDays(today, 364)}
          isRequired
        />
        <RangeInput
          type="date"
          label={text.assign.to}
          value={to}
          onChange={setTo}
          min={from || today}
          max={addDays(today, 364)}
        />
      </div>
      {ranged && (
        <fieldset className="shf-weekdays">
          <legend>{text.assign.weekdays}</legend>
          {weekdays.map((d) => (
            <Checkbox
              key={d}
              isSelected={days.includes(d)}
              onChange={(on) =>
                setDays(on ? [...days, d].sort() : days.filter((x) => x !== d))
              }
              label={text.weekdayShort[d]!}
              aria-label={text.weekday[d]}
            />
          ))}
        </fieldset>
      )}
      <TextArea
        label={text.assign.reason}
        hint={text.assign.reasonHint}
        value={reason}
        onChange={setReason}
        maxLength={300}
        isRequired={published}
      />
      {published && (
        <p className="recruit-muted">{text.assign.publishedWarn}</p>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.assign.submit}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}
