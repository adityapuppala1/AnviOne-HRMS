# Company assets (AST-01)

Workflow module from the HRMS plan. It supersedes nothing; it is linked from the backlog (AST-01), the README and the traceability matrix.

## Goal

HR keeps an inventory of company equipment, issues items to employees, records what comes back, and has evidence that the holder confirmed receipt.

## Who does what

| Role                                            | Can                                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HR admin (`asset.manage`, organization scope)   | Register assets, edit details with a reason, issue to a current employee, receive returns with a condition, send for repair, mark lost, retire, return to stock, see the full history |
| Employee and manager (`asset.self`, self scope) | See the assets issued to them and past ones, confirm receipt (acknowledge) once                                                                                                       |
| Auditor, platform admin                         | No access; changes appear in the activity log                                                                                                                                         |

Acknowledgement belongs to the holder, so HR confirms receipt of their own equipment in the Employee context, the same way documents are handled.

## Lifecycle

`available` → issued (`assigned`) → returned to `available`, or `in_repair` when returned damaged. An issued asset can be marked `lost`, which closes its assignment with a reason. `in_repair` and `lost` can return to stock or be `retired`; **retired is final**.

Each issue creates an assignment that records the holder, issue date and condition, who issued it, when the holder confirmed, and later the return date, condition, note and who received it. An assignment keeps a snapshot of the asset's tag, name, category and serial, so a past holder still sees what they held and history stays accurate if an asset is renamed.

## Rules the database enforces

Guards run as a keeper role under FORCE row-level security, so they hold for any statement, not only the API:

- Only HR registers, edits, issues and receives; only the holder acknowledges, and only once.
- One open assignment per asset; at most 20 assets per person; issue only to current employees; no future issue dates; no issue date before the asset existed or overlapping the previous holder.
- Status changes follow the allowed paths; an issued asset must come back before repair or retirement; a damaged return needs a description.
- Assets and history are never deleted (no DELETE permission and a refusing trigger).
- At commit, an asset is `assigned` exactly when it has an open assignment for its holder.
- Every change is versioned (stale edits get a conflict) and writes an audit record and an outbox event in the same transaction.

## Tests

- Integration (`tests/assets.integration.ts`, 10 checks): registration and tag rules; role access; the full issue, acknowledge and return history; people only see their own assignments and cannot acknowledge another's; allowed and refused status paths including lost and retired; search, filters and counts; audit and outbox for every action; the database refusing direct statements (employee writes, skipped lifecycle, deletes, rewriting facts, inconsistent commits); issue-date limits; retired assets cannot be edited.
- Browser (`tests/e2e/assets.spec.ts`): HR registers and issues; the holder confirms; HR receives it back; axe in light and dark; no sideways scroll at 390 px. The device audit also covers `/assets`.

## Reviews

An Opus review found no row-security bypass, injection or deletable history. Its findings were applied: issue-date limits, the commit-time consistency rule, retired assets final, narrower duplicate-tag handling and audit details for acknowledgements. Its point about HR acknowledging in the HR context is by design (see above).

## Not included

Recovery of equipment when someone leaves (EXT-01), depreciation, barcode or QR labels, bulk import, maintenance schedules, and a visible flag for assets still held by someone who has left. A deployment with a single HR person can issue equipment to themselves; a second approver is a policy decision for later.
