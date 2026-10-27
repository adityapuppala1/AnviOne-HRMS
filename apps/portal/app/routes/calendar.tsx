import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase";
import {
  Badge,
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
} from "@anvi/ui";
import type { Calendar as CalendarData, Holiday } from "@anvi/contracts";
import { api, useCalendar } from "../lib/api";
import { calendarCopy as text } from "../lib/copy/calendar";
import { useWorkspace } from "./workspace";
import { usePreferences } from "../lib/preferences";
// Shared form styles come from the leave screen.
import "./leave.css";
import "./calendar.css";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  at(iso).toLocaleDateString("en-IN", { ...options, timeZone: "UTC" });
const daysBetween = (from: string, to: string) =>
  Math.round((at(to).getTime() - at(from).getTime()) / 86400000);

type Editing = { kind: "new" } | { kind: "edit"; holiday: Holiday } | null;

export default function CalendarPage() {
  const { me } = useWorkspace();
  const [year, setYear] = useState<number | null>(null);
  const query = useCalendar(year);
  const client = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const { reduceMotion } = usePreferences();
  if (query.error)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  const data = query.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["calendar"] });
  const send = (path: string, method: string, body: unknown) =>
    api(path, z.unknown(), {
      method,
      headers: { "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify(body),
    });
  return (
    <div className="page-enter calendar-page">
      <NextHoliday data={data} />
      <div className="calendar-stats">
        <StatCard
          label={text.stats.observed}
          value={data.holidays.filter((h) => h.active).length}
          hint={text.stats.observedHint(data.year)}
          icon={CalendarCheck}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.next}
          value={data.next ? daysBetween(data.today, data.next.date) : 0}
          suffix={data.next ? text.stats.days : undefined}
          hint={data.next ? data.next.name : text.stats.nextNone}
          icon={CalendarDots}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.workingDays}
          value={data.workWeek.days.length}
          suffix={text.stats.workingDaysSuffix}
          hint={text.stats.workingDaysHint}
          icon={Briefcase}
          animate={!reduceMotion}
        />
      </div>
      <WorkWeek data={data} send={send} refresh={refresh} />
      <section className="panel calendar-year" aria-labelledby="year">
        <div className="panel-heading">
          <div>
            <h2 id="year">{text.year.title(data.year)}</h2>
            <p>
              {text.year.summary(data.holidays.filter((h) => h.active).length)}
            </p>
          </div>
          <div className="calendar-year-actions">
            <Button
              variant="icon"
              aria-label={text.year.show(data.year - 1)}
              onPress={() => setYear(data.year - 1)}
            >
              <CaretLeft size={18} />
            </Button>
            <Button
              variant="icon"
              aria-label={text.year.show(data.year + 1)}
              onPress={() => setYear(data.year + 1)}
            >
              <CaretRight size={18} />
            </Button>
            {data.canManage && (
              <Button onPress={() => setEditing({ kind: "new" })}>
                <Plus size={17} weight="bold" />
                {text.year.add}
              </Button>
            )}
          </div>
        </div>
        <ol className="calendar-months">
          {Array.from({ length: 12 }, (_, month) => {
            const items = data.holidays.filter(
              (h) => at(h.date).getUTCMonth() === month,
            );
            const length = new Date(
              Date.UTC(data.year, month + 1, 0),
            ).getUTCDate();
            const label = new Date(
              Date.UTC(data.year, month, 1),
            ).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
            return (
              <li
                key={month}
                className={`calendar-month ${items.length ? "" : "is-quiet"}`}
              >
                <h3>{label}</h3>
                <div className="calendar-thread" aria-hidden="true">
                  {items
                    .filter((h) => h.active)
                    .map((h) => (
                      <span
                        key={h.id}
                        style={{
                          left: `${((at(h.date).getUTCDate() - 1) / (length - 1)) * 100}%`,
                        }}
                      />
                    ))}
                </div>
                {items.length === 0 ? (
                  <p className="calendar-none">{text.year.none}</p>
                ) : (
                  <ul>
                    {items.map((h) => (
                      <li
                        key={h.id}
                        className={h.active ? "" : "calendar-inactive"}
                      >
                        <span className="calendar-day">
                          <strong>{at(h.date).getUTCDate()}</strong>
                          {fmt(h.date, { weekday: "short" })}
                        </span>
                        <span className="calendar-name">
                          <strong>{h.name}</strong>
                          <small>
                            {h.locationName ?? text.year.wholeOrganization}
                            {h.active ? "" : text.year.notObserved}
                          </small>
                        </span>
                        {data.canManage && (
                          <Button
                            variant="icon"
                            aria-label={text.year.edit(h.name)}
                            onPress={() =>
                              setEditing({ kind: "edit", holiday: h })
                            }
                          >
                            <PencilSimple size={17} />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      {data.canManage && (
        <HolidayDialog
          editing={editing}
          data={data}
          onClose={() => setEditing(null)}
          send={send}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function NextHoliday({ data }: { data: CalendarData }) {
  const next = data.next;
  const wait = next ? daysBetween(data.today, next.date) : 0;
  let when = "";
  if (next) {
    if (wait === 0) when = text.hero.today;
    else if (wait === 1) when = text.hero.tomorrow;
    else when = text.hero.inDays(wait);
  }
  return (
    <PageHeader
      title={next ? next.name : text.hero.noneAhead}
      description={
        next
          ? text.hero.detail(
              fmt(next.date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
              next.locationName,
            )
          : text.hero.empty
      }
    >
      <p className="loom-date">{next ? when : text.hero.nothing}</p>
    </PageHeader>
  );
}

function WorkWeek({
  data,
  send,
  refresh,
}: {
  data: CalendarData;
  send: (path: string, method: string, body: unknown) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const [days, setDays] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = days ?? data.workWeek.days;
  const changed =
    days !== null &&
    [...days].sort().join() !== [...data.workWeek.days].sort().join();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await send("/calendar/work-week", "PUT", {
        days: [...current].sort(),
        version: data.workWeek.version,
        reason: String(new FormData(event.currentTarget).get("reason")),
      });
      setDays(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.errors.save);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel calendar-week" aria-labelledby="week">
      <div className="panel-heading">
        <div>
          <h2 id="week">{text.week.title}</h2>
          <p>{data.canManage ? text.week.manageHint : text.week.viewHint}</p>
        </div>
      </div>
      <form className="calendar-week-form" onSubmit={(e) => void save(e)}>
        <div
          className="calendar-weekdays"
          role="group"
          aria-label={text.week.groupLabel}
        >
          {text.weekdays.map(([n, short, long]) => {
            const on = current.includes(n);
            return data.canManage ? (
              <button
                key={n}
                type="button"
                className={`calendar-weekday ${on ? "is-on" : ""}`}
                aria-pressed={on}
                aria-label={long}
                onClick={() =>
                  setDays(
                    on
                      ? current.filter((d) => d !== n)
                      : [...current, n].sort(),
                  )
                }
              >
                {short}
              </button>
            ) : (
              <span
                key={n}
                className={`calendar-weekday ${on ? "is-on" : ""}`}
                aria-label={text.week.dayState(long, on)}
                role="img"
              >
                {short}
              </span>
            );
          })}
        </div>
        {changed && (
          <div className="leave-form calendar-week-save">
            <label>
              {text.week.reasonLabel}
              <textarea name="reason" required minLength={10} maxLength={300} />
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="leave-actions">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => setDays(null)}
              >
                {text.week.discard}
              </Button>
              <Button type="submit" isDisabled={busy || current.length === 0}>
                {busy ? text.week.saving : text.week.save}
              </Button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function HolidayDialog({
  editing,
  data,
  onClose,
  send,
  refresh,
}: {
  editing: Editing;
  data: CalendarData;
  onClose: () => void;
  send: (path: string, method: string, body: unknown) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const holiday = editing?.kind === "edit" ? editing.holiday : null;
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (holiday)
        await send(`/calendar/holidays/${holiday.id}`, "PUT", {
          name: String(form.get("name")),
          active: form.get("active") === "on",
          version: holiday.version,
          reason: String(form.get("reason")),
        });
      else
        await send("/calendar/holidays", "POST", {
          date: String(form.get("date")),
          name: String(form.get("name")),
          locationId: String(form.get("location")) || null,
          reason: String(form.get("reason")),
        });
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.errors.save);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogPanel
      open={editing !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={holiday ? text.dialog.editTitle : text.dialog.addTitle}
      className="leave-modal"
    >
      <form
        key={holiday?.id ?? "new"}
        className="leave-form"
        onSubmit={(event) => void submit(event)}
      >
        {holiday ? (
          <p>
            {text.dialog.fixedNote(
              fmt(holiday.date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
              holiday.locationName,
            )}
          </p>
        ) : (
          <div className="leave-dates">
            <label>
              {text.dialog.date}
              <input
                type="date"
                name="date"
                required
                defaultValue={`${data.year}-01-01`}
                min={`${data.year}-01-01`}
                max={`${data.year}-12-31`}
              />
            </label>
            <label>
              {text.dialog.appliesTo}
              <select name="location" defaultValue="">
                <option value="">{text.dialog.wholeOrganization}</option>
                {data.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {text.dialog.office(l.name)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label>
          {text.dialog.name}
          <input
            name="name"
            required
            minLength={2}
            maxLength={60}
            defaultValue={holiday?.name ?? ""}
            autoFocus
          />
        </label>
        {holiday && (
          <label className="calendar-check">
            <input
              type="checkbox"
              name="active"
              defaultChecked={holiday.active}
            />
            {text.dialog.observed}
          </label>
        )}
        <label>
          {text.dialog.reason}
          <textarea name="reason" required minLength={10} maxLength={300} />
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="leave-actions">
          <Button variant="secondary" isDisabled={busy} onPress={close}>
            {text.dialog.cancel}
          </Button>
          <Button type="submit" isDisabled={busy}>
            {busy
              ? text.dialog.saving
              : holiday
                ? text.dialog.saveHoliday
                : text.dialog.addHoliday}
          </Button>
        </div>
        {holiday && !holiday.active && (
          <Badge>{text.dialog.notObservedBadge}</Badge>
        )}
      </form>
    </DialogPanel>
  );
}
