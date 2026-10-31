import { scopeFor, type Principal } from "@anvi/authz";
import { scoped } from "@anvi/database";
import { updatesSchema, type Updates, type UpdateItem } from "@anvi/contracts";
import type { PlatformStore } from "./platform.store";

type Row = {
  id: string;
  outcome: UpdateItem["outcome"];
  title: string;
  from: string | null;
  to: string | null;
  decidedBy: string | null;
  note: string | null;
  at: Date;
};

const WINDOW = "interval '30 days'";

// Decisions other people made on the caller's own requests in the last 30 days.
// Row-level security lets managers and HR see other people's records, so every
// query filters on the caller's own employee id as well; the feed is never a
// way to browse anyone else's activity.
export class UpdatesStore {
  constructor(private readonly platform: PlatformStore) {}

  async feed(actor: Principal): Promise<Updates> {
    return scoped(this.platform.pool, actor, async (client) => {
      const me = actor.employeeId;
      const items: UpdateItem[] = [];
      const push = (kind: UpdateItem["kind"], rows: Row[]) => {
        for (const row of rows)
          items.push({
            id: row.id,
            kind,
            outcome: row.outcome,
            title: row.title,
            from: row.from,
            to: row.to,
            decidedBy: row.decidedBy,
            note: row.note,
            at: row.at.toISOString(),
          });
      };
      if (scopeFor(actor, "leave.request"))
        push(
          "leave",
          (
            await client.query<Row>(
              `SELECT r.id,
                 CASE r.state WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome,
                 left(lt.name || ', ' || trim(trailing '.' FROM trim(trailing '0' FROM r.days::text)) ||
                   CASE WHEN r.days=1 THEN ' day' ELSE ' days' END, 120) AS title,
                 to_char(r.start_date,'YYYY-MM-DD') AS "from", to_char(r.end_date,'YYYY-MM-DD') AS "to",
                 r.decided_by_label AS "decidedBy", r.decision_note AS note, r.decided_at AS at
               FROM leave_request r
               JOIN leave_type lt ON lt.tenant_id=r.tenant_id AND lt.entity_id=r.entity_id AND lt.id=r.leave_type_id
               WHERE r.employee_id=$1 AND r.state IN ('approved','rejected')
                 AND r.decided_at > now() - ${WINDOW}
               ORDER BY r.decided_at DESC LIMIT 20`,
              [me],
            )
          ).rows,
        );
      if (scopeFor(actor, "attendance.self"))
        push(
          "attendance",
          (
            await client.query<Row>(
              `SELECT c.id,
                 CASE c.state WHEN 'approved' THEN 'approved' ELSE 'declined' END AS outcome,
                 'Attendance correction' AS title,
                 to_char(c.work_date,'YYYY-MM-DD') AS "from", NULL::text AS "to",
                 c.decided_by_label AS "decidedBy", c.decision_note AS note, c.decided_at AS at
               FROM attendance_correction c
               WHERE c.employee_id=$1 AND c.state IN ('approved','rejected')
                 AND c.decided_at > now() - ${WINDOW}
               ORDER BY c.decided_at DESC LIMIT 20`,
              [me],
            )
          ).rows,
        );
      if (scopeFor(actor, "document.self"))
        push(
          "document",
          (
            await client.query<Row>(
              `SELECT d.id, d.status AS outcome, left(d.title, 120) AS title,
                 NULL::text AS "from", NULL::text AS "to",
                 d.reviewer_label AS "decidedBy", d.review_note AS note, d.reviewed_at AS at
               FROM employee_document d
               WHERE d.employee_id=$1 AND d.status IN ('verified','rejected')
                 AND d.reviewed_at > now() - ${WINDOW}
               ORDER BY d.reviewed_at DESC LIMIT 20`,
              [me],
            )
          ).rows,
        );
      items.sort((a, b) => b.at.localeCompare(a.at));
      return updatesSchema.parse({ items: items.slice(0, 30) });
    });
  }
}
