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
import {
  LayoutDashboard,
  Users,
  Settings,
  History,
  CalendarDays,
  Wallet,
  Boxes,
  ChevronsUpDown,
  Search,
  Sun,
  Moon,
  Menu,
  LogOut,
  ArrowUpRight,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  Avatar,
  Button,
  ErrorState,
  LoadingState,
  DialogPanel,
} from "@anvi/ui";
import { roleLabels, type Me, type Branding } from "@anvi/contracts";
import { ApiError, useMe, useBranding, mutate } from "../lib/api";
import { copy } from "../lib/copy";
import { Brand } from "../components/brand";
import { Command } from "../components/command";

type Context = {
  me: Me;
  branding: Branding;
  switchRole: (role: Me["role"]) => Promise<void>;
};
export const useWorkspace = () => useOutletContext<Context>();
export default function Workspace() {
  const meQuery = useMe();
  if (meQuery.error instanceof ApiError && meQuery.error.status === 401)
    return <Navigate to="/login" replace />;
  if (meQuery.error)
    return (
      <main className="standalone">
        <ErrorState
          message={meQuery.error.message}
          onRetry={() => void meQuery.refetch()}
        />
      </main>
    );
  if (!meQuery.data)
    return (
      <main className="standalone">
        <LoadingState />
      </main>
    );
  return <Shell me={meQuery.data} />;
}
function Shell({ me }: { me: Me }) {
  const brandingQuery = useBranding();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false),
    [command, setCommand] = useState(false),
    [roles, setRoles] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const preference = localStorage.getItem("anvi-mode");
    setDark(
      preference
        ? preference === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.mode = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (brandingQuery.data)
      document.documentElement.dataset.theme = brandingQuery.data.theme;
  }, [brandingQuery.data]);
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);
  async function switchRole(role: Me["role"]) {
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
  const title =
    location.pathname === "/people"
      ? copy.people
      : location.pathname.startsWith("/people/")
        ? "Employee profile"
        : location.pathname === "/settings"
          ? copy.settings
          : location.pathname === "/activity"
            ? copy.activity
            : copy.overview;
  const links = [
    { to: "/", label: copy.overview, icon: LayoutDashboard, visible: true },
    {
      to: "/people",
      label: copy.people,
      icon: Users,
      visible: me.permissions.includes("directory.read"),
    },
    {
      to: "/settings",
      label: copy.settings,
      icon: Settings,
      visible: me.permissions.includes("branding.write"),
    },
    {
      to: "/activity",
      label: copy.activity,
      icon: History,
      visible: me.permissions.includes("audit.read"),
    },
  ];
  const sidebar = (
    <>
      <div className="sidebar-brand">
        <Brand
          name={
            me.role === "employee" ? brand?.employeeName : brand?.platformName
          }
          light
        />
      </div>
      <div className="workspace-label">
        <span className="workspace-initial">A</span>
        <span>
          {brand?.organizationName ?? me.entityName}
          <small>People & possibilities</small>
        </span>
      </div>
      <p className="sidebar-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        {links
          .filter((l) => l.visible)
          .map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} />
              <span>{label}</span>
              {to === "/" && <span className="nav-active-dot" />}
            </NavLink>
          ))}
      </nav>
      <p className="sidebar-label roadmap-label">COMING NEXT</p>
      <div className="planned-nav">
        {[
          { icon: CalendarDays, label: "Time & leave" },
          { icon: Wallet, label: "Payroll & expenses" },
          { icon: Boxes, label: "Assets & policies" },
        ].map(({ icon: Icon, label }) => (
          <div key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <span className="soon">Soon</span>
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="privacy-note">
          <ShieldCheck size={22} />
          <p>
            A little more peace of mind.
            <span>Your workspace follows your access.</span>
          </p>
        </div>
        <Button
          className="sidebar-user"
          variant="ghost"
          onPress={() => setRoles(true)}
          aria-label="Switch workspace role"
        >
          <Avatar
            initials={me.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          />
          <span>
            {me.name}
            <small>{roleLabels[me.role]}</small>
          </span>
          <ChevronsUpDown size={16} />
        </Button>
      </div>
    </>
  );
  return (
    <div className="app-shell">
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
          <Button
            variant="icon"
            className="mobile-menu"
            aria-label="Open navigation"
            onPress={() => setDrawer(true)}
          >
            <Menu size={22} />
          </Button>
          <div className="breadcrumbs">
            <span>
              {me.role === "employee"
                ? copy.employeeHome
                : me.role === "manager"
                  ? copy.teamHome
                  : copy.hrHome}
            </span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              variant="ghost"
              className="global-search"
              onPress={() => setCommand(true)}
              aria-label="Search people and pages"
            >
              <Search size={17} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </Button>
            <span className="toolbar-divider" />
            <Button
              variant="icon"
              onPress={() => {
                setDark(!dark);
                localStorage.setItem("anvi-mode", dark ? "light" : "dark");
              }}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </Button>
            <Button
              variant="icon"
              onPress={() => void logout()}
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </Button>
            <Button
              variant="icon"
              onPress={() => setRoles(true)}
              aria-label="Your workspace role"
            >
              <Avatar
                initials={me.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
                size="small"
              />
            </Button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {me.demo && (
            <div className="demo-strip">
              <span>
                <span className="status-dot" />
                {copy.demo}
              </span>
              <span>{copy.demoDetail}</span>
            </div>
          )}
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
              {brand?.platformName ?? "AnviOne"} · A little closer, every day.
            </span>
            <span>
              Asia/Kolkata <span className="footer-dot">·</span>{" "}
              {roleLabels[me.role]} workspace
            </span>
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
          You stay signed in as {me.name}. Each workspace uses only its assigned
          access.
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
                {role === me.role ? "Current" : <ArrowUpRight size={16} />}
              </span>
            </Button>
          ))}
        </div>
      </DialogPanel>
    </div>
  );
}
