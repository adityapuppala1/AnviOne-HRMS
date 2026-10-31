import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CalendarStar } from "@phosphor-icons/react/dist/csr/CalendarStar";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { Airplane } from "@phosphor-icons/react/dist/csr/Airplane";
import { SealCheck } from "@phosphor-icons/react/dist/csr/SealCheck";
import { Scroll } from "@phosphor-icons/react/dist/csr/Scroll";
import { Laptop } from "@phosphor-icons/react/dist/csr/Laptop";
import { Button, NumberTicker } from "@anvi/ui";
import type { Me } from "@anvi/contracts";
import {
  mutate,
  useAttendance,
  useCalendar,
  useLeave,
  useMyAssets,
  useMyPolicies,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { todayCopy as text } from "../lib/copy/today";
import "./today.css";

const minutes = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h! * 60 + m!;
};
const duration = (total: number) =>
  `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000,
  );

// What a person needs first thing: record the day, see leave left, know the
// next holiday and what is waiting on them. Everything reads data the other
// screens already load; the only action is the existing check-in and check-out.
export function TodayPanel({ me, waiting }: { me: Me; waiting: number }) {
  const canPunch = me.permissions.includes("attendance.self");
  const canLeave = me.permissions.includes("leave.request");
  const approver =
    me.permissions.includes("leave.approve") ||
    me.permissions.includes("attendance.review") ||
    me.permissions.includes("document.review") ||
    me.permissions.includes("onboarding.manage");
  if (!canPunch && !canLeave && !approver) return null;
  return (
    <section className="today" aria-labelledby="today-title">
      <h2 id="today-title">{text.title}</h2>
      <div className="today-grid">
        {canPunch && <AttendanceCard me={me} />}
        {canLeave && <LeaveCard />}
        <HolidayCard />
        {me.permissions.includes("asset.self") && <EquipmentCard />}
        {me.permissions.includes("policy.self") && <PolicyCard />}
        {approver && <DecisionsCard waiting={waiting} />}
      </div>
    </section>
  );
}

function AttendanceCard({ me }: { me: Me }) {
  const { data } = useAttendance(true);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data) return <div className="today-card today-skeleton" aria-hidden />;
  const record = data.record;
  const status = data.days.find((d) => d.date === data.today)?.status;
  const offDay =
    status === "leave" || status === "holiday" || status === "weekend";
  async function punch() {
    setBusy(true);
    setError("");
    try {
      if (record)
        await mutate("/attendance/check-out", me.csrfToken, {
          version: record.version,
        });
      else await mutate("/attendance/check-in", me.csrfToken, {});
      await client.invalidateQueries({ queryKey: ["attendance"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.attendance.failed);
    } finally {
      setBusy(false);
    }
  }
  let headline: string = text.attendance.none;
  let hint: string = text.attendance.noneHint;
  if (offDay) {
    headline =
      status === "leave"
        ? text.attendance.leave
        : status === "holiday"
          ? text.attendance.holiday
          : text.attendance.weekend;
    hint = record
      ? text.attendance.working(record.checkIn)
      : text.attendance.rest;
  } else if (record && !record.checkOut) {
    headline = text.attendance.working(record.checkIn);
    hint = text.attendance.soFar(
      duration(Math.max(minutes(data.now) - minutes(record.checkIn), 0)),
    );
  } else if (record?.checkOut) {
    headline = text.attendance.done;
    hint = `${text.attendance.range(record.checkIn, record.checkOut)} · ${text.attendance.worked(
      duration(minutes(record.checkOut) - minutes(record.checkIn)),
    )}`;
  }
  const finished = Boolean(record?.checkOut);
  return (
    <div className="today-card today-attendance" data-spot>
      <span className="today-label">
        <Fingerprint size={18} weight="duotone" aria-hidden="true" />
        {text.attendance.label}
      </span>
      <strong className="today-headline">{headline}</strong>
      <p>{hint}</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="today-actions">
        {!offDay && !finished && (
          <Button isDisabled={busy} onPress={() => void punch()}>
            {busy
              ? text.attendance.saving
              : record
                ? text.attendance.checkOut
                : text.attendance.checkIn}
          </Button>
        )}
        <Link className="text-link" to="/attendance">
          {text.attendance.open} <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function LeaveCard() {
  const { data } = useLeave(true);
  const { reduceMotion } = usePreferences();
  if (!data) return <div className="today-card today-skeleton" aria-hidden />;
  const limited = data.balances.filter(
    (b) => b.annualDays !== null && b.available !== null,
  );
  const available = limited.reduce((sum, b) => sum + (b.available ?? 0), 0);
  const pending = data.requests.filter((r) => r.state === "pending").length;
  return (
    <div className="today-card" data-spot>
      <span className="today-label">
        <Airplane size={18} weight="duotone" aria-hidden="true" />
        {text.leave.label}
      </span>
      {limited.length ? (
        <>
          <p className="today-figure">
            <NumberTicker
              className="today-number"
              value={Math.round(available * 10) / 10}
              disabled={reduceMotion}
            />
            <span>{text.leave.available}</span>
          </p>
          <ul className="today-bars">
            {limited.slice(0, 3).map((b) => (
              <li key={b.id}>
                <span>{b.name}</span>
                <small>{text.leave.left(b.available!, b.annualDays!)}</small>
                <i
                  aria-hidden="true"
                  style={{
                    width: `${Math.min(100, (b.available! / b.annualDays!) * 100)}%`,
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{text.leave.none}</p>
      )}
      {pending > 0 && (
        <p className="today-note">{text.leave.pending(pending)}</p>
      )}
      <div className="today-actions">
        <Link className="text-link" to="/leave">
          {text.leave.request} <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function HolidayCard() {
  const { data } = useCalendar(null);
  if (!data) return <div className="today-card today-skeleton" aria-hidden />;
  return (
    <div className="today-card" data-spot>
      <span className="today-label">
        <CalendarStar size={18} weight="duotone" aria-hidden="true" />
        {text.holiday.label}
      </span>
      {data.next ? (
        <>
          <strong className="today-headline">{data.next.name}</strong>
          <p>
            {text.holiday.when(
              data.next.date,
              daysBetween(data.today, data.next.date),
            )}
          </p>
        </>
      ) : (
        <p>{text.holiday.none}</p>
      )}
      <div className="today-actions">
        <Link className="text-link" to="/calendar">
          {text.holiday.open} <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}

// Shown only while HR is waiting for the person to confirm issued equipment.
function EquipmentCard() {
  const { data } = useMyAssets(true);
  const waiting = data?.current.filter((a) => !a.acknowledgedAt).length ?? 0;
  if (!waiting) return null;
  return (
    <div className="today-card today-urgent" data-spot>
      <span className="today-label">
        <Laptop size={18} weight="duotone" aria-hidden="true" />
        {text.equipment.label}
      </span>
      <strong className="today-headline">
        {text.equipment.waiting(waiting)}
      </strong>
      <p>{text.equipment.hint}</p>
      <div className="today-actions">
        <Link className="text-link" to="/assets">
          {text.equipment.open} <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function PolicyCard() {
  const { data } = useMyPolicies(true);
  if (!data) return <div className="today-card today-skeleton" aria-hidden />;
  return (
    <div
      className={`today-card ${data.outstanding ? "today-urgent" : ""}`}
      data-spot
    >
      <span className="today-label">
        <Scroll size={18} weight="duotone" aria-hidden="true" />
        {text.policies.label}
      </span>
      {data.outstanding > 0 ? (
        <>
          <strong className="today-headline">
            {text.policies.waiting(data.outstanding)}
          </strong>
          <p>{text.policies.hint}</p>
        </>
      ) : (
        <p>{text.policies.upToDate}</p>
      )}
      <div className="today-actions">
        <Link className="text-link" to="/policies">
          {text.policies.open} <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function DecisionsCard({ waiting }: { waiting: number }) {
  return (
    <div className={`today-card ${waiting ? "today-urgent" : ""}`} data-spot>
      <span className="today-label">
        <SealCheck size={18} weight="duotone" aria-hidden="true" />
        {text.decisions.label}
      </span>
      {waiting > 0 ? (
        <>
          <strong className="today-headline">
            {text.decisions.count(waiting)}
          </strong>
          <p>{text.decisions.hint}</p>
        </>
      ) : (
        <p>{text.decisions.none}</p>
      )}
      <div className="today-actions">
        <Link className="text-link" to="/approvals">
          {text.decisions.open} <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}
