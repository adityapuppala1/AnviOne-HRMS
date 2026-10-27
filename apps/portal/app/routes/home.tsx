import { Link } from "react-router";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import {
  Avatar,
  Badge,
  ErrorState,
  LoadingState,
  NumberTicker,
} from "@anvi/ui";
import { Aurora } from "../components/ambient";
import { Assist, type Suggestion } from "../components/assist";
import { GlobeStage, type Satellite } from "../components/globe-stage";
import { usePreferences } from "../lib/preferences";
import { useWorkspace } from "./workspace";
import { useApprovals, useDashboard } from "../lib/api";
import { PersonRow } from "../components/people";
import { Distribution } from "../components/distribution";
import type { Me } from "@anvi/contracts";
import { assistCopy, homeCopy as text } from "../lib/copy/screens";

const ACCENTS = [
  "#f4b23e",
  "#58d6ee",
  "#ff8a73",
  "#5fdc9f",
  "#c7a4ff",
  "#ffffff",
];

// Next steps come straight from what the person is allowed to do and what is
// waiting on them. Nothing here involves AI.
function nextSteps(permissions: string[], waiting: number): Suggestion[] {
  const steps = assistCopy.steps;
  const out: Suggestion[] = [];
  if (waiting > 0)
    out.push({
      key: "approvals",
      to: "/approvals",
      ...steps.approvals(waiting),
    });
  if (permissions.includes("leave.request"))
    out.push({ key: "leave", to: "/leave", ...steps.leave });
  if (permissions.includes("attendance.self"))
    out.push({ key: "attendance", to: "/attendance", ...steps.attendance });
  if (permissions.includes("document.self"))
    out.push({ key: "documents", to: "/documents", ...steps.documents });
  out.push({ key: "holidays", to: "/calendar", ...steps.holidays });
  return out.slice(0, 3);
}

export default function Home() {
  const { me } = useWorkspace();
  return me.permissions.includes("directory.read") ? (
    <PeopleHome />
  ) : (
    <AdminHome me={me} />
  );
}
function PeopleHome() {
  const { me } = useWorkspace();
  const { data, error, refetch } = useDashboard();
  const { reduceMotion } = usePreferences();
  const permissions = me.permissions;
  const approver =
    permissions.includes("leave.approve") ||
    permissions.includes("attendance.review") ||
    permissions.includes("onboarding.manage") ||
    permissions.includes("document.review");
  const waiting = useApprovals(approver).data?.waiting ?? 0;
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  const date = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  return (
    <div className="page-enter">
      <section className="loom-band" aria-label={text.summaryLabel}>
        <Aurora />
        <GlobeStage
          pins={Math.min(Math.max(data.locations.length + 3, 4), 8)}
          satellites={data.recent.slice(0, 6).map((p, i): Satellite => ({
            key: p.id,
            node: <span>{p.initials}</span>,
            accent: ACCENTS[i % ACCENTS.length]!,
          }))}
        />
        <div className="loom-band-copy">
          <p className="loom-date">
            <CalendarBlank size={17} />
            {date}
          </p>
          <h1>
            {text.greeting(me.name.split(" ")[0])}
            <span className="heading-period">.</span>
          </h1>
          <p>{text.summary(data.total, data.departments.length)}</p>
        </div>
        <div className="loom-stats">
          <Link to="/people" className="loom-stat loom-stat-featured" data-spot>
            <span className="loom-stat-label">
              <Users size={19} weight="duotone" />
              {me.role === "employee"
                ? text.stats.yourProfile
                : text.stats.peopleInWorkspace}
            </span>
            <NumberTicker
              className="loom-stat-value"
              value={data.total}
              pad={2}
              disabled={reduceMotion}
            />
            <span className="avatar-stack">
              {data.recent.slice(0, 3).map((p) => (
                <Avatar key={p.id} initials={p.initials} size="small" />
              ))}
            </span>
            <ArrowUpRight className="loom-stat-arrow" size={18} />
          </Link>
          {[
            {
              label: text.stats.departments,
              value: data.departments.length,
              icon: Buildings,
              to: "/teams",
              note: text.stats.departmentsNote,
            },
            {
              label: text.stats.locations,
              value: data.locations.length,
              icon: MapPin,
              to: "/teams?view=locations",
              note: text.stats.locationsNote,
            },
          ].map(({ label, value, icon: Icon, to, note }) => (
            <Link className="loom-stat" key={label} to={to} data-spot>
              <span className="loom-stat-label">
                <Icon size={19} weight="duotone" />
                {label}
              </span>
              <NumberTicker
                className="loom-stat-value"
                value={value}
                pad={2}
                disabled={reduceMotion}
              />
              <small>{note}</small>
              <ArrowUpRight className="loom-stat-arrow" size={18} />
            </Link>
          ))}
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel people-panel">
          <div className="panel-heading">
            <div>
              <h2>{text.recent.title}</h2>
              <p>{text.recent.subtitle}</p>
            </div>
            <Link className="text-link" to="/people">
              {text.recent.viewPeople} <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="people-table-labels">
            <span>{text.recent.colleague}</span>
            <span>{text.recent.department}</span>
          </div>
          <div className="people-list">
            {data.recent.length ? (
              data.recent.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))
            ) : (
              <p className="panel-empty">{text.recent.empty}</p>
            )}
          </div>
          <div className="panel-footnote">
            <span className="status-dot" /> {text.recent.footnote(data.total)}
          </div>
        </section>
        <section className="panel composition-panel">
          <div className="panel-heading">
            <div>
              <h2>{text.composition.title}</h2>
              <p>{text.composition.subtitle}</p>
            </div>
            <TreeStructure size={21} className="muted" />
          </div>
          <Distribution data={data} />
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel location-panel">
          <div className="panel-heading">
            <div>
              <h2>{text.locations.title}</h2>
              <p>{text.locations.subtitle}</p>
            </div>
            <Link className="text-link" to="/teams?view=locations">
              {text.locations.explore} <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="location-cards">
            {data.locations.map((location) => (
              <Link
                to={`/people?location=${encodeURIComponent(location.name)}`}
                key={location.name}
              >
                <span className="location-icon">
                  <Buildings size={24} weight="duotone" />
                </span>
                <span>
                  <strong>{location.name}</strong>
                  <small>{text.locations.count(location.count)}</small>
                </span>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
        <Assist suggestions={nextSteps(permissions, waiting)} />
        <Link to={`/people/${me.employeeId}`} className="profile-shortcut">
          <div className="shortcut-top">
            <Fingerprint size={25} weight="duotone" />
            <ArrowUpRight size={20} />
          </div>
          <div>
            <span className="eyebrow">{text.shortcut.eyebrow}</span>
            <h2>{text.shortcut.title}</h2>
            <p>{text.shortcut.subtitle}</p>
          </div>
          <div className="shortcut-identity">
            <Avatar
              initials={me.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
              size="small"
            />
            <strong>{me.name}</strong>
            <Badge>{text.shortcut.badge}</Badge>
          </div>
        </Link>
      </div>
    </div>
  );
}
function AdminHome({ me }: { me: Me }) {
  const auditor = me.role === "auditor";
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{text.admin.eyebrow}</p>
          <h1>{text.greeting(me.name.split(" ")[0])}.</h1>
          <p>
            {auditor ? text.admin.subtitleAuditor : text.admin.subtitleAdmin}
          </p>
        </div>
      </div>
      <section className="admin-welcome">
        <div className="admin-welcome-icon">
          {auditor ? (
            <ClockCounterClockwise size={44} weight="duotone" />
          ) : (
            <SlidersHorizontal size={44} weight="duotone" />
          )}
        </div>
        <div>
          <Badge>
            {auditor ? text.admin.badgeAuditor : text.admin.badgeAdmin}
          </Badge>
          <h2>{auditor ? text.admin.titleAuditor : text.admin.titleAdmin}</h2>
          <p>{auditor ? text.admin.bodyAuditor : text.admin.bodyAdmin}</p>
          <Link
            className="button button-primary"
            to={auditor ? "/activity" : "/settings"}
          >
            {auditor ? text.admin.actionAuditor : text.admin.actionAdmin}
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
      <div className="admin-note">
        <Fingerprint size={22} />
        <p>{text.admin.note(auditor)}</p>
      </div>
    </div>
  );
}
