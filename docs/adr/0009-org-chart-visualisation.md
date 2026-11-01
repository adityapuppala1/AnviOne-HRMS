# ADR 0009: Org chart visualisation (d3 for 2D, lazy three.js for 3D)

Date: 28 October 2026. Status: accepted. Builds on [ADR 0008](0008-untitled-ui-everywhere.md).

## Decision

The Org chart screen shows one person's neighbourhood (their manager, themselves, their direct reports) in four views: **Network** (default), **3D**, **List** and **Whole tree**.

- **Network** uses d3-hierarchy (tree layout), d3-shape (curved links), d3-zoom, d3-selection and d3-transition. Nodes are real HTML buttons laid over an SVG link layer inside one zoomed stage, so they are focusable, readable by assistive tech and crisp at any zoom.
- **3D** uses three.js (named imports only; `OrbitControls` from `three/examples/jsm`). It is loaded with `React.lazy` / dynamic import only when the 3D tab opens, so the main bundle does not grow. Colours are read from the live CSS tokens (light, dark and the Loom themes).
- **List** is the accessible text equivalent of both visuals: manager, person, reports, each with a button to move the chart.
- **Whole tree** is the earlier expandable tree from the scoped full-chart endpoint, unchanged in behaviour.

## Licences

d3-hierarchy, d3-shape, d3-selection, d3-zoom, d3-transition: ISC. three: MIT. Recorded in `THIRD_PARTY_NOTICES.md`.

## Accessibility

Zoom works with mouse wheel, drag, double click, touch pinch, on-screen buttons and the keyboard on the focusable chart region (plus and minus, 0 to fit, arrows to pan, Home to return to the signed-in person). Tab moves between people; Enter shows their reporting lines. The 3D canvas has the same keys plus `[` and `]` to select a person. Search is an ARIA combobox with a live result count. Focus is mirrored in `?focus=<employeeId>`. Reduced motion (device setting or the portal switch) turns off transitions and the idle drift. If WebGL is unavailable the 3D tab says so and offers the Network view.

## Performance rules

- three.js stays out of the main bundle; d3 modules are small and ride with the chart route.
- The 3D renderer caps device pixel ratio at 2, renders only while the canvas is on screen and the tab is visible, draws on demand when idle, draws at most 48 reports as textured cards (the rest are in List and search), and disposes geometries, materials, textures and the renderer on unmount.
- The reports tier wraps into a grid past 6 people; the API returns at most 200 reports and says when it has truncated.

## Deliberate widening of visibility

Until now the chart showed only the viewer's own scope. The new search and neighbourhood endpoints let **everyone with directory access** see any employee's place in the organization. Fields exposed, and nothing else: `id`, `name`, `initials`, `title`, `department` (may be empty), `managerId`, `directReportCount`. No email, phone, code, location, dates or status. The screen states this plainly: "Everyone in the organization can see names, titles, departments and reporting lines here; no contact details." Search text is never logged or put in the address bar.
