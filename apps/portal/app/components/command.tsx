import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Users, Settings, LayoutDashboard } from "lucide-react";
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
