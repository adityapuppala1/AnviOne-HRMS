# Expenses, travel and advances (EXP-01)

Workflow module from the HRMS plan, linked from the backlog (EXP-01), the README and the traceability matrix.

## Goal

People claim expenses, travel costs and advances with a receipt reference. Managers or HR approve within category limits, and HR records payment. Every step is recorded.

## Who does what

| Role                                           | Can                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Employee, manager (`expense.self`, self scope) | Submit claims, see their own and a monthly summary, cancel while a claim is waiting        |
| Manager (`expense.approve`, team scope)        | Approve or reject claims from their direct reports                                         |
| HR admin (`expense.approve`, `expense.manage`) | Approve or reject any claim, manage categories and limits, record payment with a reference |
| Auditor, platform admin                        | No access; changes appear in the activity log                                              |

Nobody decides or pays their own claim.

## Lifecycle

`submitted` → `approved` → `paid`, or `rejected` (needs a reason) or `cancelled` (by the claimant, while submitted). Rejected, paid and cancelled are final. A claim cannot be edited after submission; the person cancels and submits again.

Kinds: expense, travel (needs a destination) and advance (money requested before it is spent).

## Rules the database enforces

- A claim must stay within its category's per-claim limit and the category must be active; above the category's threshold a receipt reference is required.
- Amounts are whole paise in INR, between 1 and 1,000,000,000. Expense dates are within the last 90 days and not in the future (advances may be dated up to 90 days ahead).
- Category name, code and the manager at submission are copied onto the claim, so later edits never rewrite old claims.
- Managers decide only for people they managed at submission and still manage.
- Payment is HR only, needs a reference, and the paid date is not before the expense date or in the future.
- Claims and categories are never deleted; every change is versioned, audited and written to the outbox in one transaction.

## Limits

- No receipt file upload (a text reference only), no multi-currency, no monthly or yearly caps per person.
- Advances are recorded as paid but are not netted against a later claim.
- "Paid" is a record HR makes; no payment is made and nothing is sent to Payroll yet.
- No delegation or second-level approval.

## Tests

- Integration (`tests/expenses.integration.ts`): role access and team scope, self-decision refusals, limit and receipt rules, the full flow, rejection, cancellation, stale versions, category edits leaving old claims alone, direct-statement refusals, audit and outbox.
- Browser (`tests/e2e/expenses.spec.ts`): an employee submits a claim, HR approves and pays another person's claim; axe in light and dark; no sideways scroll at 390 px. The device audit covers `/expenses`.
