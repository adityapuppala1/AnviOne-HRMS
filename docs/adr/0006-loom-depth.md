# ADR 0006: Loom depth and motion

Date: 27 October 2026. Status: accepted. Extends [ADR 0005](0005-loom-experience.md); palette, type, access and data-scope rules stand.

The user asked for a more striking, "wow" feeling across the application: a holographic rotating globe, orbits, count-up numbers, an animated background, mouse parallax, cursor glow, floating cards and an AI feature.

## Direction

The signature moment is a holographic globe, tied to what an HR product is about. Marigold threads join offices, and product modules (sign-in) or colleagues (home) orbit it as chips in their own accent colours. Everything else stays quiet so the globe is the one memorable thing.

- **Globe** (`holo-globe.tsx`): canvas 2D, no new dependency. A lattice of 1,100 points with an iridescent hue, a graticule, a scan band, marigold arcs with travelling pulses and sonar pins. It spins on its own, leans toward the pointer, and can be dragged anywhere on its face with inertia (rings and cards ignore the pointer). It pauses when off screen or in a hidden tab, caps device pixel ratio at 2, and takes its marigold from the active palette. The projection maths is in `lib/globe-math.ts` with unit tests.
- **Orbits and floating cards** (`globe-stage.tsx`): two tilted rings turn in CSS; each chip cancels its ring's tilt, squash and spin so it stays upright. Glass cards float at different depths.
- **Parallax** (`lib/use-parallax.ts`): the pointer is eased into two CSS variables; layers read them through `translate`, so no React renders per frame.
- **Ambient layer** (`ambient.tsx`): a fixed, slowly drifting backdrop tinted by the palette; a cursor light; a spotlight that follows the pointer on any `.panel` or `[data-spot]` card; and an aurora inside dark hero surfaces.
- **Brand**: a marigold dot circles the weave mark.
- **Count-up**: the existing Magic UI number ticker now also drives Leave balances.
- **Anvi Assist** (`assist.tsx`): see below.

## Honesty about AI

The AI helper is a gated backlog item (AI-01: security and privacy review first). The interface therefore does not pretend it works. Anvi Assist shows an orb, the badge "AI helper is off" and a one-line explanation. Its "Suggested next steps" are ordinary rules computed from the person's own permissions and the waiting-decision count, with no AI involved.

The offices on the globe are illustrative and say nothing about real locations; the canvas is `aria-hidden`.

## Accessibility and motion

- Reduced motion, from the OS or the display preference, paints the globe once, stops every animation and hides the cursor glow.
- Parallax, cursor glow and spotlight run only for a fine, hovering pointer.
- All effects are decorative, `aria-hidden` and take no pointer events (the globe's drag aside).
- axe WCAG 2.2 AA passes in light and dark; there is no horizontal scroll at 390 px.

## Consequences

- Home and sign-in carry the depth; other screens receive the ambient backdrop, cursor light, panel spotlight and brand motion, and keep their calmer layouts.
- The ambient backdrop is `position: fixed`, so full-page screenshots show it only over the first screen.
- Anvi Assist needs rework when AI-01 is approved; the suggestions list can stay.
