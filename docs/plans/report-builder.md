# Report builder and exports (RPT-01)

Workflow module from the HRMS plan, linked from the backlog (RPT-01), the README and the traceability matrix. It sits beside Insights, which keeps its scoped counts and charts.

## Goal

HR and managers build tabular reports over the HR data they already have access to, save the definitions they reuse, and (HR only) export them as CSV with every export recorded.

## How a report is authorized

A report is never free-form SQL. It is a definition over a fixed catalog of datasets: people, leave, attendance, expenses, assets, policy acknowledgements and exits. Each dataset lists its columns, their types, which are sensitive, and which operators can filter each one. Every identifier comes from the catalog and every value is a bound parameter.

| Role                                                   | Can                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Manager (`report.run`, team)                           | Run people, leave, attendance and expenses reports for their team, with standard columns only. No export, no HR-only datasets. |
| HR admin (`report.run`, `report.export`, organization) | Run every dataset, choose sensitive columns when they ask for them, export CSV, save definitions                               |
| Employee, auditor, platform admin                      | No reports                                                                                                                     |

- **Rows:** a report runs under the same row-level security as the domain screens and also requires the person to be visible in the directory, so it can never show more than those screens.
- **Fields:** sensitive columns (for example leave reasons, decision notes, receipt references, exit reasons) are HR only, never selected by default, and cannot be used to filter or sort for anyone else. No dataset reads email, profile details or documents.

## Run, export and save

- **Run:** up to 1,000 rows on screen, with a total and a truncated flag; one sort, up to 10 filters, up to 20 columns.
- **Export:** CSV only, up to 10,000 rows, HR only. The file is UTF-8 with a byte-order mark, quoted per RFC 4180, with spreadsheet-formula protection on text cells, money in rupees, and a sanitized file name. Truncation is reported in a response header. Ten exports a minute per person.
- **Audit:** every export records the dataset, column keys, filter columns and operators, sort and row count, never filter values or cell values.
- **Saved reports:** per-person, up to 50, unique names, archived rather than deleted. A saved definition is re-checked each time it runs, so it cannot outlive a change in what its owner may see.

## Limits

- No shared or scheduled reports, no formats other than CSV, no grouping, totals or OR filters.
- The people dataset covers active and notice-period employees only.
- Exports are built in memory, not streamed, and are bound by the database statement timeout.
- Policy acknowledgement dates use UTC.

## Tests

- Integration (`tests/reports.integration.ts`): catalog by role, team rows only for managers, sensitive and HR-only refusals, filter and sort whitelists, ILIKE escaping, CSV golden cases including formula injection, export auditing without values, rate limit, saved report ownership, limits and archive, direct-statement refusals.
- Browser (`tests/e2e/reports.spec.ts`): HR builds, runs, saves and exports a report; axe in light and dark; no sideways scroll at 390 px. The device audit covers `/reports`.
