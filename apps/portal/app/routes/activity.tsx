import { useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Funnel } from "@phosphor-icons/react/dist/csr/Funnel";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Badge, Button, DialogPanel, ErrorState, LoadingState } from "@anvi/ui";
import { useAudit } from "../lib/api";
import { useWorkspace } from "./workspace";
const actionNames: Record<string, string> = {
  "session.started": "Signed in",
  "session.ended": "Signed out",
  "session.role_changed": "Changed workspace role",
  "branding.published": "Published workspace settings",
};
const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(date));
export default function Activity() {
  const { me } = useWorkspace();
  return me.permissions.includes("audit.read") ? (
    <ActivityLog />
  ) : (
    <ErrorState message="Activity history requires an assigned Auditor workspace." />
  );
}
function ActivityLog() {
  const { data, error, refetch } = useAudit();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string | null>(null);
  const events = data?.filter(
    (event) =>
      (filter === "all" || event.action.startsWith(filter)) &&
      `${actionNames[event.action] ?? event.action} ${event.actor} ${event.role} ${event.target}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const event = data?.find((item) => item.id === selected);
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace record</p>
          <h1>A clear view of every change.</h1>
          <p>Search the latest 50 recorded actions · Times in Asia/Kolkata.</p>
        </div>
        <Badge>
          <Fingerprint size={15} />
          Read only
        </Badge>
      </div>
      <section className="panel audit-panel">
        <div className="directory-toolbar">
          <label className="search-box">
            <MagnifyingGlass size={19} />
            <input
              aria-label="Search activity"
              placeholder="Search actions, people or records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="activity-filter">
            <Funnel size={18} />
            <span className="sr-only">Activity type</span>
            <select
              aria-label="Activity type"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All activity</option>
              <option value="session.">Access & sessions</option>
              <option value="branding.">Workspace settings</option>
            </select>
          </label>
        </div>
        <div className="audit-summary">
          <span aria-live="polite">
            {events?.length ?? "…"} {events?.length === 1 ? "event" : "events"}{" "}
            shown
          </span>
          {(search || filter !== "all") && (
            <Button
              variant="ghost"
              onPress={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
              <X size={14} />
            </Button>
          )}
          <Badge>Latest 50 only</Badge>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : !data ? (
          <LoadingState />
        ) : !events?.length ? (
          <div className="state-card">
            <ClockCounterClockwise size={30} />
            <h2>{data.length ? "No matching activity" : "A fresh start"}</h2>
            <p>
              {data.length
                ? "Try another search or clear your filters."
                : "Recorded actions will appear as your workspace is used."}
            </p>
          </div>
        ) : (
          <div className="activity-list">
            {events.map((item) => (
              <article className="activity-event" key={item.id}>
                <span
                  className={`activity-icon ${item.action.startsWith("branding.") ? "event-brand" : ""}`}
                >
                  <ClockCounterClockwise size={20} weight="duotone" />
                </span>
                <div className="activity-info">
                  <h2>{actionNames[item.action] ?? item.action}</h2>
                  <p>
                    {item.actor}
                    <span> · {item.role.replaceAll("_", " ")}</span>
                  </p>
                  <small>{item.target}</small>
                </div>
                <time dateTime={item.occurredAt}>
                  {formatDate(item.occurredAt)}
                </time>
                <Button
                  variant="icon"
                  aria-label={`View event ${item.id}`}
                  onPress={() => setSelected(item.id)}
                >
                  <ArrowUpRight size={18} />
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>
      <DialogPanel
        open={Boolean(event)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="Activity details"
      >
        {event && (
          <>
            <Badge>{actionNames[event.action] ?? event.action}</Badge>
            <dl className="event-details">
              {[
                { name: "Actor", value: event.actor },
                { name: "Role", value: event.role.replaceAll("_", " ") },
                { name: "Record", value: event.target },
                { name: "When", value: formatDate(event.occurredAt) },
                { name: "Event ID", value: event.id },
                { name: "Request ID", value: event.requestId },
              ].map((field) => (
                <div key={field.name}>
                  <dt>{field.name}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </DialogPanel>
    </div>
  );
}
