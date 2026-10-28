import { useEffect, useState } from "react";
import {
  NavLink,
  Outlet,
  Navigate,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarStar } from "@phosphor-icons/react/dist/csr/CalendarStar";
import { Tray } from "@phosphor-icons/react/dist/csr/Tray";
import { FolderLock } from "@phosphor-icons/react/dist/csr/FolderLock";
import { Laptop } from "@phosphor-icons/react/dist/csr/Laptop";
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { DoorOpen } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt";
import { IdentificationCard } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { Table as TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { Scroll } from "@phosphor-icons/react/dist/csr/Scroll";
import { CaretUpDown } from "@phosphor-icons/react/dist/csr/CaretUpDown";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { ChartLineUp } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { SidebarSimple } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { Question } from "@phosphor-icons/react/dist/csr/Question";
import { Command as CommandIcon } from "@phosphor-icons/react/dist/csr/Command";
import {
  Avatar,
  Button,
  ErrorState,
  LoadingState,
  DialogPanel,
} from "@anvi/ui";
import { roleLabels, type Me, type Branding } from "@anvi/contracts";
import { ApiError, useMe, useBranding, useApprovals, mutate } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { copy } from "../lib/copy";
import { Brand } from "../components/brand";
import { Command } from "../components/command";
import { UpdatesBell } from "../components/updates";
import { IdleGuard } from "../components/idle-guard";

type Context = {
  me: Me;
  branding: Branding;
  switchRole: (role: Me["role"]) => Promise<void>;
};
export const useWorkspace = () => useOutletContext<Context>();
// Destinations promoted to the phone's bottom bar, in priority order.
const QUICK = [
  "/",
  "/leave",
  "/attendance",
  "/approvals",
  "/people",
  "/documents",
];

export default function Workspace() {
  const query = useMe();
  if (query.error instanceof ApiError && query.error.status === 401)
    return <Navigate to="/login" replace />;
  if (query.error)
    return (
      <main className="standalone">
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </main>
    );
  if (!query.data)
    return (
      <main className="standalone">
        <LoadingState />
      </main>
    );
  return <Shell me={query.data} />;
}
function Shell({ me }: { me: Me }) {
  const brandingQuery = useBranding();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { preferences, update, dark } = usePreferences();
  const [drawer, setDrawer] = useState(false),
    [command, setCommand] = useState(false),
    [roles, setRoles] = useState(false),
    [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (brandingQuery.data)
      document.documentElement.dataset.theme = brandingQuery.data.theme;
  }, [brandingQuery.data]);
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);
  async function switchRole(role: Me["role"]) {
    if (role === me.role) {
      setRoles(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await client.cancelQueries();
      await mutate("/session/role-context", me.csrfToken, { role });
      client.clear();
      setRoles(false);
      void navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch workspace.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await mutate("/auth/logout", me.csrfToken);
      await client.cancelQueries();
      client.clear();
      void navigate("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-out failed. Try again.");
    }
  }
  // The server ended or will end this session for inactivity: leave quietly and say why.
  async function expire() {
    try {
      await mutate("/auth/logout", me.csrfToken);
    } catch {
      /* The session is already gone; nothing left to end. */
    }
    await client.cancelQueries();
    client.clear();
    void navigate("/login?reason=idle");
  }
  const brand = brandingQuery.data;
  const approver =
    me.permissions.includes("leave.approve") ||
    me.permissions.includes("attendance.review") ||
    me.permissions.includes("onboarding.manage") ||
    me.permissions.includes("document.review");
  const waiting = useApprovals(approver).data?.waiting ?? 0;
  const links = [
    { to: "/", label: copy.nav.overview, icon: SquaresFour, visible: true },
    {
      to: "/people",
      label: copy.nav.people,
      icon: Users,
      visible: me.permissions.includes("directory.read"),
    },
    {
      to: "/teams",
      label: copy.nav.teams,
      icon: TreeStructure,
      visible: me.permissions.includes("directory.read"),
    },
    {
      to: "/organization",
      label: copy.nav.organization,
      icon: Buildings,
      visible: me.permissions.includes("organization.read"),
    },
    {
      to: "/candidates",
      label: copy.nav.candidates,
      icon: Users,
      visible: me.permissions.includes("onboarding.manage"),
    },
    {
      to: "/tasks",
      label: copy.nav.tasks,
      icon: ClipboardText,
      visible: me.permissions.includes("onboarding.task.update"),
    },
    {
      to: "/leave",
      label: copy.nav.leave,
      icon: AirplaneTilt,
      visible:
        me.permissions.includes("leave.request") ||
        me.permissions.includes("leave.approve"),
    },
    {
      to: "/attendance",
      label: copy.nav.attendance,
      icon: CalendarDots,
      visible:
        me.permissions.includes("attendance.self") ||
        me.permissions.includes("attendance.review"),
    },
    {
      to: "/approvals",
      label: copy.nav.approvals,
      icon: Tray,
      visible: approver,
      count: waiting,
    },
    {
      to: "/assets",
      label: copy.nav.assets,
      icon: Laptop,
      visible:
        me.permissions.includes("asset.self") ||
        me.permissions.includes("asset.manage"),
    },
    {
      to: "/policies",
      label: copy.nav.policies,
      icon: Scroll,
      visible:
        me.permissions.includes("policy.self") ||
        me.permissions.includes("policy.manage"),
    },
    {
      to: "/reports",
      label: copy.nav.reports,
      icon: TableIcon,
      visible: me.permissions.includes("report.run"),
    },
    {
      to: "/chart",
      label: copy.nav.chart,
      icon: TreeStructure,
      visible: me.permissions.includes("directory.read"),
    },
    {
      to: "/details",
      label: copy.nav.details,
      icon: IdentificationCard,
      visible:
        me.permissions.includes("profile.self") ||
        me.permissions.includes("profile.review"),
    },
    {
      to: "/expenses",
      label: copy.nav.expenses,
      icon: Receipt,
      visible:
        me.permissions.includes("expense.self") ||
        me.permissions.includes("expense.approve") ||
        me.permissions.includes("expense.manage"),
    },
    {
      to: "/exit",
      label: copy.nav.exit,
      icon: DoorOpen,
      visible:
        me.permissions.includes("exit.self") ||
        me.permissions.includes("exit.manage"),
    },
    {
      to: "/documents",
      label: copy.nav.documents,
      icon: FolderLock,
      visible:
        me.permissions.includes("document.self") ||
        me.permissions.includes("document.review"),
    },
    {
      to: "/calendar",
      label: copy.nav.holidays,
      icon: CalendarStar,
      visible: true,
    },
    {
      to: "/settings",
      label: copy.nav.settings,
      icon: GearSix,
      visible: me.permissions.includes("branding.write"),
    },
    {
      to: "/insights",
      label: copy.nav.insights,
      icon: ChartLineUp,
      visible: me.permissions.includes("insights.read"),
    },
    {
      to: "/activity",
      label: copy.nav.activity,
      icon: ClockCounterClockwise,
      visible: me.permissions.includes("audit.read"),
    },
  ];
  const title = location.pathname.startsWith("/people/")
    ? "Employee profile"
    : location.pathname === "/preferences"
      ? "Display preferences"
      : (links.find((link) => link.to === location.pathname)?.label ??
        "Overview");
  const initials = me.name
    .split(" ")
    .map((n) => n[0])
    .join("");
  const sidebar = (
    <>
      <div className="sidebar-brand">
        <Brand
          name={
            me.role === "employee" ? brand?.employeeName : brand?.platformName
          }
          light
        />
        <Button
          className="collapse-toggle"
          variant="icon"
          aria-label={
            preferences.collapsed ? "Expand navigation" : "Collapse navigation"
          }
          onPress={() => update({ collapsed: !preferences.collapsed })}
        >
          <SidebarSimple size={18} />
        </Button>
      </div>
      <div className="workspace-label">
        <span className="workspace-initial">
          {(brand?.organizationName ?? me.entityName).slice(0, 1)}
        </span>
        <span>
          {brand?.organizationName ?? me.entityName}
          <small>{copy.shell.peopleWorkspace}</small>
        </span>
      </div>
      <p className="sidebar-label">{copy.shell.workspace}</p>
      <nav aria-label={copy.nav.main}>
        {links
          .filter((link) => link.visible)
          .map(({ to, label, icon: Icon, count }) => (
            <NavLink
              key={to}
              to={to}
              prefetch="intent"
              end={to === "/"}
              title={label}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon
                size={21}
                weight={location.pathname === to ? "duotone" : "regular"}
              />
              <span>{label}</span>
              {count ? (
                <span
                  className="nav-count"
                  aria-label={copy.nav.waiting(count)}
                >
                  {count}
                </span>
              ) : (
                <span className="nav-active-dot" />
              )}
            </NavLink>
          ))}
      </nav>
      <p className="sidebar-label roadmap-label">{copy.shell.roadmap}</p>
      <div className="planned-nav">
        {[{ icon: Wallet, label: copy.shell.payroll }].map(
          ({ icon: Icon, label }) => (
            <div key={label} title={copy.shell.planned(label)}>
              <Icon size={20} />
              <span>{label}</span>
              <span className="soon">{copy.shell.soon}</span>
            </div>
          ),
        )}
      </div>
      <div className="sidebar-bottom">
        <NavLink
          title={copy.nav.help}
          to="/help"
          prefetch="intent"
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
        >
          <Question size={20} />
          <span>{copy.nav.help}</span>
        </NavLink>
        <NavLink
          title="Display preferences"
          to="/preferences"
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
        >
          <SlidersHorizontal size={20} />
          <span>{copy.shell.preferences}</span>
        </NavLink>
        <Button
          className="sidebar-help"
          variant="ghost"
          aria-label={copy.shell.guide}
          onPress={() => setHelp(true)}
        >
          <Question size={20} />
          <span>{copy.shell.guide}</span>
          <kbd>?</kbd>
        </Button>
        <Button
          className="sidebar-user"
          variant="ghost"
          onPress={() => setRoles(true)}
          aria-label={copy.shell.switchRole}
        >
          <Avatar initials={initials} />
          <span>
            {me.name}
            <small>{roleLabels[me.role]}</small>
          </span>
          <CaretUpDown size={16} />
        </Button>
      </div>
    </>
  );
  return (
    <div
      className={`app-shell ${preferences.collapsed ? "nav-collapsed" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">{sidebar}</aside>
      <DialogPanel
        open={drawer}
        onOpenChange={setDrawer}
        title="Your workspace"
        className="mobile-nav-dialog"
      >
        <div className="mobile-nav-content">{sidebar}</div>
      </DialogPanel>
      <IdleGuard
        limitSeconds={me.idleLimitSeconds}
        onExpire={() => void expire()}
        onSignOut={() => void logout()}
      />
      <nav className="bottom-bar" aria-label={copy.nav.quick}>
        {QUICK.map((to) => links.find((link) => link.to === to))
          .filter((link) => link?.visible)
          .slice(0, 4)
          .map((link) => {
            const { to, label, icon: Icon, count } = link!;
            return (
              <NavLink
                key={to}
                to={to}
                prefetch="intent"
                end={to === "/"}
                className={({ isActive }) =>
                  `bottom-bar-item ${isActive ? "active" : ""}`
                }
              >
                <Icon
                  size={23}
                  weight={location.pathname === to ? "fill" : "regular"}
                />
                <span>{label}</span>
                {count ? (
                  <span
                    className="nav-count"
                    aria-label={copy.nav.waiting(count)}
                  >
                    {count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        <button
          type="button"
          className="bottom-bar-item"
          onClick={() => setDrawer(true)}
        >
          <DotsThree size={23} weight="bold" />
          <span>{copy.nav.more}</span>
        </button>
      </nav>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-context">
            <Button
              variant="icon"
              className="mobile-menu"
              aria-label={copy.shell.openNavigation}
              onPress={() => setDrawer(true)}
            >
              <List size={23} />
            </Button>
            <div className="breadcrumbs">
              <span>{copy.shell.workspace}</span>
              <span>/</span>
              <strong>{title}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <Button
              variant="ghost"
              className="global-search"
              onPress={() => setCommand(true)}
              aria-label={copy.shell.search}
            >
              <MagnifyingGlass size={18} />
              <span>{copy.shell.searchHint}</span>
              <kbd>⌘ K</kbd>
            </Button>
            <UpdatesBell employeeId={me.employeeId} />
            <span className="toolbar-divider" />
            <Button
              variant="icon"
              onPress={() => update({ mode: dark ? "light" : "dark" })}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </Button>
            <Button
              variant="icon"
              onPress={() => void logout()}
              aria-label={copy.shell.signOut}
            >
              <SignOut size={20} />
            </Button>
            <Button
              variant="icon"
              onPress={() => setRoles(true)}
              aria-label={copy.shell.yourRole}
            >
              <Avatar initials={initials} size="small" />
            </Button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="workspace-status">
            <span className="context-pill">
              <span className="status-dot" />
              {copy.shell.roleWorkspace(roleLabels[me.role])}
            </span>
            {me.demo && <span className="demo-label">{copy.shell.demo}</span>}
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
              <Button
                variant="icon"
                aria-label={copy.shell.dismissError}
                onPress={() => setError("")}
              >
                <X size={16} />
              </Button>
            </div>
          )}
          {brandingQuery.error ? (
            <ErrorState
              message={brandingQuery.error.message}
              onRetry={() => void brandingQuery.refetch()}
            />
          ) : !brand || busy ? (
            <LoadingState />
          ) : (
            <Outlet
              context={{ me, branding: brand, switchRole } satisfies Context}
            />
          )}
          <footer className="page-footer">
            <span>
              {brand?.platformName ?? "AnviOne"}
              <span className="footer-dot">/</span>Made for your people.
            </span>
            <span>Asia/Kolkata · {roleLabels[me.role]}</span>
          </footer>
        </main>
      </div>
      <Command open={command} setOpen={setCommand} me={me} />
      <DialogPanel
        open={roles}
        onOpenChange={setRoles}
        title="Choose your workspace"
      >
        <p className="muted">
          Signed in as {me.name}. Each role opens only its assigned workspace.
        </p>
        <div className="role-options">
          {me.roles.map((role) => (
            <Button
              key={role}
              variant="secondary"
              isDisabled={busy}
              onPress={() => void switchRole(role)}
            >
              {roleLabels[role]}
              <span>
                {role === me.role ? "Current" : <ArrowUpRight size={17} />}
              </span>
            </Button>
          ))}
        </div>
      </DialogPanel>
      <DialogPanel
        open={help}
        onOpenChange={setHelp}
        title="Make yourself at home"
      >
        <div className="guide-intro">
          <CommandIcon size={28} weight="duotone" />
          <p>
            Find colleagues and move between pages with <kbd>Ctrl / ⌘ K</kbd>.
          </p>
        </div>
        <dl className="guide-list">
          <div>
            <dt>Your workspace</dt>
            <dd>
              Use your avatar to switch between roles assigned to you. People
              and counts follow your current access.
            </dd>
          </div>
          <div>
            <dt>Your display</dt>
            <dd>
              Choose a light or dark theme, compact spacing and reduced motion
              in Display preferences.
            </dd>
          </div>
          <div>
            <dt>Keyboard shortcuts</dt>
            <dd>
              <kbd>Tab</kbd> moves focus. <kbd>Enter</kbd> opens an item.{" "}
              <kbd>Esc</kbd> closes a dialog. Arrow keys move between tabs.
            </dd>
          </div>
        </dl>
      </DialogPanel>
    </div>
  );
}
