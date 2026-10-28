import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { PerfCompetency, PerfReviewEntry } from "@anvi/contracts";
import { api } from "../../lib/api";
import { performanceCopy as text } from "../../lib/copy/performance";
import { useWorkspace } from "../../routes/workspace";

export {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  PersonPicker,
  SelectField,
  StatusPill,
  dateOnly,
  todayIso,
  useDebounced,
  type Person,
} from "../recruit/shared";

type Color = "gray" | "brand" | "error" | "warning" | "success";

export const goalColor: Record<string, Color> = {
  draft: "gray",
  active: "brand",
  completed: "success",
  cancelled: "gray",
};
export const cycleColor: Record<string, Color> = {
  draft: "gray",
  active: "brand",
  closed: "success",
  cancelled: "gray",
};
export const reviewColor: Record<string, Color> = {
  self_pending: "warning",
  manager_pending: "warning",
  calibration: "brand",
  finalised: "success",
};

export const competencies: PerfCompetency[] = [
  "quality",
  "delivery",
  "collaboration",
  "ownership",
  "growth",
];

export function formatValue(unit: string, value: number) {
  const rounded = Number.isInteger(value)
    ? value.toLocaleString("en-IN")
    : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (unit === "percent") return `${rounded}%`;
  if (unit === "currency") return `₹${rounded}`;
  if (unit === "hours") return `${rounded} h`;
  return rounded;
}

// One write path for the whole screen: sends the CSRF token and refreshes every performance query.
export function usePerfSend() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send<T = unknown>(
    path: string,
    body: unknown,
    schema: z.ZodType<T> = z.unknown() as z.ZodType<T>,
    method: "POST" | "PUT" = "POST",
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/performance/${path}`, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body),
      });
      await client.invalidateQueries({ queryKey: ["perf"] });
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.common.saveFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, error, setError };
}

// A labelled progress bar. The fill grows with a transform so nothing reflows, and it stops
// growing when motion is reduced.
export function ProgressBar({
  value,
  label,
  className = "",
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`perf-progress ${className}`}>
      <div
        className="perf-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <span
          className="perf-fill"
          style={{ transform: `scaleX(${clamped / 100})` }}
        />
      </div>
      <span className="perf-percent" aria-hidden="true">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}

// Five fixed areas, each rated 1 to 5 with real radio buttons (arrow keys move between them).
export function RatingField({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const name = useId();
  return (
    <fieldset className="perf-rating">
      <legend>{legend}</legend>
      <div className="perf-rating-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="perf-rating-option">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={`${legend}: ${text.review.scale[n]}`}
            />
            <span aria-hidden="true">{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Submitted review entries as read-only rating rows.
export function EntryCard({ entry }: { entry: PerfReviewEntry }) {
  const copy = text.review.detail;
  return (
    <section className="perf-entry" aria-label={copy.by(entry.authorName)}>
      <header>
        <strong>
          {entry.kind === "self"
            ? copy.selfBy(entry.authorName)
            : copy.managerBy(entry.authorName)}
        </strong>
        <span>{copy.overall(entry.overall.toFixed(1))}</span>
      </header>
      <dl className="perf-ratings">
        {competencies.map((area) => (
          <div key={area}>
            <dt>{text.review.competency[area]}</dt>
            <dd>
              <span className="perf-dots" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <i
                    key={n}
                    data-on={n <= entry.ratings[area] ? "" : undefined}
                  />
                ))}
              </span>
              <span>{copy.ofFive(entry.ratings[area])}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="perf-comment">{entry.comment ?? copy.noComment}</p>
    </section>
  );
}
