# ADR 0005: Anvi Loom visual system

Date: 25 October 2026. Status: accepted. Supersedes the palette and type choices in [ADR 0002](0002-atlas-experience.md); its structure, accessibility and data-scope rules stand.

The user judged Atlas too generic and asked for a more distinctive, Dribbble-inspired HRMS experience across every page. Atlas had drifted into the common "card kit": equal white cards, one radius, pale green accent.

## Direction

Loom treats the organization as fabric: indigo-dyed structure, a single marigold thread, colleagues as knots where threads cross. Indigo and marigold come from Indian textile dyeing, which suits an India-first HRMS.

- Palette: indigo `#2A2970`/`#1D1C55`, marigold `#F4B23E`, lilac-mist canvas `#F1F0F7`, paper `#FFFFFF`, success `#1A6849`, coral `#D9573F`. Iris and forest remain alternate palettes with explicit dark tokens.
- Type: Bricolage Grotesque (display, figures) with Public Sans (data, controls). Self-hosted.
- Radius hierarchy: shell 28, panels 22, controls 12, chips/pills full.
- Signature, used only on login, home and profile: an SVG weave that draws once (Motion `pathLength`) and is static under reduced motion. Home opens with an indigo band holding the greeting and three Magic UI number tickers.
- Shell: woven indigo rail with a marigold active state; a floating, translucent pill top bar.

## Implementation

- `apps/portal/app/loom.css` is loaded after `styles.css` and restyles existing classes; markup contracts and test selectors are unchanged.
- Leftover hard-coded Atlas greens were hue-shifted to indigo with lightness preserved, so existing contrast holds.
- `NumberTicker` is adapted locally from Magic UI (MIT) beside `MagicCard`.
- Removed the unused Atlas ring art and the Outfit font.
- Background-colour transitions on buttons/nav were removed: they let theme switches be sampled mid-transition and fail contrast checks.

Verification: lint, typecheck, unit tests, builds and all nine Playwright journeys (axe WCAG 2.2 AA across palettes and modes, viewport fit 360–1800px, reduced motion) pass.
