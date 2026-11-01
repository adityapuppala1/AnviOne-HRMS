import { useState } from "react";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import {
  CollectionView,
  EmptyBlock,
  ErrorState,
  LoadingState,
  Select,
  StatCard,
  type Column,
} from "@anvi/ui";
import type { RecruitFunnel } from "@anvi/contracts";
import { useRecruitFunnel, useRecruitRequisitions } from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import { StatusPill, requisitionColor } from "./shared";

const copy = text.funnel;
type Row = RecruitFunnel["perRequisition"][number];

const columns: Column<Row>[] = [
  {
    id: "role",
    label: copy.perRequisitionColumns.role,
    isRowHeader: true,
    sortValue: (row) => row.title,
    render: (row) => (
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm text-primary">{row.title}</strong>
        <span className="text-sm text-tertiary">{row.code}</span>
      </span>
    ),
  },
  {
    id: "status",
    label: copy.perRequisitionColumns.status,
    render: (row) => (
      <StatusPill
        label={text.requisition.status[row.status]}
        color={requisitionColor[row.status] ?? "gray"}
      />
    ),
  },
  {
    id: "applications",
    label: copy.perRequisitionColumns.applications,
    sortValue: (row) => row.applications,
    render: (row) => <span className="text-sm">{row.applications}</span>,
  },
  {
    id: "filled",
    label: copy.perRequisitionColumns.filled,
    sortValue: (row) => row.filledCount,
    render: (row) => (
      <span className="text-sm">
        {text.requisition.cardHeadcount(row.filledCount, row.headcount)}
      </span>
    ),
  },
];

function Bar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const width =
    max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className="recruit-bar" role="img" aria-label={label}>
      <span style={{ width: `${width}%` }} />
    </span>
  );
}

export function FunnelTab() {
  const [requisitionId, setRequisitionId] = useState("");
  const requisitions = useRecruitRequisitions(true, "limit=100");
  const funnel = useRecruitFunnel(true, requisitionId);
  if (funnel.error)
    return (
      <ErrorState
        message={funnel.error.message}
        onRetry={() => void funnel.refetch()}
      />
    );
  if (!funnel.data) return <LoadingState />;
  const data = funnel.data;
  const maxStage = Math.max(0, ...data.stages.map((s) => s.reached));
  const maxSource = Math.max(0, ...data.sources.map((s) => s.count));
  return (
    <div className="recruit-tab">
      <div className="recruit-toolbar">
        <p className="recruit-muted">{copy.note}</p>
        <Select
          aria-label={copy.requisition}
          selectedKey={requisitionId || "all"}
          onSelectionChange={(key) =>
            setRequisitionId(key === "all" ? "" : String(key))
          }
          className="kit-filter"
        >
          <Select.Item id="all" label={copy.all} />
          {(requisitions.data?.items ?? []).map((row) => (
            <Select.Item
              key={row.id}
              id={row.id}
              label={`${row.code} ${row.title}`}
            />
          ))}
        </Select>
      </div>
      <div className="leave-stats">
        <StatCard
          label={copy.stats.applications}
          value={data.totalApplications}
          hint={copy.stats.applicationsHint}
          icon={Users}
        />
        <StatCard
          label={copy.stats.open}
          value={data.requisitions.open}
          hint={copy.stats.openHint}
          icon={Briefcase}
        />
        <StatCard
          label={copy.stats.headcount}
          value={data.requisitions.openHeadcount}
          hint={copy.stats.headcountHint}
          icon={ChartBar}
        />
        <StatCard
          label={copy.stats.filled}
          value={data.requisitions.filled}
          hint={copy.stats.filledHint}
          icon={CheckCircle}
        />
      </div>
      {data.totalApplications === 0 ? (
        <EmptyBlock
          icon={ChartBar}
          title={copy.noData}
          description={copy.noDataBody}
        />
      ) : (
        <div className="recruit-funnel-grid">
          <section
            className="panel recruit-funnel-panel"
            aria-labelledby="funnel-stages"
          >
            <h3 id="funnel-stages">{copy.stages}</h3>
            <ul>
              {data.stages.map((row) => (
                <li key={row.stage}>
                  <div className="recruit-funnel-head">
                    <strong>{text.pipeline.stage[row.stage]}</strong>
                    <span>
                      {copy.reached(row.reached)} · {copy.current(row.current)}
                    </span>
                  </div>
                  <Bar
                    value={row.reached}
                    max={maxStage}
                    label={copy.barLabel(
                      text.pipeline.stage[row.stage],
                      row.reached,
                    )}
                  />
                  <span className="recruit-muted">
                    {copy.conversion(row.conversionPercent)} ·{" "}
                    {copy.average(row.averageDaysInStage)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section
            className="panel recruit-funnel-panel"
            aria-labelledby="funnel-sources"
          >
            <h3 id="funnel-sources">{copy.sources}</h3>
            <ul>
              {data.sources.map((row) => (
                <li key={row.source}>
                  <div className="recruit-funnel-head">
                    <strong>{text.candidates.sources[row.source]}</strong>
                    <span>{row.count}</span>
                  </div>
                  <Bar
                    value={row.count}
                    max={maxSource}
                    label={copy.barLabel(
                      text.candidates.sources[row.source],
                      row.count,
                    )}
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {data.perRequisition.length > 0 && (
        <section aria-labelledby="funnel-requisitions" className="recruit-tab">
          <h3 id="funnel-requisitions" className="leave-section-title">
            {copy.perRequisition}
          </h3>
          <CollectionView
            id="recruit-funnel-requisitions"
            label={copy.perRequisition}
            noun="requisitions"
            items={data.perRequisition}
            getKey={(row) => row.requisitionId}
            columns={columns}
            renderCard={(row) => (
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <strong className="min-w-0 break-words text-primary">
                    {row.title}
                  </strong>
                  <StatusPill
                    label={text.requisition.status[row.status]}
                    color={requisitionColor[row.status] ?? "gray"}
                  />
                </div>
                <span className="text-sm text-tertiary">{row.code}</span>
                <span className="text-sm text-secondary">
                  {text.requisition.applicationsCount(row.applications)} ·{" "}
                  {text.requisition.cardHeadcount(
                    row.filledCount,
                    row.headcount,
                  )}
                </span>
              </div>
            )}
          />
        </section>
      )}
    </div>
  );
}
