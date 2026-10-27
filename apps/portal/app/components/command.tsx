import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { MagnifyingGlass as Search } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { ChartLineUp } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { Question } from "@phosphor-icons/react/dist/csr/Question";
import { GearSix as Settings } from "@phosphor-icons/react/dist/csr/GearSix";
import { SquaresFour as LayoutDashboard } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CalendarStar } from "@phosphor-icons/react/dist/csr/CalendarStar";
import { FolderLock } from "@phosphor-icons/react/dist/csr/FolderLock";
import { Laptop } from "@phosphor-icons/react/dist/csr/Laptop";
import { DoorOpen } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt";
import { IdentificationCard } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { Scroll } from "@phosphor-icons/react/dist/csr/Scroll";
import { DialogPanel, Button, Avatar, Input } from "@anvi/ui";
import { useDirectory } from "../lib/api";
import { copy } from "../lib/copy";
import type { Me } from "@anvi/contracts";
export function Command({
  open,
  setOpen,
  me,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
  me: Me;
}) {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, setOpen]);
  function go(path: string) {
    setOpen(false);
    setSearch("");
    void navigate(path);
  }
  return (
    <DialogPanel open={open} onOpenChange={setOpen} title="Find your way">
      <Input
        autoFocus
        aria-label="Search people and pages"
        placeholder="Search a name, team, or page"
        maxLength={80}
        icon={Search}
        value={search}
        onChange={setSearch}
        className="command-input"
      />
      <p className="eyebrow command-label">PAGES</p>
      <div className="command-results">
        <Button variant="ghost" onPress={() => go("/")}>
          <LayoutDashboard size={18} />
          {copy.nav.overview}
        </Button>
        {me.permissions.includes("directory.read") && (
          <Button variant="ghost" onPress={() => go("/people")}>
            <Users size={18} />
            {copy.nav.people}
          </Button>
        )}
        {me.permissions.includes("branding.write") && (
          <Button variant="ghost" onPress={() => go("/settings")}>
            <Settings size={18} />
            {copy.nav.settings}
          </Button>
        )}
        {me.permissions.includes("directory.read") && (
          <Button variant="ghost" onPress={() => go("/teams")}>
            <TreeStructure size={18} />
            {copy.nav.teams}
          </Button>
        )}
        {me.permissions.includes("audit.read") && (
          <Button variant="ghost" onPress={() => go("/activity")}>
            <ClockCounterClockwise size={18} />
            {copy.nav.activity}
          </Button>
        )}
        {me.permissions.includes("onboarding.manage") && (
          <Button variant="ghost" onPress={() => go("/candidates")}>
            <Users size={18} />
            {copy.nav.candidates}
          </Button>
        )}
        {me.permissions.includes("onboarding.task.update") && (
          <Button variant="ghost" onPress={() => go("/tasks")}>
            <ClipboardText size={18} />
            {copy.nav.tasks}
          </Button>
        )}
        {(me.permissions.includes("leave.request") ||
          me.permissions.includes("leave.approve")) && (
          <Button variant="ghost" onPress={() => go("/leave")}>
            <AirplaneTilt size={18} />
            {copy.nav.leave}
          </Button>
        )}
        {(me.permissions.includes("attendance.self") ||
          me.permissions.includes("attendance.review")) && (
          <Button variant="ghost" onPress={() => go("/attendance")}>
            <CalendarDots size={18} />
            {copy.nav.attendance}
          </Button>
        )}
        {(me.permissions.includes("policy.self") ||
          me.permissions.includes("policy.manage")) && (
          <Button variant="ghost" onPress={() => go("/policies")}>
            <Scroll size={18} />
            {copy.nav.policies}
          </Button>
        )}
        {me.permissions.includes("directory.read") && (
          <Button variant="ghost" onPress={() => go("/chart")}>
            <TreeStructure size={18} />
            {copy.nav.chart}
          </Button>
        )}
        {(me.permissions.includes("profile.self") ||
          me.permissions.includes("profile.review")) && (
          <Button variant="ghost" onPress={() => go("/details")}>
            <IdentificationCard size={18} />
            {copy.nav.details}
          </Button>
        )}
        {(me.permissions.includes("expense.self") ||
          me.permissions.includes("expense.approve") ||
          me.permissions.includes("expense.manage")) && (
          <Button variant="ghost" onPress={() => go("/expenses")}>
            <Receipt size={18} />
            {copy.nav.expenses}
          </Button>
        )}
        {(me.permissions.includes("exit.self") ||
          me.permissions.includes("exit.manage")) && (
          <Button variant="ghost" onPress={() => go("/exit")}>
            <DoorOpen size={18} />
            {copy.nav.exit}
          </Button>
        )}
        {(me.permissions.includes("asset.self") ||
          me.permissions.includes("asset.manage")) && (
          <Button variant="ghost" onPress={() => go("/assets")}>
            <Laptop size={18} />
            {copy.nav.assets}
          </Button>
        )}
        {(me.permissions.includes("document.self") ||
          me.permissions.includes("document.review")) && (
          <Button variant="ghost" onPress={() => go("/documents")}>
            <FolderLock size={18} />
            {copy.nav.documents}
          </Button>
        )}
        <Button variant="ghost" onPress={() => go("/calendar")}>
          <CalendarStar size={18} />
          {copy.nav.holidays}
        </Button>
        {me.permissions.includes("organization.read") && (
          <Button variant="ghost" onPress={() => go("/organization")}>
            <Buildings size={18} />
            {copy.nav.organization}
          </Button>
        )}
        {me.permissions.includes("insights.read") && (
          <Button variant="ghost" onPress={() => go("/insights")}>
            <ChartLineUp size={18} />
            {copy.nav.insights}
          </Button>
        )}
        <Button variant="ghost" onPress={() => go("/help")}>
          <Question size={18} />
          {copy.nav.help}
        </Button>
        <Button variant="ghost" onPress={() => go("/preferences")}>
          <SlidersHorizontal size={18} />
          {copy.shell.preferences}
        </Button>
      </div>
      {open && me.permissions.includes("directory.read") && (
        <PeopleResults search={search} go={go} />
      )}
      <p className="command-hint">Press Esc to close</p>
    </DialogPanel>
  );
}
function PeopleResults({
  search,
  go,
}: {
  search: string;
  go: (path: string) => void;
}) {
  const { data, isPending, error } = useDirectory(
    new URLSearchParams({ q: search, limit: "5" }).toString(),
  );
  return (
    <>
      <p className="eyebrow command-label">PEOPLE</p>
      <div className="command-results" aria-live="polite">
        {isPending ? (
          <p>Finding people…</p>
        ) : error ? (
          <p>Search is unavailable. Try again shortly.</p>
        ) : !data?.items.length ? (
          <p>No matches. Try another name.</p>
        ) : (
          data.items.map((person) => (
            <Button
              key={person.id}
              variant="ghost"
              onPress={() => go(`/people/${person.id}`)}
            >
              <Avatar initials={person.initials} size="small" />
              <span>
                {person.name}
                <small>{person.title}</small>
              </span>
            </Button>
          ))
        )}
      </div>
    </>
  );
}
