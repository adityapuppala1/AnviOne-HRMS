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
import { LoomWeave } from "../components/loom-weave";
import { usePreferences } from "../lib/preferences";
import { useWorkspace } from "./workspace";
import { useDashboard } from "../lib/api";
import { PersonRow } from "../components/people";
import { Distribution } from "../components/distribution";
import type { Me } from "@anvi/contracts";

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
      <section className="loom-band" aria-label="Workspace summary">
        <LoomWeave
          className="loom-band-art"
          knots={data.recent.map((p) => p.initials)}
        />
        <div className="loom-band-copy">
          <p className="loom-date">
            <CalendarBlank size={17} />
            {date}
          </p>
          <h1>
            Good to see you, {me.name.split(" ")[0]}
            <span className="heading-period">.</span>
          </h1>
          <p>
            {data.total} {data.total === 1 ? "person" : "people"} across{" "}
            {data.departments.length} teams, woven into one workspace.
          </p>
        </div>
        <div className="loom-stats">
          <Link to="/people" className="loom-stat loom-stat-featured">
            <span className="loom-stat-label">
              <Users size={19} weight="duotone" />
              {me.role === "employee"
                ? "Your profile"
                : "People in your workspace"}
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
              label: "Departments",
              value: data.departments.length,
              icon: Buildings,
              to: "/teams",
              note: "Find the team behind the work",
            },
            {
              label: "Work locations",
              value: data.locations.length,
              icon: MapPin,
              to: "/teams?view=locations",
              note: "Connected across your locations",
            },
          ].map(({ label, value, icon: Icon, to, note }) => (
            <Link className="loom-stat" key={label} to={to}>
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
              <h2>New faces, shared purpose</h2>
              <p>Recently joined in your current workspace.</p>
            </div>
            <Link className="text-link" to="/people">
              View people <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="people-table-labels">
            <span>Colleague</span>
            <span>Department</span>
          </div>
          <div className="people-list">
            {data.recent.length ? (
              data.recent.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))
            ) : (
              <p className="panel-empty">
                No people are visible in this workspace.
              </p>
            )}
          </div>
          <div className="panel-footnote">
            <span className="status-dot" /> Ordered by joining date ·{" "}
            {data.total} {data.total === 1 ? "person" : "people"} in scope
          </div>
        </section>
        <section className="panel composition-panel">
          <div className="panel-heading">
            <div>
              <h2>The shape of your team</h2>
              <p>Select a department to explore.</p>
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
              <h2>A shared place to work</h2>
              <p>People by work location.</p>
            </div>
            <Link className="text-link" to="/teams?view=locations">
              Explore <ArrowUpRight size={16} />
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
                  <small>
                    {location.count}{" "}
                    {location.count === 1 ? "person" : "people"}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
        <Link to={`/people/${me.employeeId}`} className="profile-shortcut">
          <div className="shortcut-top">
            <Fingerprint size={25} weight="duotone" />
            <ArrowUpRight size={20} />
          </div>
          <div>
            <span className="eyebrow">Your place in the picture</span>
            <h2>Your work profile</h2>
            <p>Work details. Your team. All together.</p>
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
            <Badge>View profile</Badge>
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
          <p className="eyebrow">Your workspace, in focus</p>
          <h1>Good to see you, {me.name.split(" ")[0]}.</h1>
          <p>
            {auditor
              ? "A clear record of your workspace's activity."
              : "Shape the everyday experience for your organization."}
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
            {auditor ? "Auditor workspace" : "Platform admin workspace"}
          </Badge>
          <h2>
            {auditor ? "Every change has a story." : "Make AnviOne your own."}
          </h2>
          <p>
            {auditor
              ? "Review sign-ins, role changes and published settings. Filter the record and open an event for its details."
              : "Choose a palette, update your workspace names and preview the result before publishing."}
          </p>
          <Link
            className="button button-primary"
            to={auditor ? "/activity" : "/settings"}
          >
            {auditor ? "View activity" : "Customize workspace"}
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
      <div className="admin-note">
        <Fingerprint size={22} />
        <p>
          This role manages{" "}
          {auditor ? "activity records" : "workspace configuration"}. Switch to
          an assigned people role to open employee records.
        </p>
      </div>
    </div>
  );
}
