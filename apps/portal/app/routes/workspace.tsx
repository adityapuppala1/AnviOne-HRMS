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
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { CaretUpDown } from "@phosphor-icons/react/dist/csr/CaretUpDown";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { SidebarSimple } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
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
import { ApiError, useMe, useBranding, mutate } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { Brand } from "../components/brand";
import { Command } from "../components/command";

type Context = {
  me: Me;
  branding: Branding;
  switchRole: (role: Me["role"]) => Promise<void>;
};
export const useWorkspace = () => useOutletContext<Context>();
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
  const brand = brandingQuery.data;
  const links = [
    { to: "/", label: "Overview", icon: SquaresFour, visible: true },
    {
      to: "/people",
      label: "People directory",
      icon: Users,
      visible: me.permissions.includes("directory.read"),
    },
    {
      to: "/teams",
      label: "Team explorer",
      icon: TreeStructure,
      visible: me.permissions.includes("directory.read"),
    },
    {
      to: "/organization",
      label: "Organization",
      icon: Buildings,
      visible: me.permissions.includes("organization.read"),
    },
    {
      to: "/settings",
      label: "Workspace settings",
      icon: GearSix,
      visible: me.permissions.includes("branding.write"),
    },
    {
      to: "/activity",
      label: "Activity log",
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
          <small>Your people workspace</small>
        </span>
      </div>
      <p className="sidebar-label">Workspace</p>
      <nav aria-label="Main navigation">
        {links
          .filter((link) => link.visible)
          .map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
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
              <span className="nav-active-dot" />
            </NavLink>
          ))}
      </nav>
      <p className="sidebar-label roadmap-label">On the roadmap</p>
      <div className="planned-nav">
        {[
          { icon: CalendarDots, label: "Time & leave" },
          { icon: Wallet, label: "Payroll & expenses" },
          { icon: Stack, label: "Assets & policies" },
        ].map(({ icon: Icon, label }) => (
          <div key={label} title={`${label} · planned`}>
            <Icon size={20} />
            <span>{label}</span>
            <span className="soon">Soon</span>
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <NavLink
          title="Display preferences"
          to="/preferences"
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
        >
          <SlidersHorizontal size={20} />
          <span>Display preferences</span>
        </NavLink>
        <Button
          className="sidebar-help"
          variant="ghost"
          aria-label="Workspace guide"
          onPress={() => setHelp(true)}
        >
          <Question size={20} />
          <span>Workspace guide</span>
          <kbd>?</kbd>
        </Button>
        <Button
          className="sidebar-user"
          variant="ghost"
          onPress={() => setRoles(true)}
          aria-label="Switch workspace role"
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
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-context">
            <Button
              variant="icon"
              className="mobile-menu"
              aria-label="Open navigation"
              onPress={() => setDrawer(true)}
            >
              <List size={23} />
            </Button>
            <div className="breadcrumbs">
              <span>Workspace</span>
              <span>/</span>
              <strong>{title}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <Button
              variant="ghost"
              className="global-search"
              onPress={() => setCommand(true)}
              aria-label="Search people and pages"
            >
              <MagnifyingGlass size={18} />
              <span>Search people or pages</span>
              <kbd>⌘ K</kbd>
            </Button>
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
              aria-label="Sign out"
            >
              <SignOut size={20} />
            </Button>
            <Button
              variant="icon"
              onPress={() => setRoles(true)}
              aria-label="Your workspace role"
            >
              <Avatar initials={initials} size="small" />
            </Button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="workspace-status">
            <span className="context-pill">
              <span className="status-dot" />
              {roleLabels[me.role]} workspace
            </span>
            {me.demo && (
              <span className="demo-label">Demo · Synthetic employee data</span>
            )}
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
              <Button
                variant="icon"
                aria-label="Dismiss error"
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
