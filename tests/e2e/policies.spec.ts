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

// Policies and acknowledgements are never deleted through the app, so a run
// removes its own synthetic rows directly.
async function cleanup(code: string) {
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
        "SELECT id FROM policy WHERE code=$1",
        [code],
      )
    ).rows.map((row) => row.id);
    if (ids.length) {
      const versions = (
        await client.query<{ id: string }>(
          "SELECT id FROM policy_version WHERE policy_id=ANY($1::uuid[])",
          [ids],
        )
      ).rows.map((row) => row.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [versions],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [ids.map((id) => `^policy:${id}`)],
      );
      await client.query(
        "DELETE FROM policy_acknowledgement WHERE policy_version_id=ANY($1::uuid[])",
        [versions],
      );
      await client.query(
        "DELETE FROM policy_version WHERE policy_id=ANY($1::uuid[])",
        [ids],
      );
      await client.query("DELETE FROM policy WHERE id=ANY($1::uuid[])", [ids]);
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("HR publishes a policy, an employee acknowledges it, HR sees the evidence", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const code = `E2E-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const title = `Synthetic device policy ${code}`;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Good to see you, Maya." }),
    ).toBeVisible();

    // HR drafts a policy.
    await page.getByRole("link", { name: "Policies", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "HR policies", level: 1 }),
    ).toBeVisible();
    await accessible(page);
    await page.getByRole("button", { name: "New policy" }).first().click();
    const create = page.getByRole("dialog", { name: "New policy" });
    await create.getByLabel("Code").fill(code);
    await create.getByLabel("Title").fill(title);
    await create
      .getByLabel("Summary")
      .fill("Keep company devices locked and report any loss quickly.");
    await create
      .getByLabel("Policy text")
      .fill(
        "Lock your screen whenever you step away from your desk. Report a lost or stolen device to HR on the same working day.",
      );
    await create.getByLabel("Effective from").fill("2026-11-01");
    await accessible(page);
    await create.getByRole("button", { name: "Create draft" }).click();

    // The draft opens in its details; HR publishes it.
    const details = page.getByRole("dialog", { name: "Policy details" });
    await expect(details).toContainText(code);
    await expect(details).toContainText("Draft");
    await details.getByRole("button", { name: "Publish draft" }).click();
    const publish = page.getByRole("dialog", { name: "Publish policy" });
    await publish.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Policy details" }),
    ).toContainText("Published v1");
    await page.keyboard.press("Escape");

    // The employee sees it on Today and in Policies, reads it and acknowledges.
    await role(page, "Employee");
    await expect(
      page.getByRole("region", { name: "Today" }).getByText("Policies", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Policies", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Policies", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Needs your acknowledgement")).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    await accessible(page);
    await page.screenshot({ path: info.outputPath("policies-employee.png") });
    await page.getByRole("button", { name: `Read ${code}` }).click();
    const reading = page.getByRole("dialog", { name: "Read policy" });
    await expect(reading).toContainText("Lock your screen whenever");
    await accessible(page);
    await reading
      .getByRole("button", { name: "I have read and understood" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("Acknowledged", { exact: true }).first(),
    ).toBeVisible();

    // HR sees who has acknowledged.
    await role(page, "HR admin");
    await page.getByRole("link", { name: "Policies", exact: true }).click();
    await page.getByRole("textbox", { name: "Search policies" }).fill(code);
    await page.getByRole("button", { name: `Open ${code}` }).click();
    const evidence = page.getByRole("dialog", { name: "Policy details" });
    await expect(evidence).toContainText("acknowledged");
    await expect(evidence).toContainText("Maya Iyer");
    await page.screenshot({ path: info.outputPath("policies-hr-details.png") });
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
    await page.screenshot({ path: info.outputPath("policies-mobile.png") });
  } finally {
    await cleanup(code);
  }
});
