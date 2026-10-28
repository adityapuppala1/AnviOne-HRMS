## Status notes (hand-written)

Fixed in this pass: pagination and a Cards | Table choice with a details panel on Approvals, Documents, Leave, Activity, Assets, Policies, Exit, Expenses, Projects, Attendance team board and Calendar holidays (List view); candidates intake list is paged. Contrast (placeholder and tertiary text tokens, Approvals date pill), 44 px touch targets (inputs, icon buttons, view toggles, pagination, weekday buttons, legend buttons), the empty-state art that scrolled the page sideways on a 320 px phone, and long badges that overflowed approval cards.

Pending (not done in this pass):

- Configuration permission matrix: 33 rows with no pagination (read-only reference table; needs its own grouping design).
- Org chart "Network" tab nodes are about 29 px tall because the canvas is scaled; they need a zoom-aware hit area. Truncated department labels in the chart still lack a tooltip on some nodes.
- Reports saved list, Organization lists, Teams explorer, Tasks, Settings and Details still use older list patterns (no Cards | Table choice, no details panel).
- People directory keeps its own grid/list toggle with server paging; it was not moved onto `CollectionView`.
- The audit checks one dialog trigger and the first row per tab; deeper dialog flows are covered by the feature specs.
- Environment noise: when the dev API restarts mid-run, 502 responses are logged as low `infra-gateway` findings, not UI faults.
