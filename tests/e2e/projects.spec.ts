import { test, expect, type Page } from "./support/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import pg from "pg";

// Behaviour under test: Projects (HR creates a project, adds a member and a
// task; the member logs and withdraws time). Approval runs through the API in
// tests/projects.integration.ts, because the demo person holds every role and
// nobody may decide their own time.
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
async function role(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// Projects are never deleted through the app, so a run removes its own rows.
async function cleanup(code: string, since: Date) {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^([A-Z_]+)=(.*)$/.exec(line);
        return match ? [[match[1], match[2]]] : [];
      }),
  );
  const pool = new pg.Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    const projects = (
      await client.query<{ id: string }>(
        "SELECT id FROM project WHERE code=$1",
        [code],
      )
    ).rows.map((row) => row.id);
    const tasks = (
      await client.query<{ id: string }>(
        "SELECT id FROM project_task WHERE project_id=ANY($1::uuid[])",
        [projects],
      )
    ).rows.map((row) => row.id);
    const entries = (
      await client.query<{ id: string }>(
        "SELECT id FROM time_entry WHERE project_id=ANY($1::uuid[])",
        [projects],
      )
    ).rows.map((row) => row.id);
    const ids = [...projects, ...tasks, ...entries];
    await client.query(
      "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
      [ids],
    );
    await client.query(
      "DELETE FROM audit_event WHERE target ~ ANY($1::text[]) OR (occurred_at >= $2 AND target ~ '^(project|project-task|time):')",
      [ids.map((id) => `:${id}`), since],
    );
    await client.query(
      "DELETE FROM time_entry WHERE project_id=ANY($1::uuid[])",
      [projects],
    );
    await client.query(
      "DELETE FROM project_task WHERE project_id=ANY($1::uuid[])",
      [projects],
    );
    await client.query(
      "DELETE FROM project_member WHERE project_id=ANY($1::uuid[])",
      [projects],
    );
    await client.query("DELETE FROM project WHERE id=ANY($1::uuid[])", [
      projects,
    ]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("HR sets up a project; a member logs and withdraws time", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const since = new Date();
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  const code = `E2E${tag}`;
  const name = `Synthetic project ${tag}`;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Good to see you, Maya." }),
    ).toBeVisible();

    // HR (the default role) creates the project.
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Projects", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Projects" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Time approvals" }),
    ).toBeVisible();
    await accessible(page);
    await page.getByRole("button", { name: "New project" }).click();
    const create = page.getByRole("dialog", { name: "New project" });
    await create.getByLabel("Project code").fill(code);
    await create.getByLabel("Project name").fill(name);
    // Time can only be logged on an active project.
    await create.getByRole("button", { name: /Starting status/ }).click();
    await page.getByRole("option", { name: "Active" }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await accessible(page);
    await create.getByRole("button", { name: "Create project" }).click();

    // It opens in details: add Maya as a member and a task.
    const details = page.getByRole("dialog", { name: "Project details" });
    await expect(details).toContainText(name);
    await details.getByRole("button", { name: "Add member" }).click();
    const add = page.getByRole("dialog", { name: "Add member" });
    await add.getByLabel("Find a person").fill("Maya");
    await add
      .getByRole("list", { name: "People found" })
      .getByRole("button")
      .first()
      .click();
    await add.getByRole("button", { name: "Add member" }).click();
    await expect(details.getByText("Maya Iyer").first()).toBeVisible();
    await details.getByRole("button", { name: "Add task" }).click();
    const task = page.getByRole("dialog", { name: "Add task" });
    await task.getByLabel("Title").fill(`Draft the plan ${tag}`);
    await task.getByRole("button", { name: "Add task" }).click();
    await expect(details.getByText(`Draft the plan ${tag}`)).toBeVisible();
    await accessible(page);
    await page.screenshot({ path: info.outputPath("projects-hr-detail.png") });
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);

    // Search finds it and a row opens it again.
    await page.getByRole("textbox", { name: "Search projects" }).fill(code);
    await page.getByRole("button", { name: `Open ${name}` }).click();
    await expect(
      page.getByRole("dialog", { name: "Project details" }),
    ).toContainText(name);
    await page.keyboard.press("Escape");

    // HR cannot decide their own time; the page says so honestly.
    await page.getByRole("tab", { name: "Time approvals" }).click();
    await expect(
      page.getByText("You cannot decide your own time.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Time is recorded for approval only; it does not feed payroll or billing.",
      ),
    ).toBeVisible();
    await accessible(page);

    // The member logs time, then withdraws it.
    await role(page, "Employee");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByRole("tab", { name: "My time" }).click();
    await page
      .getByRole("button", { name: "Log time", exact: true })
      .first()
      .click();
    const log = page.getByRole("dialog", { name: "Log time" });
    await log.getByRole("button", { name: /Project/ }).click();
    await page.getByRole("option", { name: new RegExp(code) }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await log.getByRole("button", { name: /Duration/ }).click();
    await page.getByRole("option", { name: "1h 30m", exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await log.getByLabel("Note").fill(`Planning ${tag}`);
    await accessible(page);
    await log.getByRole("button", { name: "Log time" }).click();
    await expect(page.getByRole("dialog", { name: "Log time" })).toHaveCount(0);
    await expect(page.getByText(`Planning ${tag}`)).toBeVisible();
    await expect(page.getByText("Awaiting decision").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("projects-my-time.png") });
    await page
      .getByRole("button", { name: /^Withdraw/ })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Withdraw this time?" })
      .getByRole("button", { name: "Withdraw time" })
      .click();
    await expect(page.getByText("Withdrawn").first()).toBeVisible();

    // Dark mode and a phone: still accessible, nothing wider than the screen.
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await accessible(page);
    await page.getByRole("tab", { name: "Projects" }).click();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("projects-mobile.png") });
  } finally {
    await cleanup(code, since);
  }
});
