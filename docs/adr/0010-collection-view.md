# ADR 0010: One list pattern, `CollectionView`

Date: 28 October 2026. Status: accepted. Builds on [ADR 0008](0008-untitled-ui-everywhere.md).

## Problem

Lists of records were hand-built per screen: some had only cards, some only a table, many rendered every row with no paging (the audit found 30 to 50 sibling rows on approvals, candidates and configuration), and clicking a record opened nothing or a thin dialog.

## Decision

`CollectionView` (`packages/ui/src/collection.tsx`, exported from `@anvi/ui`) is the one list component. It is built only from free MIT Untitled UI pieces: `Table`, `PaginationCardMinimal`, `ButtonGroup`, `Select`, and the slide-over `SlideoutMenu` (copied from the MIT starter kit into `untitled/components/application/slideout-menus`, with its close button re-drawn using our icon so no extra dependency is needed).

- **Cards | Table toggle**: kit `ButtonGroup`, labelled "Card view" and "Table view", remembered per screen in `localStorage` (`anvi.view.<id>`, inside try/catch). Phones always get cards, so nothing scrolls sideways.
- **Paging**: client mode slices the array (page size 10, 25 or 50, "Rows per page") or server mode (`server={{ page, total, limit, onPageChange }}`) for the `{items, total, page, limit/pages}` list shape. A polite live region reads "Showing 26-50 of 112".
- **Sorting**: columns with `sortValue` sort in the table. In server mode sorting applies to the current page only.
- **Details**: `detail={{ title, subtitle, body, footer }}` opens `DetailPanel` on row click, Enter, or the card "Details" button: a right slide-over on desktop, a full-width sheet on phones, focus trapped, Escape closes. `DetailFields` renders label/value groups and skips empty values. Screens that already own a richer dialog pass `onOpen` instead and keep it.
- **States**: skeleton rows while loading (no animation under reduced motion), `EmptyBlock` with "Clear filters" when `onClearFilters` is given, and a `note` for honest limits such as "first 100 only".
- **Layout**: 44 px toggle targets, 320 to 1920 px, light and dark through the Untitled tokens.

## Not done

- URL state for the open record (`?detail=`) is not wired; the optional controlled `openKey` prop makes it possible.
- Server-mode sorting is per page, because the API has no sort parameter.
- `DataCard` (older table-only card) still exists for reports and the organization screen.

## Audit

`pnpm test:audit` (`tests/e2e/audit/ui-audit.spec.ts`, own Playwright config, not part of `pnpm test:e2e`) walks every role and route at 1440x900 and 390x844 (touch) and writes `docs/acceptance-evidence/ui-audit.md`. See that file for before/after counts and the pending list.
