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

// Assets and their history are never deleted through the app, so a run removes
// its own synthetic rows directly.
async function cleanup(tag: string) {
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
      await client.query<{ id: string }>("SELECT id FROM asset WHERE tag=$1", [
        tag,
      ])
    ).rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[]) OR aggregate_id IN (SELECT id FROM asset_assignment WHERE asset_id=ANY($1::uuid[]))",
        [ids],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [ids.map((id) => `^asset:${id}`)],
      );
      await client.query(
        "DELETE FROM asset_assignment WHERE asset_id=ANY($1::uuid[])",
        [ids],
      );
      await client.query("DELETE FROM asset WHERE id=ANY($1::uuid[])", [ids]);
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("HR issues equipment, the holder confirms it, HR receives it back", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const tag = `E2E-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Good to see you, Maya." }),
    ).toBeVisible();

    // HR registers an asset.
    await page.getByRole("link", { name: "Assets", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Company assets", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Available", { exact: true }).first(),
    ).toBeVisible();
    await accessible(page);
    await page.getByRole("button", { name: "Add asset" }).first().click();
    const add = page.getByRole("dialog", { name: "Add an asset" });
    await add.getByLabel("Tag").fill(tag);
    await add.getByLabel("Name").fill("Synthetic test laptop");
    await add.getByLabel("Serial number (optional)").fill(`SN-${tag}`);
    await accessible(page);
    await add.getByRole("button", { name: "Register asset" }).click();

    // The new asset opens in its details; HR issues it to a colleague.
    const details = page.getByRole("dialog", { name: "Asset details" });
    await expect(details).toContainText(tag);
    await expect(details).toContainText("Available");
    await details.getByRole("button", { name: "Issue", exact: true }).click();
    const issue = page.getByRole("dialog", { name: "Issue asset" });
    await issue.getByRole("textbox", { name: "Find a colleague" }).fill("Maya");
    await issue
      .getByRole("button", { name: /Maya Iyer/ })
      .first()
      .click();
    await issue.getByRole("button", { name: "Issue asset" }).click();
    await expect(
      page.getByRole("dialog", { name: "Asset details" }),
    ).toContainText("Issued");
    await expect(
      page.getByRole("dialog", { name: "Asset details" }),
    ).toContainText("Not yet acknowledged");
    await page.screenshot({
      path: info.outputPath("assets-hr-details.png"),
    });
    await page.keyboard.press("Escape");

    // The holder sees it and confirms receipt.
    await role(page, "Employee");
    await page.getByRole("link", { name: "Assets", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your equipment", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Please confirm you have these")).toBeVisible();
    await accessible(page);
    await page.screenshot({ path: info.outputPath("assets-holder.png") });
    await page.getByRole("button", { name: `Acknowledge ${tag}` }).click();
    await expect(
      page.getByRole("button", { name: `Acknowledge ${tag}` }),
    ).toHaveCount(0);
    await expect(page.getByText(tag).first()).toBeVisible();

    // HR sees the confirmation and receives the asset back.
    await role(page, "HR admin");
    await page.getByRole("link", { name: "Assets", exact: true }).click();
    await page.getByRole("textbox", { name: "Search assets" }).fill(tag);
    await page.getByRole("button", { name: `Open ${tag}` }).click();
    const again = page.getByRole("dialog", { name: "Asset details" });
    await expect(again).toContainText("Acknowledged");
    await again.getByRole("button", { name: "Receive back" }).click();
    const back = page.getByRole("dialog", { name: "Receive asset back" });
    await back.getByRole("button", { name: /Condition on return/ }).click();
    await page.getByRole("option", { name: "Good", exact: true }).click();
    await back.getByRole("button", { name: "Record return" }).click();
    await expect(
      page.getByRole("dialog", { name: "Asset details" }),
    ).toContainText("Available");
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
    await page.screenshot({ path: info.outputPath("assets-mobile.png") });
  } finally {
    await cleanup(tag);
  }
});
