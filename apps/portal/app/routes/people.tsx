import { Link, useSearchParams } from "react-router";
import { MagnifyingGlass as Search } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { SquaresFour as LayoutGrid } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { CaretLeft as ChevronLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight as ChevronRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Button,
  DataCard,
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  type Column,
} from "@anvi/ui";
import type { Employee } from "@anvi/contracts";
import { useDirectory } from "../lib/api";
import { copy } from "../lib/copy";
import { peopleCopy as text, profileCopy } from "../lib/copy/screens";
import { PersonCard } from "../components/people";
import { useWorkspace } from "./workspace";
const columns: Column<Employee>[] = [
  {
    id: "name",
    label: text.list.name,
    isRowHeader: true,
    render: (p) => (
      <Link className="text-link" to={`/people/${p.id}`}>
        {p.name}
      </Link>
    ),
  },
  {
    id: "title",
    label: text.list.role,
    render: (p) => p.title,
  },
  {
    id: "department",
    label: text.list.team,
    render: (p) => (
      <StatusBadge color="gray" size="sm">
        {p.department}
      </StatusBadge>
    ),
  },
  {
    id: "location",
    label: text.list.location,
    render: (p) => p.location,
  },
  {
    id: "status",
    label: text.list.status,
    render: (p) => (
      <StatusBadge
        color={p.status === "active" ? "success" : "warning"}
        size="sm"
      >
        {p.status === "active"
          ? profileCopy.status.active
          : profileCopy.status.notice}
      </StatusBadge>
    ),
  },
];

export default function People() {
  const { me } = useWorkspace();
  if (!me.permissions.includes("directory.read"))
    return <ErrorState message={text.noAccess} />;
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
      <PageHeader
        eyebrow={text.eyebrow}
        title={copy.peopleTitle}
        description={copy.peopleSubtitle}
        actions={
          <div className="directory-emblem" aria-hidden="true">
            <Users size={28} />
          </div>
        }
      ></PageHeader>
      <section className="directory-panel">
        <div className="directory-toolbar">
          <label className="search-box">
            <Search size={18} />
            <input
              aria-label={text.searchLabel}
              placeholder={text.searchPlaceholder}
              maxLength={80}
              value={params.get("q") ?? ""}
              onChange={(event) => filter("q", event.target.value)}
            />
          </label>
          <div className="directory-filters">
            <SlidersHorizontal size={16} />
            <label className="sr-only" htmlFor="department">
              {text.department}
            </label>
            <select
              id="department"
              value={params.get("department") ?? ""}
              onChange={(e) => filter("department", e.target.value)}
            >
              <option value="">{text.allDepartments}</option>
              {data?.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="location">
              {text.location}
            </label>
            <select
              id="location"
              value={params.get("location") ?? ""}
              onChange={(e) => filter("location", e.target.value)}
            >
              <option value="">{text.allLocations}</option>
              {data?.locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="directory-meta">
          <div aria-live="polite">
            <strong>{text.total(data?.total)}</strong>
            <span>{text.workspaceSuffix}</span>
            {filtered && (
              <Button variant="ghost" onPress={() => void setParams({})}>
                {text.clearFilters} <X size={14} />
              </Button>
            )}
          </div>
          <div className="view-toggle" aria-label={text.displayLabel}>
            <Button
              variant="icon"
              aria-label={text.gridView}
              aria-pressed={view === "grid"}
              onPress={() => setView("grid")}
            >
              <LayoutGrid size={17} />
            </Button>
            <Button
              variant="icon"
              aria-label={text.listView}
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
          <EmptyBlock
            icon={Users}
            title={copy.noPeople}
            description={copy.noPeopleDetail}
            action={
              <Button variant="secondary" onPress={() => void setParams({})}>
                {text.clearFilters}
              </Button>
            }
          />
        ) : view === "grid" ? (
          <div className="people-grid">
            {data.items.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        ) : (
          <DataCard
            title={text.list.title}
            label={text.list.label}
            columns={columns}
            rows={data.items}
            getKey={(person) => person.id}
            pageSize={8}
            empty={null}
            mobileRow={(person) => (
              <Link className="person-row" to={`/people/${person.id}`}>
                <span className="person-info">
                  <strong>{person.name}</strong>
                  <span>{person.title}</span>
                </span>
                <StatusBadge color="gray" size="sm">
                  {person.department}
                </StatusBadge>
              </Link>
            )}
          />
        )}
        <div className="pagination">
          <p>{text.page(data?.page ?? 1, data?.pages ?? 1)}</p>
          <div>
            <Button
              variant="secondary"
              aria-label={text.previousLabel}
              isDisabled={!data || data.page <= 1}
              onPress={() => filter("page", String((data?.page ?? 1) - 1))}
            >
              <ChevronLeft size={16} />
              {text.previous}
            </Button>
            <Button
              variant="secondary"
              aria-label={text.nextLabel}
              isDisabled={!data || data.page >= data.pages}
              onPress={() => filter("page", String((data?.page ?? 1) + 1))}
            >
              {text.next}
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
