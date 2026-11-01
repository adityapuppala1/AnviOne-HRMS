# Third-party notices

The repository code is MIT licensed under the root LICENSE. Dependency licenses remain their respective authors' licenses; the lockfile records the installed versions. This is an inventory of notable direct components, not a generated complete SBOM.

| Component                                                              | Use                                     | License                   |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------- |
| React / React DOM                                                      | Portal rendering                        | MIT                       |
| React Router                                                           | SPA framework and routing               | MIT                       |
| React Aria Components                                                  | Accessible button/dialog interactions   | Apache-2.0                |
| TanStack Query                                                         | Scoped server-state fetching            | MIT                       |
| Phosphor Icons                                                         | Consistent interface icon family        | MIT                       |
| Motion                                                                 | Interaction and spotlight motion        | MIT                       |
| Magic UI Magic Card                                                    | Locally adapted branding spotlight      | MIT                       |
| Magic UI Number Ticker                                                 | Count-up figures                        | MIT                       |
| Untitled UI free components                                            | Table, pagination, badges, empty state  | MIT                       |
| Untitled UI Icons / file icons                                         | Icons used by those components          | MIT                       |
| d3-hierarchy, d3-shape, d3-selection, d3-zoom, d3-transition           | Org chart Network view                  | ISC                       |
| three                                                                  | Org chart 3D view (lazy loaded)         | MIT                       |
| Recharts                                                               | Insights charts                         | MIT                       |
| tailwind-merge, tailwindcss-animate, tailwindcss-react-aria-components | Support for the Untitled UI components  | MIT                       |
| Tailwind CSS                                                           | Semantic theme integration              | MIT                       |
| NestJS                                                                 | API application boundary                | MIT                       |
| node-postgres                                                          | Parameterized SQL                       | MIT                       |
| openid-client                                                          | OIDC protocol implementation            | MIT                       |
| Zod                                                                    | Independent request/response validation | MIT                       |
| Outfit / Public Sans (Fontsource)                                      | Self-hosted variable typefaces          | SIL Open Font License 1.1 |

The original controls in `packages/ui` use React Aria primitives. The adapted [Magic Card source](packages/ui/src/magicui/magic-card.tsx) retains its [MIT notice](packages/ui/src/magicui/LICENSE.md); it was retrieved from `https://magicui.design/r/magic-card.json` on 25 October 2026, then simplified for semantic tokens, reduced motion and this React Router application. The free Untitled UI components in [packages/ui/src/untitled](packages/ui/src/untitled) are MIT licensed ([notice](packages/ui/src/untitled/LICENSE.md)); they were added with the untitledui CLI 0.1.69 on 27 October 2026, their `@/` imports rewritten to relative paths, and their colour tokens bridged to Anvi Loom in `untitled.css`. No Untitled UI PRO component, commercial template or Dribbble illustration is redistributed. Dribbble references informed hierarchy and visual depth; product illustrations are original CSS. Exact upstream font/package licenses are included in installed packages. A full SBOM and license review are release gates.
