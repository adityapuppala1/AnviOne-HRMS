import type { Permission } from "@anvi/authz";
import type { ReportDataset, ReportOperator } from "@anvi/contracts";

// The fixed report catalog. Every SQL fragment here is a constant written by us; a
// report definition can only pick keys from it. Rows are read under the caller's normal
// row-level security, so a row appears exactly when the domain policy shows it. Person
// columns come from a LEFT JOIN to employee_directory: org_unit rows stay readable after
// a merge or end date (the view never filters on active) and exited employees stay in
// employee, so HR loses nothing; a manager sees blank person columns (not a missing
// row) when a domain row's person is outside their directory scope, e.g. a claim routed
// to them before a reporting change. No dataset reads contact details, profile tables or
// document content.
export type ColumnType = "text" | "enum" | "number" | "money" | "date";
export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  // Sensitive columns are selectable, filterable and sortable by HR (entity scope) only.
  sensitive?: boolean;
  select: string;
  // Typed expression used for filters and sorting; defaults to `select`.
  value?: string;
  options?: readonly string[];
  operators?: readonly ReportOperator[];
}
export interface DatasetDef {
  key: ReportDataset;
  label: string;
  description: string;
  // HR-only datasets need entity reporting scope.
  hrOnly: boolean;
  // The domain permission the caller must also hold, so a report never shows a
  // domain the caller's own screens do not.
  requires: Permission;
  from: string;
  where?: string;
  tiebreak: string;
  columns: readonly ColumnDef[];
}

export const defaultOperators: Record<ColumnType, readonly ReportOperator[]> = {
  text: ["eq", "in", "contains"],
  enum: ["eq", "in"],
  number: ["eq", "between", "gte", "lte"],
  money: ["eq", "between", "gte", "lte"],
  date: ["eq", "between", "gte", "lte"],
};
export const operatorsFor = (column: ColumnDef) =>
  column.operators ?? defaultOperators[column.type];

const date = (expr: string) => ({
  select: `to_char(${expr},'YYYY-MM-DD')`,
  value: expr,
});
const person = (alias = "d") =>
  [
    {
      key: "employeeName",
      label: "Employee",
      type: "text",
      select: `${alias}.name`,
    },
    {
      key: "employeeCode",
      label: "Employee code",
      type: "text",
      select: `${alias}.code`,
    },
    {
      key: "department",
      label: "Department",
      type: "text",
      select: `${alias}.department`,
    },
  ] as const satisfies readonly ColumnDef[];

export const datasets: readonly DatasetDef[] = [
  {
    key: "people",
    label: "People",
    description:
      "Current employees (active or on notice) in your directory scope. Work details only; no contact or personal data.",
    hrOnly: false,
    requires: "directory.read",
    from: "employee_directory d LEFT JOIN employee_directory m ON m.id=d.manager_id",
    where: "d.status IN ('active','notice')",
    tiebreak: "d.id",
    columns: [
      { key: "name", label: "Name", type: "text", select: "d.name" },
      { key: "code", label: "Employee code", type: "text", select: "d.code" },
      {
        key: "department",
        label: "Department",
        type: "text",
        select: "d.department",
      },
      {
        key: "location",
        label: "Location",
        type: "text",
        select: "d.location",
      },
      { key: "title", label: "Title", type: "text", select: "d.title" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        select: "d.status",
        options: ["active", "notice"],
      },
      {
        key: "joinedOn",
        label: "Joined on",
        type: "date",
        ...date("d.joined_on"),
      },
      { key: "managerName", label: "Manager", type: "text", select: "m.name" },
    ],
  },
  {
    key: "leave",
    label: "Leave requests",
    description:
      "Leave requests you can review: your team's, or the organization's for HR.",
    hrOnly: false,
    requires: "leave.approve",
    from: `leave_request r LEFT JOIN employee_directory d ON d.id=r.employee_id
      JOIN leave_type lt ON lt.tenant_id=r.tenant_id AND lt.entity_id=r.entity_id AND lt.id=r.leave_type_id`,
    tiebreak: "r.id",
    columns: [
      ...person(),
      {
        key: "leaveType",
        label: "Leave type",
        type: "text",
        select: "lt.name",
      },
      {
        key: "startDate",
        label: "Start date",
        type: "date",
        ...date("r.start_date"),
      },
      {
        key: "endDate",
        label: "End date",
        type: "date",
        ...date("r.end_date"),
      },
      { key: "days", label: "Days", type: "number", select: "r.days::float8" },
      {
        key: "state",
        label: "State",
        type: "enum",
        select: "r.state",
        options: ["pending", "approved", "rejected", "cancelled"],
      },
      {
        key: "reason",
        label: "Reason",
        type: "text",
        sensitive: true,
        select: "r.reason",
      },
      {
        key: "decisionNote",
        label: "Decision note",
        type: "text",
        sensitive: true,
        select: "r.decision_note",
      },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    description:
      "Daily check-in records you can review: your team's, or the organization's for HR.",
    hrOnly: false,
    requires: "attendance.review",
    from: "attendance_record a LEFT JOIN employee_directory d ON d.id=a.employee_id",
    tiebreak: "a.id",
    columns: [
      ...person(),
      { key: "workDate", label: "Date", type: "date", ...date("a.work_date") },
      {
        key: "status",
        label: "Status",
        type: "enum",
        select: "CASE WHEN a.check_out IS NULL THEN 'open' ELSE 'complete' END",
        options: ["open", "complete"],
      },
      {
        key: "checkIn",
        label: "Check-in",
        type: "text",
        select: "to_char(a.check_in,'HH24:MI')",
        value: "a.check_in",
        operators: [],
      },
      {
        key: "checkOut",
        label: "Check-out",
        type: "text",
        select: "to_char(a.check_out,'HH24:MI')",
        value: "a.check_out",
        operators: [],
      },
      {
        key: "source",
        label: "Source",
        type: "enum",
        select: "a.source",
        options: ["web", "correction"],
      },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    description:
      "Expense, travel and advance claims you can review: your team's, or the organization's for HR.",
    hrOnly: false,
    requires: "expense.approve",
    from: "expense_claim c LEFT JOIN employee_directory d ON d.id=c.employee_id",
    tiebreak: "c.id",
    columns: [
      ...person(),
      { key: "title", label: "Title", type: "text", select: "c.title" },
      {
        key: "kind",
        label: "Kind",
        type: "enum",
        select: "c.kind",
        options: ["expense", "advance", "travel"],
      },
      {
        key: "category",
        label: "Category",
        type: "text",
        select: "c.category_name",
      },
      {
        key: "amount",
        label: "Amount (INR)",
        type: "money",
        select: "c.amount_minor::float8",
        value: "c.amount_minor",
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        select: "c.status",
        options: ["submitted", "approved", "rejected", "paid", "cancelled"],
      },
      {
        key: "expenseDate",
        label: "Expense date",
        type: "date",
        ...date("c.expense_date"),
      },
      { key: "paidOn", label: "Paid on", type: "date", ...date("c.paid_on") },
      {
        key: "tripDestination",
        label: "Trip destination",
        type: "text",
        select: "c.trip_destination",
      },
      {
        key: "description",
        label: "Description",
        type: "text",
        sensitive: true,
        select: "c.description",
      },
      {
        key: "receiptReference",
        label: "Receipt reference",
        type: "text",
        sensitive: true,
        select: "c.receipt_reference",
      },
      {
        key: "decisionNote",
        label: "Decision note",
        type: "text",
        sensitive: true,
        select: "c.decision_note",
      },
      {
        key: "paymentReference",
        label: "Payment reference",
        type: "text",
        sensitive: true,
        select: "c.payment_reference",
      },
    ],
  },
  {
    key: "assets",
    label: "Assets",
    description: "Company assets and who holds them now. HR only.",
    hrOnly: true,
    requires: "asset.manage",
    from: `asset a LEFT JOIN asset_assignment aa ON aa.asset_id=a.id AND aa.returned_on IS NULL
      LEFT JOIN employee_directory h ON h.id=aa.employee_id`,
    tiebreak: "a.id",
    columns: [
      { key: "tag", label: "Tag", type: "text", select: "a.tag" },
      { key: "name", label: "Name", type: "text", select: "a.name" },
      {
        key: "category",
        label: "Category",
        type: "enum",
        select: "a.category",
        options: [
          "laptop",
          "phone",
          "monitor",
          "accessory",
          "access_card",
          "other",
        ],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        select: "a.status",
        options: ["available", "assigned", "in_repair", "retired", "lost"],
      },
      {
        key: "condition",
        label: "Condition",
        type: "enum",
        select: "a.condition",
        options: ["new", "good", "fair", "damaged"],
      },
      { key: "holderName", label: "Holder", type: "text", select: "h.name" },
      {
        key: "holderCode",
        label: "Holder code",
        type: "text",
        select: "h.code",
      },
      {
        key: "issuedOn",
        label: "Issued on",
        type: "date",
        ...date("aa.issued_on"),
      },
    ],
  },
  {
    key: "policyAcknowledgements",
    label: "Policy acknowledgements",
    description: "Who acknowledged which policy version, and when. HR only.",
    hrOnly: true,
    requires: "policy.manage",
    from: `policy_acknowledgement k JOIN policy_version v ON v.id=k.policy_version_id
      JOIN policy p ON p.id=v.policy_id LEFT JOIN employee_directory d ON d.id=k.employee_id`,
    tiebreak: "k.id",
    columns: [
      {
        key: "policyCode",
        label: "Policy code",
        type: "text",
        select: "p.code",
      },
      { key: "policyTitle", label: "Policy", type: "text", select: "v.title" },
      {
        key: "versionNumber",
        label: "Version",
        type: "number",
        select: "v.version_number",
      },
      {
        key: "category",
        label: "Category",
        type: "enum",
        select: "p.category",
        options: [
          "conduct",
          "leave",
          "it_security",
          "safety",
          "compliance",
          "other",
        ],
      },
      ...person(),
      {
        key: "acknowledgedOn",
        label: "Acknowledged on (UTC)",
        type: "date",
        ...date("(k.acknowledged_at AT TIME ZONE 'UTC')::date"),
      },
    ],
  },
  {
    key: "exits",
    label: "Exits",
    description:
      "Exit cases with notice dates and clearance progress. HR only.",
    hrOnly: true,
    requires: "exit.manage",
    from: `exit_case x LEFT JOIN employee_directory d ON d.id=x.employee_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS total, (count(*) FILTER (WHERE cl.status<>'pending'))::int AS done
        FROM exit_clearance cl WHERE cl.case_id=x.id) cl ON true`,
    tiebreak: "x.id",
    columns: [
      ...person(),
      {
        key: "kind",
        label: "Kind",
        type: "enum",
        select: "x.kind",
        options: [
          "resignation",
          "termination",
          "end_of_contract",
          "retirement",
          "other",
        ],
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        select: "x.status",
        options: [
          "submitted",
          "accepted",
          "completed",
          "withdrawn",
          "rejected",
        ],
      },
      {
        key: "noticeGivenOn",
        label: "Notice given on",
        type: "date",
        ...date("x.notice_given_on"),
      },
      {
        key: "lastWorkingDay",
        label: "Last working day",
        type: "date",
        ...date("x.last_working_day"),
      },
      {
        key: "clearancesDone",
        label: "Clearances done",
        type: "number",
        select: "cl.done",
      },
      {
        key: "clearancesTotal",
        label: "Clearances total",
        type: "number",
        select: "cl.total",
      },
      {
        key: "clearanceProgress",
        label: "Clearance progress",
        type: "text",
        select: "cl.done::text||'/'||cl.total::text",
        operators: [],
      },
      {
        key: "reason",
        label: "Reason",
        type: "text",
        sensitive: true,
        select: "x.reason",
      },
      {
        key: "decisionNote",
        label: "Decision note",
        type: "text",
        sensitive: true,
        select: "x.decision_note",
      },
    ],
  },
];

export const datasetByKey = new Map(datasets.map((d) => [d.key, d]));
