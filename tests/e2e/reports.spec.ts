import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

// Behaviour under test: the Reports module. HR builds, runs, saves, exports
// and archives a report; a manager sees the narrower catalog and no export.
// The rules underneath (field authorization, CSV safety, limits) run through
// the API in tests/reports.integration.ts.
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

// Saved reports are archived, never deleted, and exports leave audit rows, so
// a run removes what it created since it started.
async function cleanup(tag: string, since: Date) {
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
    const ids = (
      await client.query<{ id: string }>(
        "SELECT id FROM report_definition WHERE name LIKE $1 OR name='Smoke people'",
        [`%${tag}%`],
      )
    ).rows.map((row) => row.id);
    await client.query(
      "DELETE FROM outbox_event WHERE event_type LIKE 'report.%' AND occurred_at >= $1",
      [since],
    );
    await client.query(
      "DELETE FROM audit_event WHERE action LIKE 'report.%' AND occurred_at >= $1",
      [since],
    );
    if (ids.length) {
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [ids.map((id) => `^report:${id}`)],
      );
      await client.query(
        "DELETE FROM report_definition WHERE id=ANY($1::uuid[])",
        [ids],
      );
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("HR builds, saves, exports and archives a report; a manager has no export", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const since = new Date(Date.now() - 5000);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const name = `Headcount ${tag}`;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: /Good to see you/ }),
    ).toBeVisible();

    // HR builds and runs a people report.
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 }),
    ).toBeVisible();
    await page.getByRole("radio", { name: /^People/ }).check();
    await page.getByRole("button", { name: "Run report" }).click();
    await expect(
      page.getByRole("grid", { name: "Report results" }),
    ).toBeVisible();
    await accessible(page);
    await page.screenshot({ path: info.outputPath("reports-hr.png") });

    // Save it, then export it.
    await page.getByRole("button", { name: "Save report" }).click();
    const save = page.getByRole("dialog", { name: "Save report" });
    await save.getByRole("textbox", { name: "Report name" }).fill(name);
    await save.getByRole("button", { name: "Save report" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.csv$/);
    const bytes = readFileSync((await download.path()) as string);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    // The saved report is listed and can be archived.
    await page.getByRole("tab", { name: "Saved reports" }).click();
    await expect(page.getByText(name).first()).toBeVisible();
    await page.getByRole("button", { name: `Archive ${name}` }).click();
    await page
      .getByRole("dialog", { name: "Archive report" })
      .getByRole("button", { name: "Archive report" })
      .click();
    await expect(page.getByText(name)).toHaveCount(0);

    // A manager sees the narrower catalog and no export.
    await role(page, "Team manager");
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Assets/ })).toHaveCount(0);
    await page.getByRole("radio", { name: /^People/ }).check();
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(
      0,
    );
    await expect(page.getByText("Exports are available to HR.")).toBeVisible();
    await accessible(page);

    // Dark mode and a phone: still accessible, nothing wider than the screen.
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("reports-mobile.png") });
  } finally {
    await cleanup(tag, since);
  }
});
