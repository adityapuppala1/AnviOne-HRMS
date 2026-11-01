import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Button } from "@anvi/ui";
import type { Dashboard } from "@anvi/contracts";

export function Distribution({ data }: { data: Dashboard }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = data.departments.find((dept) => dept.name === selected);
  const circumference = 2 * Math.PI * 72;
  let offset = 0;
  return (
    <div className="distribution">
      <div className="distribution-chart">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle
            className="chart-track"
            cx="100"
            cy="100"
            r="72"
            fill="none"
            strokeWidth="19"
          />
          {data.departments.map((dept, index) => {
            const length = data.total
              ? (dept.count / data.total) * circumference
              : 0;
            const start = offset;
            offset += length;
            return (
              <circle
                key={dept.name}
                cx="100"
                cy="100"
                r="72"
                fill="none"
                stroke={`var(--chart-${index % 6})`}
                strokeWidth={selected === dept.name ? 24 : 19}
                strokeDasharray={`${Math.max(length - 5, 0)} ${circumference}`}
                strokeDashoffset={-start}
                transform="rotate(-90 100 100)"
                className={
                  selected && selected !== dept.name
                    ? "chart-segment muted-segment"
                    : "chart-segment"
                }
              />
            );
          })}
        </svg>
        <div className="chart-center">
          <strong>{active?.count ?? data.total}</strong>
          <span>{active?.name ?? "People in scope"}</span>
        </div>
      </div>
      <div className="chart-legend" aria-label="Department breakdown">
        {data.departments.map((dept, index) => (
          <Button
            key={dept.name}
            variant="ghost"
            aria-pressed={selected === dept.name}
            onPress={() =>
              setSelected(selected === dept.name ? null : dept.name)
            }
          >
            <i style={{ background: `var(--chart-${index % 6})` }} />
            <span>{dept.name}</span>
            <strong>{dept.count}</strong>
          </Button>
        ))}
      </div>
      <Link
        className="chart-link text-link"
        to={
          active
            ? `/people?department=${encodeURIComponent(active.name)}`
            : "/teams"
        }
      >
        {active ? `Explore ${active.name}` : "Explore all teams"}
        <ArrowUpRight size={16} />
      </Link>
    </div>
  );
}
