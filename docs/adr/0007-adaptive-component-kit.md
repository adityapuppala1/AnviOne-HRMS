# ADR 0007: Adaptive layout and component kit

Date: 27 October 2026. Status: accepted. Extends [ADR 0005](0005-loom-experience.md) and [ADR 0006](0006-loom-depth.md). Access and data-scope rules stand.

The user asked for the portal to work well on every kind of device, to be fast, to use Magic UI and Untitled UI components for better-organized screens, and to complete the plan across every page plus new pages.

## Adaptive layout

- **Phones (up to 767 px):** a bottom bar gives four key destinations for the role (Overview, Leave, Attendance, Approvals, or People and Documents when those are hidden) and a More button that opens the full menu. The approvals count shows on the bar. It respects the home-indicator inset (`viewport-fit=cover`).
- **Tablets and desktops:** keep the side navigation. Tablets use two-column stat rows.
- **Touch:** text links have a 32 px minimum target and 44 px on coarse pointers; hidden radios now cover their whole option card, so the card is the control.
- **Fluid type and spacing** use `clamp()`; content is capped at 1,536 px.
- **Speed:** every route is its own chunk and links prefetch on intent. Long below-the-fold panels use `content-visibility`. Phones get lighter blur and no second backdrop glow.
- **Guard:** `tests/e2e/devices.spec.ts` loads every screen once and resizes through six sizes (360 to 1920 px), failing on sideways scroll, clipped content or targets under 24 px.

## Component kit

- **Untitled UI (MIT)** free components (table, pagination, badges, empty state, featured icon, input, select, dropdown, tooltip, charts helpers) are vendored in `packages/ui/src/untitled` with their imports made relative. Their design tokens are bridged to Loom in `untitled.css`: Loom's indigo ramp replaces their brand purple, a lilac-tinted neutral replaces their grey, and dark mode follows `data-mode`. PRO components are not used.
- **Anvi patterns** in `packages/ui/src/patterns.tsx` give every screen the same structure: `PageHeader` (eyebrow, one h1, actions), `StatCard` (Magic UI number ticker), `EmptyBlock`, and `DataCard` (a sortable, paged Untitled UI table that becomes stacked cards on phones).
- Screens rebuilt on the kit: People (list view), Teams, Activity, Organization, Leave, Attendance, Approvals, Documents, Holidays, Candidates, Assigned tasks, Settings, Preferences. Behaviour, routes and API calls are unchanged, except that tables that hold all their rows in memory (Activity) can be sorted; lists paged by the server (People, Organization) keep the server order, and a table returns to page 1 when its rows are filtered. Where end-to-end specs depend on existing row markup, the existing row lists were kept and only headers, stats, empty states and badges changed.
- The empty-state title is an `h2` so a page keeps a single `h1`.

## New pages

- **Insights** (`/insights`, permission `insights.read`: managers at team scope, HR at organization scope). Counts only: people by department and location, joiners over six months, approved leave by month and type, who is away today, check-ins for 14 days. Every figure comes from row-level security, so it matches what the caller could already see. Each chart has the same data as a table. See [the plan](../plans/insights-and-help.md).
- **Help centre** (`/help`): searchable answers grouped by topic, plus keyboard shortcuts.

## Consequences

- The root stylesheet grew from about 14 KB to about 33 KB compressed because the Untitled UI token system is included; unused vendored components can be pruned later.
- Two forms of list exist: DataCard (new and rebuilt screens) and the original `.leave-item`-style row lists (kept where tests depend on them).
- Insights adds an index (migration 021) and one permission; no existing access changed.
