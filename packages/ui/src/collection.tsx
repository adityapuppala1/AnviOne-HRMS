import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";
import { Button as AriaButton } from "react-aria-components";
import type { SortDescriptor } from "react-aria-components";
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { Rows } from "@phosphor-icons/react/dist/csr/Rows";
import {
  Table,
  TableCard,
} from "./untitled/components/application/table/table";
import { PaginationCardMinimal } from "./untitled/components/application/pagination/pagination";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "./untitled/components/base/button-group/button-group";
import { Select } from "./untitled/components/base/select/select";
import { SlideoutMenu } from "./untitled/components/application/slideout-menus/slideout-menu";
import { EmptyBlock, useNarrow, type Column } from "./patterns";

type Icon = FC<{ className?: string }>;
export type CollectionViewMode = "cards" | "table";

// ---- Detail panel -------------------------------------------------------

// A slide-over on wide screens and a full-height sheet on phones. Focus is
// trapped inside, Escape and the close button dismiss it.
export function DetailPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SlideoutMenu
      isOpen={open}
      isDismissable
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="z-50"
      dialogLabel={title}
      dialogClassName="!items-stretch !gap-0"
    >
      <SlideoutMenu.Header onClose={onClose} className="pb-4 pr-14">
        <h2 className="font-display text-lg font-semibold text-primary break-words">
          {title}
        </h2>
        {subtitle && (
          <div className="mt-1 text-sm text-tertiary">{subtitle}</div>
        )}
      </SlideoutMenu.Header>
      <SlideoutMenu.Content
        role="region"
        tabIndex={0}
        aria-label={`${title} details`}
        className="pb-6"
      >
        {children}
      </SlideoutMenu.Content>
      {footer && (
        <SlideoutMenu.Footer className="flex flex-wrap justify-end gap-2">
          {footer}
        </SlideoutMenu.Footer>
      )}
    </SlideoutMenu>
  );
}

// A titled group of label/value rows for the panel body. Empty values are
// skipped so panels never show blank rows.
export function DetailFields({
  title,
  fields,
}: {
  title?: string;
  fields: { label: string; value: ReactNode }[];
}) {
  const shown = fields.filter(
    (f) => f.value !== null && f.value !== undefined && f.value !== "",
  );
  if (shown.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <h3 className="text-sm font-semibold text-secondary">{title}</h3>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
        {shown.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-sm text-tertiary">{f.label}</dt>
            <dd className="min-w-0 break-words text-sm text-primary">
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---- Collection view ------------------------------------------------------

const PAGE_SIZES = [10, 25, 50];

function readView(
  id: string,
  fallback: CollectionViewMode,
): CollectionViewMode {
  try {
    const stored = window.localStorage.getItem(`anvi.view.${id}`);
    return stored === "cards" || stored === "table" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export type CollectionDetail<T> = {
  title: (item: T) => string;
  subtitle?: (item: T) => ReactNode;
  body: (item: T) => ReactNode;
  footer?: (item: T, close: () => void) => ReactNode;
};

export type CollectionServerPaging = {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
};

// One list, two views. Cards and a sortable table share the same data, one
// pager with a result count, a page-size choice, skeleton loading, and a
// details panel opened by clicking or pressing Enter on a row or card.
export function CollectionView<T extends object>({
  id,
  label,
  noun = "results",
  items,
  getKey,
  columns,
  renderCard,
  detail,
  onOpen,
  views = ["cards", "table"],
  cardClassName,
  openKey: controlledKey,
  onOpenKeyChange,
  urlState = false,
  server,
  loading = false,
  defaultView = "cards",
  emptyTitle,
  emptyDescription,
  emptyIcon,
  onClearFilters,
  note,
  toolbar,
}: {
  // Remembers the chosen view for this screen (localStorage, per browser).
  id: string;
  // Accessible name for the list or table.
  label: string;
  noun?: string;
  items: T[];
  getKey: (item: T) => string;
  columns: Column<T>[];
  renderCard: (item: T) => ReactNode;
  detail?: CollectionDetail<T>;
  // For screens that already own a richer dialog: click or Enter on a row or
  // card calls this instead of opening the built-in panel.
  onOpen?: (item: T) => void;
  // Offer only some views (a narrow master list offers just cards).
  views?: CollectionViewMode[];
  // Extra classes for each card, for lists whose rows draw their own surface.
  cardClassName?: string;
  // Optional control of the open record, so a screen can open it from its own button.
  openKey?: string | null;
  onOpenKeyChange?: (key: string | null) => void;
  // Mirror the open record in the address bar as ?detail=<key> (one collection
  // per screen should set this). A shared link reopens the same record.
  urlState?: boolean;
  // Server mode: the API pages the data; items is the current page only.
  server?: CollectionServerPaging;
  loading?: boolean;
  defaultView?: CollectionViewMode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: Icon;
  onClearFilters?: () => void;
  // Honest note, such as "Showing the first 100; the API does not return more."
  note?: string;
  toolbar?: ReactNode;
}) {
  const narrow = useNarrow();
  const [stored, setStored] = useState<CollectionViewMode>(defaultView);
  useEffect(() => setStored(readView(id, defaultView)), [id, defaultView]);
  // Tables need width; phones always get cards.
  const view: CollectionViewMode =
    narrow || !views.includes(stored) ? views[0]! : stored;
  function chooseView(next: CollectionViewMode) {
    setStored(next);
    try {
      window.localStorage.setItem(`anvi.view.${id}`, next);
    } catch {
      /* private mode: the choice just is not remembered */
    }
  }
  const [sort, setSort] = useState<SortDescriptor>();
  const [pageState, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]!);
  const [innerKey, setInnerKey] = useState<string | null>(null);
  useEffect(() => {
    if (!urlState) return;
    const fromUrl = new URLSearchParams(window.location.search).get("detail");
    if (fromUrl) setInnerKey(fromUrl);
  }, [urlState]);
  const openKey = controlledKey === undefined ? innerKey : controlledKey;
  const setOpenKey = (key: string | null) => {
    setInnerKey(key);
    onOpenKeyChange?.(key);
    if (urlState) {
      try {
        const url = new URL(window.location.href);
        if (key) url.searchParams.set("detail", key);
        else url.searchParams.delete("detail");
        window.history.replaceState(window.history.state, "", url);
      } catch {
        /* the address bar is a convenience only */
      }
    }
  };

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.id === sort?.column);
    if (!column?.sortValue) return items;
    const value = column.sortValue;
    const dir = sort?.direction === "descending" ? -1 : 1;
    return [...items].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [items, columns, sort]);

  const limit = server ? server.limit : pageSize;
  const total = server ? server.total : sorted.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = server ? server.page : Math.min(pageState, pages);
  // New data (a filter changed) starts again at page 1 in client mode.
  useEffect(() => {
    if (!server) setPage(1);
  }, [items.length, server]);
  const visible = server
    ? sorted
    : sorted.slice((page - 1) * limit, page * limit);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, (page - 1) * limit + visible.length);
  function goTo(next: number) {
    const clamped = Math.min(Math.max(1, next), pages);
    if (server) server.onPageChange(clamped);
    else setPage(clamped);
  }

  const activate = (item: T) => {
    if (onOpen) onOpen(item);
    else if (detail) setOpenKey(getKey(item));
  };
  const clickable = Boolean(detail || onOpen);
  const opened = detail
    ? (items.find((i) => getKey(i) === openKey) ?? null)
    : null;
  const labelId = useId();

  const toggle = (
    <div className="flex flex-wrap items-center gap-3">
      {!narrow && views.length > 1 && (
        <ButtonGroup
          size="sm"
          aria-label="Choose how to display the list"
          selectedKeys={[view]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const next = Array.from(keys)[0];
            if (next === "cards" || next === "table") chooseView(next);
          }}
        >
          <ButtonGroupItem
            id="cards"
            aria-label="Card view"
            className="min-h-11 min-w-11"
            iconLeading={SquaresFour}
          />
          <ButtonGroupItem
            id="table"
            aria-label="Table view"
            className="min-h-11 min-w-11"
            iconLeading={Rows}
          />
        </ButtonGroup>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-collection={id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" id={labelId} className="text-sm text-tertiary">
          {loading
            ? "Loading"
            : total === 0
              ? `No ${noun}`
              : `Showing ${from}–${to} of ${total}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {toolbar}
          {toggle}
        </div>
      </div>
      {note && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
          {note}
        </p>
      )}
      {loading ? (
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label={`Loading ${noun}`}
          role="group"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="cv-skeleton h-16 rounded-xl bg-secondary" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyBlock
          icon={emptyIcon}
          title={emptyTitle ?? `No ${noun} to show`}
          description={emptyDescription}
          action={
            onClearFilters && (
              <AriaButton
                onPress={onClearFilters}
                className="button button-secondary"
              >
                Clear filters
              </AriaButton>
            )
          }
        />
      ) : view === "cards" ? (
        <ul
          aria-label={label}
          className="cv-enter grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3 p-0"
        >
          {visible.map((item, index) => {
            const key = getKey(item);
            return (
              <li
                key={key}
                style={{ "--i": Math.min(index, 11) } as CSSProperties}
                data-clickable={clickable ? "" : undefined}
                className={`cv-card min-w-0 rounded-2xl bg-primary p-4 shadow-xs ring-1 ring-secondary ${
                  clickable ? "cursor-pointer hover:ring-brand" : ""
                } ${cardClassName ?? ""}`}
                onClick={
                  clickable
                    ? (e) => {
                        if (
                          (e.target as HTMLElement).closest(
                            "a, button, input, select, textarea, [role=button]",
                          )
                        )
                          return;
                        activate(item);
                      }
                    : undefined
                }
              >
                <div className="flex min-w-0 flex-col gap-3">
                  {renderCard(item)}
                  {detail && !onOpen && (
                    <AriaButton
                      onPress={() => setOpenKey(key)}
                      aria-label={`Details: ${detail.title(item)}`}
                      className="button button-ghost self-start"
                    >
                      Details
                    </AriaButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <TableCard.Root className="data-card cv-enter">
          <Table
            aria-label={label}
            sortDescriptor={sort}
            onSortChange={setSort}
          >
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
                <Table.Row
                  id={getKey(row)}
                  columns={columns}
                  onAction={clickable ? () => activate(row) : undefined}
                >
                  {(column) => (
                    <Table.Cell className={column.className}>
                      {column.render(row)}
                    </Table.Cell>
                  )}
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </TableCard.Root>
      )}
      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {pages > 1 ? (
            <PaginationCardMinimal
              page={page}
              total={pages}
              pageSize={limit}
              align="left"
              onPageChange={goTo}
              className="min-w-[16rem] flex-1 rounded-xl border"
            />
          ) : (
            <span />
          )}
          {!server && total > PAGE_SIZES[0]! && (
            <Select
              aria-label="Rows per page"
              selectedKey={String(pageSize)}
              onSelectionChange={(key) => {
                setPageSize(Number(key));
                setPage(1);
              }}
              className="w-44"
            >
              {PAGE_SIZES.map((n) => (
                <Select.Item key={n} id={String(n)} label={`${n} per page`} />
              ))}
            </Select>
          )}
        </div>
      )}
      {detail && (
        <DetailPanel
          open={opened !== null}
          onClose={() => setOpenKey(null)}
          title={opened ? detail.title(opened) : ""}
          subtitle={opened && detail.subtitle?.(opened)}
          footer={opened && detail.footer?.(opened, () => setOpenKey(null))}
        >
          {opened && detail.body(opened)}
        </DetailPanel>
      )}
    </div>
  );
}
