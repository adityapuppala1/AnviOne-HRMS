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
  CollectionView,
  DetailFields,
  DialogPanel,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  Checkbox,
  Input,
  RangeInput,
  Select,
  TextArea,
  type Column,
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

const WHOLE_ORGANIZATION = "__organization";

export default function CalendarPage() {
  const { me } = useWorkspace();
  const [year, setYear] = useState<number | null>(null);
  const query = useCalendar(year);
  const client = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [listView, setListView] = useState(false);
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
              variant="secondary"
              aria-pressed={listView}
              onPress={() => setListView(!listView)}
            >
              {listView ? "Month view" : "List view"}
            </Button>
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
        {listView ? (
          <HolidayList
            holidays={[...data.holidays].sort((a, b) =>
              a.date < b.date ? -1 : 1,
            )}
            canManage={data.canManage}
            onEdit={(holiday) => setEditing({ kind: "edit", holiday })}
            year={data.year}
          />
        ) : (
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
        )}
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

type HolidayItem = Holiday;
function HolidayList({
  holidays,
  canManage,
  onEdit,
  year,
}: {
  holidays: HolidayItem[];
  canManage: boolean;
  onEdit: (holiday: HolidayItem) => void;
  year: number;
}) {
  const scope = (h: HolidayItem) =>
    h.locationName ?? text.year.wholeOrganization;
  const columns: Column<HolidayItem>[] = [
    {
      id: "date",
      label: "Date",
      isRowHeader: true,
      sortValue: (h) => h.date,
      render: (h) => (
        <span className="text-sm font-medium">
          {fmt(h.date, { weekday: "short", day: "numeric", month: "short" })}
        </span>
      ),
    },
    {
      id: "name",
      label: "Holiday",
      sortValue: (h) => h.name,
      render: (h) => <span className="text-sm">{h.name}</span>,
    },
    {
      id: "scope",
      label: "Applies to",
      sortValue: scope,
      render: (h) => <span className="text-sm">{scope(h)}</span>,
    },
    {
      id: "observed",
      label: "Observed",
      render: (h) => (
        <span className="text-sm">
          {h.active ? "Yes" : text.year.notObserved}
        </span>
      ),
    },
    {
      id: "edit",
      label: "",
      render: (h) =>
        canManage ? (
          <Button
            variant="icon"
            aria-label={text.year.edit(h.name)}
            onPress={() => onEdit(h)}
          >
            <PencilSimple size={17} />
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="calendar-list">
      <CollectionView
        id="calendar-holidays"
        label={text.year.title(year)}
        noun="holidays"
        items={holidays}
        getKey={(h) => h.id}
        columns={columns}
        defaultView="table"
        renderCard={(h) => (
          <div className="flex min-w-0 flex-col gap-1">
            <strong className="text-sm">{h.name}</strong>
            <span className="text-sm text-tertiary">
              {fmt(h.date, { weekday: "long", day: "numeric", month: "long" })}
            </span>
            <span className="text-sm text-tertiary">
              {scope(h)}
              {h.active ? "" : text.year.notObserved}
            </span>
          </div>
        )}
        detail={{
          title: (h) => h.name,
          subtitle: (h) =>
            fmt(h.date, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          body: (h) => (
            <DetailFields
              fields={[
                { label: "Applies to", value: scope(h) },
                { label: "Observed", value: h.active ? "Yes" : "No" },
                { label: "Weekday", value: fmt(h.date, { weekday: "long" }) },
              ]}
            />
          ),
          footer: canManage
            ? (h, close) => (
                <Button
                  variant="secondary"
                  onPress={() => {
                    close();
                    onEdit(h);
                  }}
                >
                  Edit holiday
                </Button>
              )
            : undefined,
        }}
      />
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
            <TextArea
              label={text.week.reasonLabel}
              name="reason"
              isRequired
              hideRequiredIndicator
              minLength={10}
              maxLength={300}
            />
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
    const locationId = String(form.get("location") ?? WHOLE_ORGANIZATION);
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
          locationId: locationId === WHOLE_ORGANIZATION ? null : locationId,
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
            <RangeInput
              type="date"
              name="date"
              label={text.dialog.date}
              isRequired
              defaultValue={`${data.year}-01-01`}
              min={`${data.year}-01-01`}
              max={`${data.year}-12-31`}
            />
            <Select
              label={text.dialog.appliesTo}
              name="location"
              defaultSelectedKey={WHOLE_ORGANIZATION}
            >
              <Select.Item
                id={WHOLE_ORGANIZATION}
                label={text.dialog.wholeOrganization}
              />
              {data.locations.map((l) => (
                <Select.Item
                  key={l.id}
                  id={l.id}
                  label={text.dialog.office(l.name)}
                />
              ))}
            </Select>
          </div>
        )}
        <Input
          label={text.dialog.name}
          name="name"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={60}
          defaultValue={holiday?.name ?? ""}
          autoFocus
        />
        {holiday && (
          <Checkbox
            name="active"
            value="on"
            defaultSelected={holiday.active}
            label={text.dialog.observed}
          />
        )}
        <TextArea
          label={text.dialog.reason}
          name="reason"
          isRequired
          hideRequiredIndicator
          minLength={10}
          maxLength={300}
        />
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
