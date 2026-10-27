import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import pg from "pg";

// Behaviour under test: the Expenses module (employee claim submit and cancel,
// HR category management). Approval and payment run through the API in
// tests/expenses.integration.ts, because the demo person holds every role and
// nobody may decide their own claim.
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

// Claims and categories are never deleted through the app, so a run removes
// its own synthetic rows directly.
async function cleanup(tag: string, categoryCode: string) {
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
    const claims = (
      await client.query<{ id: string }>(
        "SELECT id FROM expense_claim WHERE title LIKE $1",
        [`%${tag}%`],
      )
    ).rows.map((row) => row.id);
    const categories = (
      await client.query<{ id: string }>(
        "SELECT id FROM expense_category WHERE code=$1",
        [categoryCode],
      )
    ).rows.map((row) => row.id);
    await client.query(
      "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
      [[...claims, ...categories]],
    );
    await client.query(
      "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
      [
        [
          ...claims.map((id) => `^expense:${id}`),
          ...categories.map((id) => `^expense-category:${id}`),
        ],
      ],
    );
    await client.query("DELETE FROM expense_claim WHERE id=ANY($1::uuid[])", [
      claims,
    ]);
    await client.query(
      "DELETE FROM expense_category WHERE id=ANY($1::uuid[])",
      [categories],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("an employee submits and cancels a claim; HR manages categories", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  const code = `E2E${tag}`;
  const title = `Client lunch ${tag}`;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Good to see you, Maya." }),
    ).toBeVisible();

    // The employee sends a claim.
    await role(page, "Employee");
    await page.getByRole("link", { name: "Expenses", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Expenses", level: 1 }),
    ).toBeVisible();
    await accessible(page);
    await page.getByRole("button", { name: "New claim" }).first().click();
    const claim = page.getByRole("dialog", { name: "New claim" });
    await claim.getByLabel("Title").fill(title);
    await claim.getByLabel("Category").selectOption({ label: "Meals" });
    await claim.getByLabel("Amount (₹)").fill("450");
    await claim.getByLabel("Description").fill("Lunch with a client.");
    await accessible(page);
    await claim.getByRole("button", { name: "Submit claim" }).click();
    await expect(page.getByRole("dialog", { name: "New claim" })).toHaveCount(
      0,
    );
    await expect(page.getByText(title).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("expenses-employee.png") });

    // ...looks at it, then changes their mind.
    await page.getByRole("button", { name: `Open ${title}` }).click();
    const details = page.getByRole("dialog", { name: "Claim details" });
    await expect(details).toContainText("₹450");
    await details.getByRole("button", { name: "Cancel claim" }).click();
    await page
      .getByRole("dialog", { name: "Cancel this claim?" })
      .getByRole("button", { name: "Cancel claim" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Claim details" }),
    ).toContainText("Cancelled");
    await page.keyboard.press("Escape");

    // HR adds and renames a category.
    await role(page, "HR admin");
    await page.getByRole("link", { name: "Expenses", exact: true }).click();
    await page.getByRole("tab", { name: "Categories" }).click();
    await page.getByRole("button", { name: "New category" }).first().click();
    const category = page.getByRole("dialog", { name: "Category" });
    await category.getByLabel("Code").fill(code);
    await category.getByLabel("Name", { exact: true }).fill(`Synthetic ${tag}`);
    await category.getByLabel("Limit per claim (₹)").fill("5000");
    await accessible(page);
    await category.getByRole("button", { name: "Create category" }).click();
    await expect(page.getByText(`Synthetic ${tag}`).first()).toBeVisible();
    await page.getByRole("button", { name: `Edit Synthetic ${tag}` }).click();
    const edit = page.getByRole("dialog", { name: "Category" });
    await edit
      .getByLabel("Name", { exact: true })
      .fill(`Synthetic renamed ${tag}`);
    await edit.getByRole("button", { name: "Save category" }).click();
    await expect(
      page.getByText(`Synthetic renamed ${tag}`).first(),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("expenses-hr-categories.png"),
    });

    // Dark mode and a phone: still accessible, nothing wider than the screen.
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("expenses-mobile.png") });
  } finally {
    await cleanup(tag, code);
  }
});
