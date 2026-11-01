import { scopeFor, type Principal } from "@anvi/authz";
import { scoped } from "@anvi/database";
import { insightsSchema, type Insights } from "@anvi/contracts";
import type { PlatformStore } from "./platform.store";

const LIVE = "status IN ('active','notice')";

// Read-only workforce counts. Every query runs inside the caller's scoped
// transaction, so row-level security limits each figure to what that person may
// already see: a manager's numbers describe their team, HR's the organization.
export class InsightsStore {
  constructor(private readonly platform: PlatformStore) {}

  async overview(actor: Principal): Promise<Insights> {
    this.platform.require(actor, "insights.read");
    const scope =
      scopeFor(actor, "insights.read") === "team" ? "team" : "entity";
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows: dates } = await client.query<{ today: string }>(
        "SELECT to_char(leave_entity_today(),'YYYY-MM-DD') AS today",
      );
      const today = dates[0]!.today;
      const year = Number(today.slice(0, 4));

      const people = (
        await client.query<{ total: number; joined: number; notice: number }>(
          `SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE joined_on >= $1::date - 90))::int AS joined,
             (count(*) FILTER (WHERE status='notice'))::int AS notice
           FROM employee_directory WHERE ${LIVE}`,
          [today],
        )
      ).rows[0]!;
      const group = async (column: "department" | "location") =>
        (
          await client.query<{ name: string; count: number }>(
            `SELECT ${column} AS name, count(*)::int AS count FROM employee_directory
             WHERE ${LIVE} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`,
          )
        ).rows;
      const joiners = await client.query<{ month: string; value: number }>(
        `SELECT to_char(m,'YYYY-MM') AS month, count(e.id)::int AS value
         FROM generate_series(date_trunc('month',$1::date) - interval '5 months',
                              date_trunc('month',$1::date), interval '1 month') m
         LEFT JOIN employee_directory e ON e.joined_on >= m AND e.joined_on < m + interval '1 month' AND e.${LIVE}
         GROUP BY m ORDER BY m`,
        [today],
      );

      // The EXISTS applies the employee policy, so leave follows the same reporting
      // line as headcount instead of the manager recorded on each request.
      const visible =
        "EXISTS (SELECT 1 FROM employee v WHERE v.id=r.employee_id)";
      const leaveWindow = `r.state='approved' AND r.start_date >= make_date($1,1,1)
                           AND r.start_date < make_date($1+1,1,1) AND ${visible}`;
      const byType = await client.query<{ name: string; days: number }>(
        `SELECT lt.name, (sum(r.days))::float8 AS days FROM leave_request r
         JOIN leave_type lt ON lt.tenant_id=r.tenant_id AND lt.entity_id=r.entity_id AND lt.id=r.leave_type_id
         WHERE ${leaveWindow} GROUP BY lt.name ORDER BY 2 DESC, 1 LIMIT 10`,
        [year],
      );
      const leaveMonths = await client.query<{ month: string; value: number }>(
        `SELECT to_char(m,'YYYY-MM') AS month, coalesce(sum(r.days),0)::float8 AS value
         FROM generate_series(make_date($1,1,1), make_date($1,12,1), interval '1 month') m
         LEFT JOIN leave_request r ON r.state='approved' AND r.start_date >= m AND r.start_date < m + interval '1 month'
           AND EXISTS (SELECT 1 FROM employee v WHERE v.id=r.employee_id)
         GROUP BY m ORDER BY m`,
        [year],
      );
      const open = (
        await client.query<{ pending: number; away: number }>(
          `SELECT (count(*) FILTER (WHERE r.state='pending'))::int AS pending,
             (count(DISTINCT r.employee_id) FILTER (WHERE r.state='approved'))::int AS away
           FROM leave_request r
           WHERE (r.state='pending'
                  OR (r.state='approved' AND r.start_date <= $1::date AND r.end_date >= $1::date))
             AND ${visible}`,
          [today],
        )
      ).rows[0]!;

      const attendance = await client.query<{ date: string; present: number }>(
        `SELECT to_char(d,'YYYY-MM-DD') AS date, count(a.id)::int AS present
         FROM generate_series($1::date - 13, $1::date, interval '1 day') d
         LEFT JOIN attendance_record a ON a.work_date=d::date
         GROUP BY d ORDER BY d`,
        [today],
      );

      return insightsSchema.parse({
        scope,
        today,
        people: {
          total: people.total,
          joinedLast90Days: people.joined,
          onNotice: people.notice,
          byDepartment: await group("department"),
          byLocation: await group("location"),
          joinersByMonth: joiners.rows,
        },
        leave: {
          year,
          daysApproved: byType.rows.reduce((sum, r) => sum + r.days, 0),
          pendingRequests: open.pending,
          onLeaveToday: open.away,
          byType: byType.rows,
          byMonth: leaveMonths.rows,
        },
        attendance: { headcount: people.total, days: attendance.rows },
      });
    });
  }
}
