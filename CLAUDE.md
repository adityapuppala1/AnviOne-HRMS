# AnviOne / MyAnvi HRMS: project instructions

Start with [docs/HANDOFF.md](docs/HANDOFF.md) for status, pending work, how to run and the next plan. These rules apply to every tool and model, not only Claude.

## UI components: use Untitled UI everywhere

Build every screen from Untitled UI React components first, bridged to the Anvi Loom look. Only fall back to our own patterns (`packages/ui/src/patterns.tsx`: PageHeader, StatCard, EmptyBlock, DataCard) where Untitled UI has no equivalent.

- **Where they live:** the free, MIT-licensed components are vendored in `packages/ui/src/untitled` (tokens bridged to Loom in `untitled/untitled.css`) and re-exported from `@anvi/ui`. Import from `@anvi/ui`, never copy a component into a route.
- **Reference starter kit:** clone `https://github.com/untitleduico/untitledui-nextjs-starter-kit` into a scratch folder outside the repo (for example `git clone https://github.com/untitleduico/untitledui-nextjs-starter-kit ../untitledui-starter`) to read how components, props and page layouts are composed. Do not commit the clone. Copy only files whose licence allows it into `packages/ui/src/untitled`, keeping imports relative and the licence file.
- **MCP server:** the Untitled UI MCP is registered with `claude mcp add --transport http untitledui https://www.untitledui.com/react/api/mcp`. When it is connected, use it to look up components, props and examples before hand-writing UI. It needs to be added once per machine; if it is not connected, say so rather than guessing component APIs.
- **Licensing:** use the free/MIT components. PRO components and assets are used only if the user confirms an Untitled UI licence for them; otherwise do not copy them. See `docs/adr/0001-consolidated-foundation.md` and `docs/adr/0007-adaptive-component-kit.md`.
- **Look and feel:** keep the Anvi Loom visual system (distinctive, not generic), light and dark mode, 44px touch targets, 320px to 1920px layouts, WCAG 2.2 AA. All user-facing text lives in `apps/portal/app/lib/copy*.ts` catalogs.
- **Migration status:** `docs/adr/0008-untitled-ui-everywhere.md` lists which screens already use the kit and which are still to migrate. Update it as screens move.

## How each module slice is delivered

Plan doc in `docs/plans`, forward-only migration (never edit an applied or committed one), contracts, store and controller, UI, integration and Playwright tests, acceptance evidence with screenshots in `docs/acceptance-evidence`, backlog, README and traceability updates, an Opus review of any security, RLS or migration work with its findings fixed in a new migration, the full suite run once, then one commit per slice.

## Commands

- `pnpm db:up`, `pnpm db:migrate`, `pnpm dev` (portal 5173, API 4000)
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`
- Stop the dev servers before `pnpm test:e2e` so Playwright can start its own.

## Honesty rules

AI features stay gated and off; suggestions are rule-based and never presented as AI output. State limits plainly in docs and UI (for example, what is not integrated yet).
