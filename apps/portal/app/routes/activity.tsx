import { useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Funnel } from "@phosphor-icons/react/dist/csr/Funnel";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Badge, Button, DialogPanel, ErrorState, LoadingState } from "@anvi/ui";
import { useAudit } from "../lib/api";
import { copy } from "../lib/copy";
import { useWorkspace } from "./workspace";
const text = copy.activityLog;
const actionNames = text.actions;
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
    <ErrorState message={text.denied} />
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
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <Badge>
          <Fingerprint size={15} />
          {text.readOnly}
        </Badge>
      </div>
      <section className="panel audit-panel">
        <div className="directory-toolbar">
          <label className="search-box">
            <MagnifyingGlass size={19} />
            <input
              aria-label={text.search}
              placeholder={text.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="activity-filter">
            <Funnel size={18} />
            <span className="sr-only">{text.type}</span>
            <select
              aria-label={text.type}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {Object.entries(text.filters).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="audit-summary">
          <span aria-live="polite">{text.shown(events?.length)}</span>
          {(search || filter !== "all") && (
            <Button
              variant="ghost"
              onPress={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              {text.clearFilters}
              <X size={14} />
            </Button>
          )}
          <Badge>{text.latestOnly}</Badge>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : !data ? (
          <LoadingState />
        ) : !events?.length ? (
          <div className="state-card">
            <ClockCounterClockwise size={30} />
            <h2>{data.length ? text.noMatch : text.empty}</h2>
            <p>{data.length ? text.noMatchDetail : text.emptyDetail}</p>
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
                  aria-label={text.viewEvent(item.id)}
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
        title={text.details}
      >
        {event && (
          <>
            <Badge>{actionNames[event.action] ?? event.action}</Badge>
            <dl className="event-details">
              {[
                { name: text.fields.actor, value: event.actor },
                {
                  name: text.fields.role,
                  value: event.role.replaceAll("_", " "),
                },
                { name: text.fields.record, value: event.target },
                { name: text.fields.when, value: formatDate(event.occurredAt) },
                { name: text.fields.eventId, value: event.id },
                { name: text.fields.requestId, value: event.requestId },
                ...(event.reason
                  ? [{ name: text.fields.reason, value: event.reason }]
                  : []),
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
