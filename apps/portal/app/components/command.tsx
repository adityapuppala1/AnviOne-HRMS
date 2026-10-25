import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { MagnifyingGlass as Search } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { GearSix as Settings } from "@phosphor-icons/react/dist/csr/GearSix";
import { SquaresFour as LayoutDashboard } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { DialogPanel, Button, Avatar } from "@anvi/ui";
import { useDirectory } from "../lib/api";
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
      <label className="search-box command-input">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search people and pages"
          placeholder="Search a name, team, or page"
          maxLength={80}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <p className="eyebrow command-label">PAGES</p>
      <div className="command-results">
        <Button variant="ghost" onPress={() => go("/")}>
          <LayoutDashboard size={18} />
          Overview
        </Button>
        {me.permissions.includes("directory.read") && (
          <Button variant="ghost" onPress={() => go("/people")}>
            <Users size={18} />
            People directory
          </Button>
        )}
        {me.permissions.includes("branding.write") && (
          <Button variant="ghost" onPress={() => go("/settings")}>
            <Settings size={18} />
            Workspace settings
          </Button>
        )}
        {me.permissions.includes("directory.read") && (
          <Button variant="ghost" onPress={() => go("/teams")}>
            <TreeStructure size={18} />
            Team explorer
          </Button>
        )}
        {me.permissions.includes("audit.read") && (
          <Button variant="ghost" onPress={() => go("/activity")}>
            <ClockCounterClockwise size={18} />
            Activity log
          </Button>
        )}
        {me.permissions.includes("onboarding.manage") && (
          <Button variant="ghost" onPress={() => go("/candidates")}>
            <Users size={18} />
            Candidate intake
          </Button>
        )}
        {me.permissions.includes("onboarding.task.update") && (
          <Button variant="ghost" onPress={() => go("/tasks")}>
            <ClipboardText size={18} />
            My onboarding tasks
          </Button>
        )}
        {(me.permissions.includes("leave.request") ||
          me.permissions.includes("leave.approve")) && (
          <Button variant="ghost" onPress={() => go("/leave")}>
            <AirplaneTilt size={18} />
            Leave
          </Button>
        )}
        {(me.permissions.includes("attendance.self") ||
          me.permissions.includes("attendance.review")) && (
          <Button variant="ghost" onPress={() => go("/attendance")}>
            <CalendarDots size={18} />
            Attendance
          </Button>
        )}
        {me.permissions.includes("organization.read") && (
          <Button variant="ghost" onPress={() => go("/organization")}>
            <Buildings size={18} />
            Organization
          </Button>
        )}
        <Button variant="ghost" onPress={() => go("/preferences")}>
          <SlidersHorizontal size={18} />
          Display preferences
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
