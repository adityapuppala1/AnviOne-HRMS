import { test, expect, type Page } from "./support/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import pg from "pg";

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

function connection() {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^([A-Z_]+)=(.*)$/.exec(line);
        return match ? [[match[1], match[2]]] : [];
      }),
  );
  return new pg.Pool({ connectionString: env.MIGRATION_DATABASE_URL });
}

// The demo person holds every role and HR may not decide their own case, so
// HR takes another active employee (holding no equipment) through the exit.
async function people() {
  const pool = connection();
  try {
    const leaver = (
      await pool.query<{ name: string; id: string }>(
        `SELECT p.name, e.id FROM employee e
         JOIN person p ON p.id=e.person_id AND p.tenant_id=e.tenant_id
         WHERE e.status='active' AND p.name<>'Maya Iyer'
           AND NOT EXISTS(SELECT 1 FROM asset_assignment a WHERE a.employee_id=e.id AND a.returned_on IS NULL)
         ORDER BY p.name LIMIT 1`,
      )
    ).rows[0]!;
    const maya = (
      await pool.query<{ id: string }>(
        `SELECT e.id FROM employee e
         JOIN person p ON p.id=e.person_id AND p.tenant_id=e.tenant_id
         WHERE p.name='Maya Iyer' LIMIT 1`,
      )
    ).rows[0]!;
    return { leaver, maya: maya.id };
  } finally {
    await pool.end();
  }
}

// Exit cases are never deleted through the app, so a run removes its own
// synthetic rows and puts the people back to active.
async function cleanup(employeeIds: string[]) {
  const pool = connection();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    const cases = (
      await client.query<{ id: string }>(
        "SELECT id FROM exit_case WHERE employee_id=ANY($1::uuid[])",
        [employeeIds],
      )
    ).rows.map((row) => row.id);
    if (cases.length) {
      const clearances = (
        await client.query<{ id: string }>(
          "SELECT id FROM exit_clearance WHERE case_id=ANY($1::uuid[])",
          [cases],
        )
      ).rows.map((row) => row.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...cases, ...clearances]],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [cases.map((id) => `^exit:${id}`)],
      );
      await client.query(
        "DELETE FROM exit_clearance WHERE case_id=ANY($1::uuid[])",
        [cases],
      );
      await client.query("DELETE FROM exit_case WHERE id=ANY($1::uuid[])", [
        cases,
      ]);
    }
    await client.query(
      "UPDATE employee SET status='active' WHERE id=ANY($1::uuid[])",
      [employeeIds],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("an employee resigns and withdraws; HR takes another exit through clearance to completion", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const { leaver, maya } = await people();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Good to see you, Maya." }),
    ).toBeVisible();

    // The employee resigns, sees where it stands, then changes their mind.
    await role(page, "Employee");
    await page.getByRole("link", { name: "Exit", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Leaving the company", level: 1 }),
    ).toBeVisible();
    await accessible(page);
    await page
      .getByRole("button", { name: "Submit resignation" })
      .first()
      .click();
    const resign = page.getByRole("dialog", { name: "Submit resignation" });
    await resign
      .getByLabel("Why are you leaving?")
      .fill("Moving cities for family reasons.");
    await accessible(page);
    await resign.getByRole("button", { name: "Submit resignation" }).click();
    await expect(page.getByText("Awaiting decision").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("exit-employee.png") });
    await page
      .getByRole("button", { name: "Withdraw resignation" })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Withdraw resignation" })
      .getByRole("button", { name: "Withdraw resignation" })
      .click();
    await expect(page.getByText("Withdrawn").first()).toBeVisible();

    // HR starts an exit for someone else and works it through.
    await role(page, "HR admin");
    await page.getByRole("link", { name: "Exit", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Exits", level: 1 }),
    ).toBeVisible();
    await accessible(page);
    await page.getByRole("button", { name: "Start an exit" }).first().click();
    const start = page.getByRole("dialog", { name: "Start an exit" });
    await start
      .getByLabel("Find the employee")
      .fill(leaver.name.split(" ")[0]!);
    await start
      .getByRole("button", { name: new RegExp(leaver.name) })
      .first()
      .click();
    await start
      .getByLabel("Reason", { exact: true })
      .fill("Contract ends after the project closes.");
    await start.getByRole("button", { name: "Start exit" }).click();

    // The new case opens in its details straight away.
    const details = page.getByRole("dialog", { name: "Exit details" });
    await details.getByRole("button", { name: "Accept", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Accept exit" })
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    for (const item of [
      "Company assets",
      "Finance dues",
      "IT access",
      "Manager handover",
      "HR documents",
    ]) {
      await details.getByRole("button", { name: `Clear ${item}` }).click();
      await expect(
        details.getByRole("button", { name: `Reopen ${item}` }),
      ).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath("exit-hr-details.png") });
    await details.getByRole("button", { name: "Complete exit" }).click();
    const complete = page.getByRole("dialog", { name: "Complete exit" });
    await complete.getByLabel("Early release").check();
    await complete
      .getByLabel("Reason for early release")
      .fill("Project finished ahead of schedule.");
    await accessible(page);
    await complete.getByRole("button", { name: "Complete exit" }).click();
    await expect(
      page.getByRole("dialog", { name: "Exit details" }),
    ).toContainText("Completed");
    await page.keyboard.press("Escape");

    // Dark mode and a phone: still accessible, nothing wider than the screen.
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("exit-mobile.png") });
  } finally {
    await cleanup([leaver.id, maya]);
  }
});
