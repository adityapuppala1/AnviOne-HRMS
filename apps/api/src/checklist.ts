import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "@anvi/database";
import {
  candidateTaskSchema,
  type candidateTaskUpdateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
export async function readTasks(
  client: PoolClient,
  id: string,
  candidateOnly = false,
) {
  const waiting = candidateOnly
    ? "candidate_task_waiting(t.id)"
    : "(t.depends_on IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_task d WHERE d.candidate_id=t.candidate_id AND d.id=t.depends_on AND d.state='completed'))";
  const { rows } = await client.query(
    `SELECT t.id,t.label,t.owner,t.required,t.due_on::text AS "dueOn",t.depends_on AS "dependsOn",t.state,t.version,t.note,t.updated_at AS "updatedAt",${waiting} AS "waitingOn",(t.state<>'completed' AND t.due_on<(now() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue FROM candidate_task t WHERE t.candidate_id=$1 ${candidateOnly ? "AND t.owner='candidate'" : ""} ORDER BY t.due_on,t.created_at,t.id`,
    [id],
  );
  return rows.map((r) =>
    candidateTaskSchema.parse({ ...r, updatedAt: r.updatedAt.toISOString() }),
  );
}
export async function changeTask(
  client: PoolClient,
  id: string,
  taskId: string,
  input: z.infer<typeof candidateTaskUpdateSchema>,
  candidateOnly = false,
) {
  const task = (await readTasks(client, id, candidateOnly)).find(
    (t) => t.id === taskId,
  );
  if (!task) throw new NotFoundException("This checklist task is unavailable.");
  if (task.version !== input.version)
    throw new ConflictException(
      "This task changed. Reload before updating it.",
    );
  if (task.state === input.state)
    throw new ConflictException("This task already has that status.");
  if (input.state === "completed" && task.waitingOn)
    throw new ConflictException("Complete the prerequisite before this task.");
  try {
    await client.query(
      "UPDATE candidate_task SET state=$3,note=$4,version=version+1,updated_at=now() WHERE candidate_id=$1 AND id=$2",
      [id, taskId, input.state, input.reason],
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23514"
    )
      throw new ConflictException(
        "This change conflicts with a prerequisite or completed dependent. Reopen dependent tasks first, or ask HR for help.",
      );
    throw error;
  }
}
