import { useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Funnel } from "@phosphor-icons/react/dist/csr/Funnel";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Badge,
  Button,
  CollectionView,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from "@anvi/ui";
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
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.subtitle}
        actions={
          <Badge>
            <Fingerprint size={15} />
            {text.readOnly}
          </Badge>
        }
      ></PageHeader>
      <section className="panel audit-panel">
        <div className="directory-toolbar">
          <Input
            aria-label={text.search}
            placeholder={text.searchPlaceholder}
            icon={MagnifyingGlass}
            value={search}
            onChange={setSearch}
            className="kit-search"
          />
          <Select
            aria-label={text.type}
            icon={Funnel}
            selectedKey={filter}
            onSelectionChange={(key) => setFilter(String(key))}
            className="kit-filter"
          >
            {Object.entries(text.filters).map(([value, label]) => (
              <Select.Item key={value} id={value} label={label} />
            ))}
          </Select>
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
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : !data ? (
          <LoadingState />
        ) : !events?.length ? (
          <EmptyBlock
            icon={ClockCounterClockwise}
            title={data.length ? text.noMatch : text.empty}
            description={data.length ? text.noMatchDetail : text.emptyDetail}
          />
        ) : (
          <CollectionView
            id="activity"
            label={text.tableLabel}
            noun="events"
            items={events}
            getKey={(item) => item.id}
            defaultView="table"
            openKey={selected}
            onOpenKeyChange={setSelected}
            note={text.latestOnly}
            columns={[
              {
                id: "action",
                label: text.columns.action,
                isRowHeader: true,
                sortValue: (item) => actionNames[item.action] ?? item.action,
                render: (item) => (
                  <h2 className="text-sm font-medium text-primary">
                    {actionNames[item.action] ?? item.action}
                  </h2>
                ),
              },
              {
                id: "actor",
                label: text.columns.actor,
                sortValue: (item) => item.actor,
                render: (item) => (
                  <span className="text-sm text-tertiary">
                    {item.actor} · {item.role.replaceAll("_", " ")}
                  </span>
                ),
              },
              {
                id: "record",
                label: text.columns.record,
                render: (item) => (
                  <span className="text-sm text-tertiary">{item.target}</span>
                ),
              },
              {
                id: "when",
                label: text.columns.when,
                sortValue: (item) => item.occurredAt,
                render: (item) => (
                  <time dateTime={item.occurredAt} className="text-sm">
                    {formatDate(item.occurredAt)}
                  </time>
                ),
              },
              {
                id: "view",
                label: "",
                render: (item) => (
                  <Button
                    variant="icon"
                    aria-label={text.viewEvent(item.id)}
                    onPress={() => setSelected(item.id)}
                  >
                    <ArrowUpRight size={18} />
                  </Button>
                ),
              },
            ]}
            renderCard={(item) => (
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-primary">
                  {actionNames[item.action] ?? item.action}
                </h2>
                <p className="text-sm text-tertiary">
                  {item.actor} · {item.role.replaceAll("_", " ")}
                </p>
                <small className="block break-words text-tertiary">
                  {item.target}
                </small>
                <time dateTime={item.occurredAt} className="text-xs">
                  {formatDate(item.occurredAt)}
                </time>
              </div>
            )}
            detail={{
              title: () => text.details,
              subtitle: (item) => actionNames[item.action] ?? item.action,
              body: (item) => (
                <dl className="event-details">
                  {[
                    { name: text.fields.actor, value: item.actor },
                    {
                      name: text.fields.role,
                      value: item.role.replaceAll("_", " "),
                    },
                    { name: text.fields.record, value: item.target },
                    {
                      name: text.fields.when,
                      value: formatDate(item.occurredAt),
                    },
                    { name: text.fields.eventId, value: item.id },
                    { name: text.fields.requestId, value: item.requestId },
                    ...(item.reason
                      ? [{ name: text.fields.reason, value: item.reason }]
                      : []),
                  ].map((field) => (
                    <div key={field.name}>
                      <dt>{field.name}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ),
            }}
          />
        )}
      </section>
    </div>
  );
}
