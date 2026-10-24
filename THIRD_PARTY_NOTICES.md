# Third-party notices

The repository code is MIT licensed under the root LICENSE. Dependency licenses remain their respective authors' licenses; the lockfile records the installed versions. This is an inventory of notable direct components, not a generated complete SBOM.

| Component                         | Use                                     | License                   |
| --------------------------------- | --------------------------------------- | ------------------------- |
| React / React DOM                 | Portal rendering                        | MIT                       |
| React Router                      | SPA framework and routing               | MIT                       |
| React Aria Components             | Accessible button/dialog interactions   | Apache-2.0                |
| TanStack Query                    | Scoped server-state fetching            | MIT                       |
| Phosphor Icons                    | Consistent interface icon family        | MIT                       |
| Motion                            | Interaction and spotlight motion        | MIT                       |
| Magic UI Magic Card               | Locally adapted branding spotlight      | MIT                       |
| Tailwind CSS                      | Semantic theme integration              | MIT                       |
| NestJS                            | API application boundary                | MIT                       |
| node-postgres                     | Parameterized SQL                       | MIT                       |
| openid-client                     | OIDC protocol implementation            | MIT                       |
| Zod                               | Independent request/response validation | MIT                       |
| Outfit / Public Sans (Fontsource) | Self-hosted variable typefaces          | SIL Open Font License 1.1 |

The original controls in `packages/ui` use React Aria primitives. The adapted [Magic Card source](packages/ui/src/magicui/magic-card.tsx) retains its [MIT notice](packages/ui/src/magicui/LICENSE.md); it was retrieved from `https://magicui.design/r/magic-card.json` on 25 October 2026, then simplified for semantic tokens, reduced motion and this React Router application. No Untitled UI PRO component, commercial template or Dribbble illustration is redistributed. Dribbble references informed hierarchy and visual depth; product illustrations are original CSS. Exact upstream font/package licenses are included in installed packages. A full SBOM and license review are release gates.
