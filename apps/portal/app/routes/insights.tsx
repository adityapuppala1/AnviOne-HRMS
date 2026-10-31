import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { UserPlus } from "@phosphor-icons/react/dist/csr/UserPlus";
import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { HourglassMedium } from "@phosphor-icons/react/dist/csr/HourglassMedium";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import {
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
} from "@anvi/ui";
import { useInsights } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { insightsCopy as text } from "../lib/copy/insights";
import { useWorkspace } from "./workspace";
import "./insights.css";

type Row = { label: string; value: number };

// Colours come from the active palette so charts follow the workspace theme.
const BRAND = "var(--brand)";
const MARIGOLD = "var(--marigold)";
const AXIS = { fontSize: 12, fill: "var(--muted)" } as const;

export default function Insights() {
  const { me } = useWorkspace();
  return me.permissions.includes("insights.read") ? (
    <InsightsView />
  ) : (
    <ErrorState message={text.denied} />
  );
}

function InsightsView() {
  const { data, error, refetch } = useInsights(true);
  const { reduceMotion } = usePreferences();
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  const { people, leave, attendance } = data;
  const animate = !reduceMotion;
  const empty = people.total === 0;
  const dept = people.byDepartment.map((d) => ({
    label: d.name,
    value: d.count,
  }));
  const place = people.byLocation.map((d) => ({
    label: d.name,
    value: d.count,
  }));
  const joiners = people.joinersByMonth.map((m) => ({
    label: text.month(m.month),
    value: m.value,
  }));
  const leaveMonths = leave.byMonth.map((m) => ({
    label: text.month(m.month),
    value: m.value,
  }));
  const days = attendance.days.map((d) => ({
    label: text.day(d.date),
    value: d.present,
  }));
  const maxType = Math.max(1, ...leave.byType.map((t) => t.days));
  const leaveCopy = text.charts.leaveMonth(leave.year);
  return (
    <div className="page-enter insights">
      <PageHeader title={text.title} description={text.scope[data.scope]} />
      <section className="insights-stats" aria-label={text.statsLabel}>
        <StatCard
          label={text.stats.people.label}
          hint={text.stats.people.hint}
          value={people.total}
          icon={Users}
          animate={animate}
        />
        <StatCard
          label={text.stats.joiners.label}
          hint={text.stats.joiners.hint}
          value={people.joinedLast90Days}
          icon={UserPlus}
          animate={animate}
        />
        <StatCard
          label={text.stats.away.label}
          hint={text.stats.away.hint}
          value={leave.onLeaveToday}
          icon={AirplaneTilt}
          animate={animate}
        />
        <StatCard
          label={text.stats.pending.label}
          hint={text.stats.pending.hint}
          value={leave.pendingRequests}
          icon={HourglassMedium}
          animate={animate}
        />
      </section>
      {empty ? (
        <section className="panel">
          <EmptyBlock
            icon={ChartBar}
            title={text.empty.title}
            description={text.empty.description}
          />
        </section>
      ) : (
        <div className="insights-grid">
          <ChartCard {...text.charts.department} rows={dept} wide>
            <BarChart
              data={dept}
              layout="vertical"
              margin={{ left: 4, right: 16 }}
            >
              <CartesianGrid horizontal={false} stroke="var(--line)" />
              <XAxis type="number" allowDecimals={false} tick={AXIS} />
              <YAxis
                type="category"
                dataKey="label"
                width={112}
                tick={AXIS}
                tickLine={false}
              />
              <Tooltip cursor={{ fill: "var(--brand-soft)" }} />
              <Bar
                dataKey="value"
                name={text.charts.department.label}
                fill={BRAND}
                radius={[0, 6, 6, 0]}
                isAnimationActive={animate}
              />
            </BarChart>
          </ChartCard>
          <ChartCard {...text.charts.location} rows={place}>
            <BarChart data={place} margin={{ right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} width={28} />
              <Tooltip cursor={{ fill: "var(--brand-soft)" }} />
              <Bar
                dataKey="value"
                name={text.charts.location.label}
                fill={BRAND}
                radius={[6, 6, 0, 0]}
                isAnimationActive={animate}
              />
            </BarChart>
          </ChartCard>
          <ChartCard {...text.charts.joiners} rows={joiners}>
            <BarChart data={joiners} margin={{ right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} width={28} />
              <Tooltip cursor={{ fill: "var(--brand-soft)" }} />
              <Bar
                dataKey="value"
                name={text.charts.joiners.label}
                fill={MARIGOLD}
                radius={[6, 6, 0, 0]}
                isAnimationActive={animate}
              />
            </BarChart>
          </ChartCard>
          <ChartCard {...leaveCopy} rows={leaveMonths}>
            <BarChart data={leaveMonths} margin={{ right: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="label"
                tick={AXIS}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tick={AXIS} width={28} />
              <Tooltip cursor={{ fill: "var(--brand-soft)" }} />
              <Bar
                dataKey="value"
                name={leaveCopy.label}
                fill={BRAND}
                radius={[6, 6, 0, 0]}
                isAnimationActive={animate}
              />
            </BarChart>
          </ChartCard>
          <ChartCard {...text.charts.attendance} rows={days} wide>
            <AreaChart data={days} margin={{ right: 8 }}>
              <defs>
                <linearGradient id="presence" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--brand)"
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--brand)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="label"
                tick={AXIS}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={AXIS}
                width={28}
                domain={[0, Math.max(attendance.headcount, 1)]}
              />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="value"
                name={text.charts.attendance.label}
                stroke={BRAND}
                strokeWidth={2.5}
                fill="url(#presence)"
                isAnimationActive={animate}
              />
            </AreaChart>
          </ChartCard>
          <section className="panel insights-types">
            <header>
              <h2>{text.charts.leaveType.title}</h2>
              <p>{text.charts.leaveType.description}</p>
            </header>
            {leave.byType.length ? (
              <ul>
                {leave.byType.map((t) => (
                  <li key={t.name}>
                    <span>{t.name}</span>
                    <strong>{text.days(t.days)}</strong>
                    <i
                      aria-hidden="true"
                      style={{ width: `${(t.days / maxType) * 100}%` }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="insights-none">{text.charts.leaveType.none}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// A chart with its title, and the same figures as a table for anyone who
// prefers it or uses a screen reader.
function ChartCard({
  title,
  description,
  rows,
  children,
  wide,
}: {
  title: string;
  description: string;
  rows: Row[];
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`panel insights-card ${wide ? "insights-wide" : ""}`}>
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div
        className="insights-chart"
        role="img"
        aria-label={`${title}. ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
      <details className="insights-table">
        <summary>{text.dataTable}</summary>
        <table>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{text.tableColumns.label}</th>
              <th scope="col">{text.tableColumns.value}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
