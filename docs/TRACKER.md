# Work tracker

Live status of pending work. Update the row when a task finishes, with the date and the commit. The handoff in [HANDOFF.md](HANDOFF.md) explains how to run and verify. The product backlog is [backlog.md](backlog.md); this file tracks the pending work from the handoff.

Status values: `todo`, `doing`, `done`, `blocked`.

## Verification and cleanup

| #   | Task                                                                                       | Status | Done on | Commit / evidence |
| --- | ------------------------------------------------------------------------------------------ | ------ | ------- | ----------------- |
| V1  | Full verification on combined code: format, lint, typecheck, unit, integration, build, e2e | doing  |         |                   |
| V2  | Open-shift list regression test (the 500 fix in `shift.store.ts`)                          | todo   |         |                   |
| V3  | Flaky `wow` reduced-motion e2e test: find real cause                                       | todo   |         |                   |
| V4  | Performance e2e failed once in a full run ("New review cycle" not found): find cause       | todo   |         |                   |
| V5  | Dev reset for synthetic test data (local database only)                                    | todo   |         |                   |
| V6  | Look at each new module in a browser at 390px and 1440px; log findings                     | todo   |         |                   |

## UI upgrade to Untitled UI (free MIT components only)

Source list: https://www.untitledui.com/react/components. Vendored copies live in `packages/ui/src/untitled`. The MIT starter kit is cloned at `../untitledui-starter`. Brand icons (payment, integration logos) are not copied.

| #   | Component family                                                                                             | Status | Notes                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Sidebar and app navigation (simple, section dividers, sub-headings, slim, dual tier)                         | todo   | Replace the hand-built sidebar in `workspace.tsx`                                                                                                                                                                                               |
| U2  | Menus: dropdown, flyout, context menu, sub-menu                                                              | todo   | Only `base/dropdown` vendored today                                                                                                                                                                                                             |
| U3  | Accordion                                                                                                    | todo   | Not in the starter kit as checked; build from kit primitives and say so                                                                                                                                                                         |
| U4  | Modal and pop-up dialogs                                                                                     | done   | Kit modal vendored; `DialogPanel` (used by every portal dialog) renders it, accessible names unchanged (branch worktree-agent-af1db2c43dc6cd1a7)                                                                                                |
| U5  | Forms: form, input group, number, date, select (native, multi), tags, pin input, toggle, slider, file upload | done   | Vendored form, input-group, native select, slider; exported beside input, textarea, select, toggle. Number, date, pin, tags, multi-select not vendored: no screen needs them and they need extra deps (branch worktree-agent-af1db2c43dc6cd1a7) |
| U6  | Search and combobox                                                                                          | done   | Kit combobox exported; the portal has no datalists. The org search keeps its own tested listbox (branch worktree-agent-af1db2c43dc6cd1a7)                                                                                                       |
| U7  | Tables and sorting                                                                                           | todo   | `application/table` vendored; extend to every list (ADR 0010)                                                                                                                                                                                   |
| U8  | Pagination (line, dot, numbered)                                                                             | todo   | Pagination base vendored; apply to every paged list                                                                                                                                                                                             |
| U9  | Buttons and button groups                                                                                    | todo   | Partly done (`button.tsx`, `button-group.tsx`)                                                                                                                                                                                                  |
| U10 | Cards and metrics (stat cards)                                                                               | todo   | Replace `StatCard` pattern with kit cards where it fits                                                                                                                                                                                         |
| U11 | Avatars (label group, profile photo, count)                                                                  | todo   | Vendored base avatar only                                                                                                                                                                                                                       |
| U12 | Badges, tags, featured icon, empty state                                                                     | todo   | Badge groups and featured icon not yet vendored                                                                                                                                                                                                 |
| U13 | Progress indicators and loading                                                                              | done   | Performance `ProgressBar` renders the kit progress bar, keeps role=progressbar and the % text (branch worktree-agent-af1db2c43dc6cd1a7)                                                                                                         |
| U14 | Tooltips, toggles, checkboxes, radios                                                                        | done   | Audited: switches, checkboxes and most radios use kit or react-aria. Native radios left are card-style pickers (theme, mode, density, shift, rating), kept on purpose (branch worktree-agent-af1db2c43dc6cd1a7)                                 |
| U15 | Images and file upload                                                                                       | done   | No screen needs upload yet (branch worktree-agent-af1db2c43dc6cd1a7)                                                                                                                                                                            |
| U16 | Icons                                                                                                        | todo   | Standardise on the icon set the kit uses                                                                                                                                                                                                        |

## Product backlog

| #   | Item                                                                  | Status | Notes                                     |
| --- | --------------------------------------------------------------------- | ------ | ----------------------------------------- |
| P1  | Settings and Reports result table on the card/table pattern           | todo   | ADR 0010                                  |
| P2  | Server-side totals and sorting for list endpoints                     | todo   | Most list endpoints return no total today |
| P3  | Department and location pickers beyond 50 entries                     | todo   |                                           |
| P4  | Tab indicator slides instead of popping in                            | todo   |                                           |
| P5  | `?detail=` URL state on the remaining lists                           | todo   |                                           |
| P6  | Shifts, learning and engagement follow-ups from their plan docs       | todo   |                                           |
| P7  | Dependencies and workflows map (for the README and architecture docs) | todo   |                                           |
| P8  | Code comments pass on the new modules                                 | todo   |                                           |
