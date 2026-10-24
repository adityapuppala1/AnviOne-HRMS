import { Link } from "react-router";
import {
  ArrowUpRight,
  Users,
  Building2,
  MapPin,
  Search,
  Fingerprint,
  Settings2,
  History,
  Check,
} from "lucide-react";
import { Avatar, Badge, ErrorState, LoadingState } from "@anvi/ui";
import { useWorkspace } from "./workspace";
import { useDashboard } from "../lib/api";
import { copy } from "../lib/copy";
import { PersonRow } from "../components/people";
import type { Me } from "@anvi/contracts";

export default function Home() {
  const { me } = useWorkspace();
  if (!me.permissions.includes("directory.read")) return <AdminHome me={me} />;
  return <PeopleHome />;
}
function PeopleHome() {
  const { me, branding } = useWorkspace();
  const { data, error, refetch } = useDashboard();
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  const date = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A NEW PERSPECTIVE, EVERY DAY</p>
          <h1>
            {copy.greeting}, {me.name.split(" ")[0]}{" "}
            <span className="greeting-sun" aria-hidden="true">
              ✳
            </span>
          </h1>
          <p>{copy.subtitle}</p>
        </div>
        <div className="date-pill">
          <span className="date-icon">
            {new Intl.DateTimeFormat("en", {
              day: "2-digit",
              timeZone: "Asia/Kolkata",
            }).format(new Date())}
          </span>
          <span>{date}</span>
        </div>
      </div>
      <section className="welcome-card">
        <div className="welcome-copy">
          <Badge>YOUR PEOPLE, CONNECTED</Badge>
          <h2>
            One workspace.
            <br />A world of possibilities.
          </h2>
          <p>
            Behind every great workday are great people.
            <br className="desktop-break" /> Get to know the people who make
            yours.
          </p>
          <Link className="button button-primary" to="/people">
            Explore your people <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="connection-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-spark spark-one">✳</div>
          <div className="art-spark spark-two">+</div>
          <div className="art-card art-card-back">
            <span className="art-tiny-label">GREAT THINGS START WITH</span>
            <strong>A connection.</strong>
            <div className="art-avatar-stack">
              {data.recent.slice(0, 3).map((p) => (
                <Avatar key={p.id} initials={p.initials} />
              ))}
            </div>
          </div>
          <div className="art-card art-card-front">
            <div className="art-card-logo">
              <Users size={22} />
            </div>
            <div>
              <span>Your people</span>
              <strong>
                {branding.employeeName}
                <span className="art-logo-dot">.</span>
              </strong>
            </div>
            <div className="art-line" />
            <span className="art-connected">
              <Check size={12} /> Better together
            </span>
          </div>
          <span className="art-floating-dot" />
        </div>
      </section>
      <section className="metrics-grid" aria-label="Workspace summary">
        {[
          {
            label:
              me.role === "employee"
                ? "Your profile"
                : me.role === "manager"
                  ? "People in your scope"
                  : "People in your workspace",
            value: data.total,
            icon: Users,
            note: "Active and notice-period employees",
            tone: "mint",
          },
          {
            label: "Departments",
            value: data.departments.length,
            icon: Building2,
            note: "Different talents. Shared purpose.",
            tone: "lilac",
          },
          {
            label: "Work locations",
            value: data.locations.length,
            icon: MapPin,
            note: "Connected, wherever you work.",
            tone: "peach",
          },
        ].map(({ label, value, icon: Icon, note, tone }) => (
          <div className="metric" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <span className={`metric-icon ${tone}`}>
                <Icon size={19} />
              </span>
            </div>
            <strong className="metric-value">
              {String(value).padStart(2, "0")}
            </strong>
            <span className="metric-note">{note}</span>
          </div>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel people-panel">
          <div className="panel-heading">
            <div>
              <h2>A few familiar faces</h2>
              <p>Meet the newest people in your workspace.</p>
            </div>
            <Link className="text-link" to="/people">
              View all <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="people-list">
            {data.recent.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </div>
          <div className="panel-footnote">
            <span className="status-dot" />
            Based on joining dates · {data.total} people in your current scope
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Many talents. One team.</h2>
              <p>Your people, by department.</p>
            </div>
            <Building2 size={20} className="muted" />
          </div>
          <div className="department-bars">
            {data.departments.map((dept, index) => (
              <Link
                key={dept.name}
                to={`/people?department=${encodeURIComponent(dept.name)}`}
                className="department-row"
              >
                <div>
                  <span>{dept.name}</span>
                  <strong>{dept.count.toString().padStart(2, "0")}</strong>
                </div>
                <div className="bar-track">
                  <span
                    className={`bar-fill bar-${index % 4}`}
                    style={{ width: `${(dept.count / data.total) * 100}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <section className="quick-actions">
        <div>
          <span className="eyebrow">A LITTLE SHORTCUT</span>
          <h2>Where would you like to go?</h2>
        </div>
        <Link to="/people">
          <span className="quick-action-icon">
            <Search size={20} />
          </span>
          <span>
            <strong>Find a colleague</strong>
            <small>A name. A team. A new connection.</small>
          </span>
          <ArrowUpRight size={18} />
        </Link>
        <Link to={`/people/${me.employeeId}`}>
          <span className="quick-action-icon">
            <Fingerprint size={20} />
          </span>
          <span>
            <strong>Your work profile</strong>
            <small>Your place in the bigger picture.</small>
          </span>
          <ArrowUpRight size={18} />
        </Link>
      </section>
    </div>
  );
}
function AdminHome({ me }: { me: Me }) {
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>A considered space for every role.</h1>
          <p>Choose an action within your current access.</p>
        </div>
      </div>
      <div className="admin-welcome">
        <div className="admin-welcome-icon">
          {me.role === "auditor" ? (
            <History size={32} />
          ) : (
            <Settings2 size={32} />
          )}
        </div>
        <h2>
          {me.role === "auditor"
            ? "A clearer view of what changed."
            : "Make this workspace feel like yours."}
        </h2>
        <p>
          {me.role === "auditor"
            ? "Review recent sign-ins, role changes, and published settings."
            : "Set the names and colors that bring your organization together."}
        </p>
        <Link
          className="button button-primary"
          to={me.role === "auditor" ? "/activity" : "/settings"}
        >
          {me.role === "auditor" ? "View activity" : "Customize workspace"}
          <ArrowUpRight size={17} />
        </Link>
      </div>
    </div>
  );
}
