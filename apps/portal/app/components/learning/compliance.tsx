import { useState } from "react";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { CollectionView, ErrorState, type Column } from "@anvi/ui";
import type { LrnCompliance } from "@anvi/contracts";
import { useLrnCompliance } from "../../lib/learning-api";
import { learningCopy as text } from "../../lib/copy/learning";
import { FilterSelect, StatusPill, courseColor, dateOnly } from "./shared";

type Row = LrnCompliance["items"][number];
const copy = text.compliance;
const courseStatuses = Object.keys(text.courseStatus) as Row["courseStatus"][];

const segments = [
  { key: "completed", label: copy.columns.completed, tone: "ok" },
  { key: "inProgress", label: copy.columns.inProgress, tone: "brand" },
  { key: "notStarted", label: copy.columns.notStarted, tone: "idle" },
  { key: "overdue", label: copy.columns.overdue, tone: "bad" },
  { key: "waived", label: copy.columns.waived, tone: "gray" },
] as const;

const total = (row: Row) =>
  row.notStarted + row.inProgress + row.overdue + row.completed + row.waived;

// A plain stacked bar. It is decoration: every number is also written out in text below it.
function Bars({ row }: { row: Row }) {
  const sum = total(row);
  return (
    <div className="flex flex-col gap-2">
      <div className="lrn-bar" aria-hidden="true">
        {sum > 0 &&
          segments.map((s) =>
            row[s.key] > 0 ? (
              <span
                key={s.key}
                className="lrn-bar-seg"
                data-tone={s.tone}
                style={{ width: `${(row[s.key] / sum) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <p className="recruit-muted">
        {sum === 0 ? copy.noAssignments : copy.total(sum)}
      </p>
      <dl className="lrn-counts">
        {segments.map((s) => (
          <div key={s.key} data-tone={s.tone}>
            <dt>{s.label}</dt>
            <dd>{row[s.key]}</dd>
          </div>
        ))}
        <div>
          <dt>{copy.columns.dueForRenewal}</dt>
          <dd>{row.dueForRenewal}</dd>
        </div>
        <div>
          <dt>{copy.columns.expired}</dt>
          <dd>{row.expired}</dd>
        </div>
      </dl>
    </div>
  );
}

const columns: Column<Row>[] = [
  {
    id: "course",
    label: copy.columns.course,
    isRowHeader: true,
    sortValue: (row) => row.courseTitle,
    render: (row) => (
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm text-primary">{row.courseTitle}</strong>
        <span className="text-sm text-tertiary">
          {row.courseCode}
          {row.mandatory ? ` · ${copy.mandatory}` : ""}
        </span>
      </span>
    ),
  },
  ...(
    [
      ["notStarted", copy.columns.notStarted],
      ["inProgress", copy.columns.inProgress],
      ["overdue", copy.columns.overdue],
      ["completed", copy.columns.completed],
      ["waived", copy.columns.waived],
      ["dueForRenewal", copy.columns.dueForRenewal],
      ["expired", copy.columns.expired],
    ] as const
  ).map(([key, label]) => ({
    id: key,
    label,
    sortValue: (row: Row) => row[key],
    render: (row: Row) => <span className="text-sm">{row[key]}</span>,
  })),
];

export function ComplianceTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const query = new URLSearchParams({ page: String(page), limit: "10" });
  if (status !== "all") query.set("status", status);
  const list = useLrnCompliance(true, query.toString());
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const filtered = status !== "all";
  return (
    <div className="perf-tab lrn-tab">
      <div>
        <h2 className="lrn-h2">{copy.title}</h2>
        <p className="recruit-muted">{copy.intro}</p>
        {list.data && (
          <p className="recruit-muted">{copy.asOf(dateOnly(list.data.asOf))}</p>
        )}
      </div>
      <div className="recruit-filters">
        <FilterSelect
          label={copy.filter}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          allLabel={copy.allStatuses}
          options={courseStatuses.map((id) => ({
            id,
            label: text.courseStatus[id],
          }))}
        />
      </div>
      <CollectionView
        id="lrn-compliance"
        label={copy.label}
        noun="courses"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(row) => row.courseId}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={ChartBar}
        emptyTitle={filtered ? copy.emptyFiltered : copy.empty}
        emptyDescription={copy.emptyBody}
        onClearFilters={
          filtered
            ? () => {
                setStatus("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(row) => (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <strong className="break-words text-primary">
                  {row.courseTitle}
                </strong>
                <span className="text-sm text-tertiary">
                  {row.courseCode}
                  {row.mandatory ? ` · ${copy.mandatory}` : ""}
                </span>
              </span>
              <StatusPill
                label={text.courseStatus[row.courseStatus]}
                color={courseColor[row.courseStatus]}
              />
            </div>
            <Bars row={row} />
          </div>
        )}
      />
    </div>
  );
}
