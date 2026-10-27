import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import type { SortDescriptor } from "react-aria-components";
import {
  InputBase,
  TextField,
  type TextFieldProps,
} from "./untitled/components/base/input/input";
import { Label } from "./untitled/components/base/input/label";
import { HintText } from "./untitled/components/base/input/hint-text";
import { NumberTicker } from "./magicui/number-ticker";
import {
  Table,
  TableCard,
} from "./untitled/components/application/table/table";
import { PaginationCardMinimal } from "./untitled/components/application/pagination/pagination";
import { EmptyState } from "./untitled/components/application/empty-state/empty-state";
import { FeaturedIcon } from "./untitled/components/foundations/featured-icon/featured-icon";

type Icon = FC<{ className?: string }>;

// True below the given width; lets one component render either a table or a
// stacked list without putting both in the page.
export function useNarrow(maxWidth = 640) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [maxWidth]);
  return narrow;
}

// One heading per screen, with the primary actions on the right and optional
// tabs or filters beneath.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </header>
  );
}

// A number that matters, counted up once, with an icon and a one-line hint.
export function StatCard({
  label,
  value,
  hint,
  icon,
  suffix,
  animate = true,
  pad = 0,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: Icon;
  suffix?: string;
  animate?: boolean;
  pad?: number;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-2xl bg-primary p-5 shadow-xs ring-1 ring-secondary"
      data-spot
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-tertiary">{label}</span>
        {icon && (
          <FeaturedIcon icon={icon} color="brand" theme="light" size="md" />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <NumberTicker
          className="font-display text-display-sm font-semibold text-primary"
          value={value}
          pad={pad}
          disabled={!animate}
        />
        {suffix && <span className="text-sm text-tertiary">{suffix}</span>}
      </div>
      {hint && <p className="text-sm text-tertiary">{hint}</p>}
    </div>
  );
}

// What to show when there is nothing yet: say what is missing and what to do.
export function EmptyBlock({
  icon,
  title,
  description,
  action,
}: {
  icon?: Icon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState size="md" className="px-4 py-10">
      <EmptyState.Header>
        <EmptyState.FeaturedIcon icon={icon} color="brand" />
      </EmptyState.Header>
      <EmptyState.Content>
        <EmptyState.Title>{title}</EmptyState.Title>
        {description && (
          <EmptyState.Description>{description}</EmptyState.Description>
        )}
      </EmptyState.Content>
      {action && <EmptyState.Footer>{action}</EmptyState.Footer>}
    </EmptyState>
  );
}

export type Column<T> = {
  id: string;
  label: string;
  // Sorting compares these values; leave out to keep the column unsortable.
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  isRowHeader?: boolean;
  className?: string;
};

// A titled card holding sortable, paged data. Wide screens get a table; phones
// get one stacked card per row, so nothing scrolls sideways.
export function DataCard<T>({
  title,
  description,
  badge,
  actions,
  columns,
  rows,
  getKey,
  label,
  mobileRow,
  empty,
  pageSize = 10,
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string;
  label: string;
  mobileRow: (row: T) => ReactNode;
  empty: ReactNode;
  pageSize?: number;
}) {
  const narrow = useNarrow();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortDescriptor>();
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.id === sort?.column);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    const direction = sort?.direction === "descending" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * direction;
    });
  }, [rows, columns, sort]);
  // A different number of rows means the data was filtered: start again at page 1.
  useEffect(() => setPage(1), [rows.length]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);
  return (
    <TableCard.Root className="data-card">
      <TableCard.Header
        title={title}
        description={description}
        badge={badge}
        contentTrailing={actions}
      />
      {rows.length === 0 ? (
        empty
      ) : narrow ? (
        <ul className="divide-y divide-secondary" aria-label={label}>
          {visible.map((row) => (
            <li key={getKey(row)} className="px-4 py-3">
              {mobileRow(row)}
            </li>
          ))}
        </ul>
      ) : (
        <Table aria-label={label} sortDescriptor={sort} onSortChange={setSort}>
          <Table.Header columns={columns}>
            {(column) => (
              <Table.Head
                id={column.id}
                label={column.label}
                allowsSorting={Boolean(column.sortValue)}
                isRowHeader={column.isRowHeader}
              />
            )}
          </Table.Header>
          <Table.Body items={visible}>
            {(row) => (
              <Table.Row id={getKey(row)} columns={columns}>
                {(column) => (
                  <Table.Cell className={column.className}>
                    {column.render(row)}
                  </Table.Cell>
                )}
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}
      {pages > 1 && (
        <PaginationCardMinimal
          page={current}
          total={pages}
          onPageChange={setPage}
        />
      )}
    </TableCard.Root>
  );
}

// Untitled UI's Input does not pass native range attributes (min, max, step) to
// the element, so dates and numbers with bounds compose the same primitives.
export function RangeInput({
  label,
  hint,
  min,
  max,
  step,
  hideRequiredIndicator = true,
  ...field
}: Omit<TextFieldProps, "children"> & {
  label: string;
  hint?: ReactNode;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  hideRequiredIndicator?: boolean;
}) {
  return (
    <TextField {...field}>
      {({ isRequired, isInvalid }) => (
        <>
          <Label
            isRequired={hideRequiredIndicator ? false : isRequired}
            isInvalid={isInvalid}
          >
            {label}
          </Label>
          <InputBase min={min} max={max} step={step} type={field.type} />
          {hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}
        </>
      )}
    </TextField>
  );
}
