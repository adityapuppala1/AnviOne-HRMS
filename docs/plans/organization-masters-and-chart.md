# Organization masters, effective dates, merges and chart (ORG-02)

Workflow module from the HRMS plan, linked from the backlog (ORG-02), the README and the traceability matrix. It extends ORG-01 (departments and locations with immutable codes, rename and inactivation with reasons).

## Goal

HR keeps more kinds of organization records, says when each is in effect, merges duplicates safely, and everyone with directory access can see the reporting structure they are allowed to see.

## What it adds

| Area               | Detail                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More masters       | Designations, grades and cost centres, with the same code, name, uniqueness, reason and audit rules as departments and locations. Employees are not assignable to them yet.                  |
| Effective dates    | `effectiveFrom` and an inclusive `effectiveTo`. Status is `scheduled`, `in_effect`, `ended` or `inactive` in the entity's business date. New assignments need a unit that is in effect.      |
| Safe merge         | Departments and locations only. One transaction moves every employee (including former ones) and unfinished candidates to the target, closes the source for good and records the merge link. |
| Organization chart | The scoped reporting tree (whole tree tab) plus, for everyone, search and a one-level-up, one-level-down neighbourhood of any colleague in 2D and 3D (see ADR 0009).                         |

## Who does what

| Role                    | Can                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| HR admin                | Create, edit, inactivate and merge records (reason of at least 10 characters), see merge history, see the whole entity chart |
| Manager                 | See the chart for themselves and their direct reports                                                                        |
| Employee                | See themselves on the chart                                                                                                  |
| Auditor, platform admin | As before; no merge rights                                                                                                   |

## Rules the database enforces

- Merge is the only path that changes an employee's department or location; it runs as a dedicated function with minimal rights, checks tenant and entity from the session, locks both records in a fixed order, and needs both versions.
- A merge is refused while draft or published policy versions use the source as their audience or active holidays use it as their location; HR must move those first.
- A merged record is closed for ever and cannot be edited, even by the database owner.
- Ending or postponing a unit that still has employees or open candidates is refused (merge instead).
- Every change writes an audit row (no names in merge audit) and an outbox event in one transaction.

## Limits

- Employees are assigned to designations, grades and cost centres by HR on the profile screen (migrations 043-044); merging these three kinds is not supported, so in-use units are retired by reclassifying people first. Grade and cost centre are visible to HR and the person themselves; designation to directory readers.
- The whole-tree tab is still limited to directory access; the search and neighbourhood views deliberately show seven basic fields for every active person in the entity (ADR 0009).
- A merge also rewrites the department or location of former employees, so nothing points at a closed record.
- The chart holds at most 2,000 people and 20 levels, and says when it is partial.

## Tests

- Integration (`tests/organization-v2.integration.ts`): new kinds, effective windows and assignment refusals, merge success, refusals and races, audit counts, chart scope, cycle safety, direct-statement refusals.
- Browser: the existing organization journey plus the chart; axe in light and dark; no sideways scroll at 390 px; the device audit covers `/chart`.
