import { useSearchParams } from "react-router";
import { MagnifyingGlass as Search } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { SquaresFour as LayoutGrid } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { CaretLeft as ChevronLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight as ChevronRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Button, ErrorState, LoadingState } from "@anvi/ui";
import { useDirectory } from "../lib/api";
import { copy } from "../lib/copy";
import { PersonCard, PersonRow } from "../components/people";
import { useWorkspace } from "./workspace";
export default function People() {
  const { me } = useWorkspace();
  if (!me.permissions.includes("directory.read"))
    return (
      <ErrorState message="This workspace does not include access to the people directory. Choose an assigned people workspace to continue." />
    );
  return <Directory />;
}
function Directory() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "grid";
  function setView(next: "grid" | "list") {
    const updated = new URLSearchParams(params);
    if (next === "list") updated.set("view", "list");
    else updated.delete("view");
    void setParams(updated, { replace: true });
  }
  const query = new URLSearchParams({
    q: params.get("q") ?? "",
    department: params.get("department") ?? "",
    location: params.get("location") ?? "",
    page: params.get("page") ?? "1",
    limit: "8",
  });
  const { data, error, isPending, refetch } = useDirectory(query.toString());
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    void setParams(next, { replace: true });
  }
  const filtered =
    params.has("q") || params.has("department") || params.has("location");
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">People directory</p>
          <h1>{copy.peopleTitle}</h1>
          <p>{copy.peopleSubtitle}</p>
        </div>
        <div className="directory-emblem" aria-hidden="true">
          <Users size={28} />
        </div>
      </div>
      <section className="directory-panel">
        <div className="directory-toolbar">
          <label className="search-box">
            <Search size={18} />
            <input
              aria-label="Search directory"
              placeholder="Search by name, role, or team…"
              maxLength={80}
              value={params.get("q") ?? ""}
              onChange={(event) => filter("q", event.target.value)}
            />
          </label>
          <div className="directory-filters">
            <SlidersHorizontal size={16} />
            <label className="sr-only" htmlFor="department">
              Department
            </label>
            <select
              id="department"
              value={params.get("department") ?? ""}
              onChange={(e) => filter("department", e.target.value)}
            >
              <option value="">All departments</option>
              {data?.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="location">
              Location
            </label>
            <select
              id="location"
              value={params.get("location") ?? ""}
              onChange={(e) => filter("location", e.target.value)}
            >
              <option value="">All locations</option>
              {data?.locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="directory-meta">
          <div aria-live="polite">
            <strong>
              {data?.total ?? "…"} {data?.total === 1 ? "person" : "people"}
            </strong>
            <span> · Your current workspace</span>
            {filtered && (
              <Button variant="ghost" onPress={() => void setParams({})}>
                Clear filters <X size={14} />
              </Button>
            )}
          </div>
          <div className="view-toggle" aria-label="Directory display">
            <Button
              variant="icon"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onPress={() => setView("grid")}
            >
              <LayoutGrid size={17} />
            </Button>
            <Button
              variant="icon"
              aria-label="List view"
              aria-pressed={view === "list"}
              onPress={() => setView("list")}
            >
              <List size={18} />
            </Button>
          </div>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : isPending ? (
          <LoadingState />
        ) : !data?.items.length ? (
          <div className="state-card">
            <Users size={28} />
            <h2>{copy.noPeople}</h2>
            <p>{copy.noPeopleDetail}</p>
            <Button variant="secondary" onPress={() => void setParams({})}>
              Clear filters
            </Button>
          </div>
        ) : (
          <div className={view === "grid" ? "people-grid" : "directory-list"}>
            {data.items.map((person) =>
              view === "grid" ? (
                <PersonCard key={person.id} person={person} />
              ) : (
                <PersonRow key={person.id} person={person} />
              ),
            )}
          </div>
        )}
        <div className="pagination">
          <p>
            Page {data?.page ?? 1} of {data?.pages ?? 1}
          </p>
          <div>
            <Button
              variant="secondary"
              aria-label="Previous page"
              isDisabled={!data || data.page <= 1}
              onPress={() => filter("page", String((data?.page ?? 1) - 1))}
            >
              <ChevronLeft size={16} />
              Previous
            </Button>
            <Button
              variant="secondary"
              aria-label="Next page"
              isDisabled={!data || data.page >= data.pages}
              onPress={() => filter("page", String((data?.page ?? 1) + 1))}
            >
              Next
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      <p className="directory-privacy">
        <span className="status-dot" />
        {copy.profileNotice}
      </p>
    </div>
  );
}
