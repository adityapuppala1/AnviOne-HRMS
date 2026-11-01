import { test, expect, type Page } from "./support/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import pg from "pg";

// Behaviour under test: asking to change personal details (employee), HR's
// review list and the rule that nobody decides their own request. Applying
// approved changes runs through the API in tests/profile.integration.ts,
// because the demo person holds every role.
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

// Profile requests, the current profile and its history are never deleted
// through the app, so a run removes the demo person's synthetic rows.
async function cleanup() {
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
    const maya = (
      await client.query<{ id: string }>(
        `SELECT e.id FROM employee e JOIN person p ON p.id=e.person_id AND p.tenant_id=e.tenant_id
         WHERE p.name='Maya Iyer' LIMIT 1`,
      )
    ).rows[0]?.id;
    if (maya) {
      const requests = (
        await client.query<{ id: string }>(
          "SELECT id FROM profile_change_request WHERE employee_id=$1",
          [maya],
        )
      ).rows.map((row) => row.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...requests, maya]],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [
          [
            ...requests.map((id) => `^profile-change:${id}`),
            `^employee:${maya}`,
          ],
        ],
      );
      await client.query(
        "DELETE FROM profile_change_history WHERE employee_id=$1",
        [maya],
      );
      await client.query(
        "DELETE FROM profile_change_request WHERE employee_id=$1",
        [maya],
      );
      await client.query("DELETE FROM employee_profile WHERE employee_id=$1", [
        maya,
      ]);
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    client.release();
    await pool.end();
  }
}

test("an employee asks to change a detail; HR reviews it but cannot decide their own request", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Good to see you, Maya." }),
    ).toBeVisible();

    // The employee asks for a change, then withdraws and asks again.
    await role(page, "Employee");
    await page.getByRole("link", { name: "My details", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "My details", level: 1 }),
    ).toBeVisible();
    await accessible(page);
    for (const attempt of [1, 2]) {
      await page
        .getByRole("button", { name: "Request a change" })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Request a change" });
      await dialog.getByLabel("Personal phone").fill("+91 98765 43210");
      await dialog
        .getByLabel("Reason for the change")
        .fill("My number changed last week.");
      if (attempt === 1) await accessible(page);
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByText("Submitted").first()).toBeVisible();
      if (attempt === 1) {
        await page.screenshot({
          path: info.outputPath("details-employee.png"),
        });
        await page
          .getByRole("button", { name: "Withdraw request" })
          .first()
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Withdraw request" })
          .click();
        await expect(page.getByText("Withdrawn").first()).toBeVisible();
      }
    }

    // HR sees the request without any personal value in the list.
    await role(page, "HR admin");
    await page.getByRole("link", { name: "My details", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Change requests", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("98765")).toHaveCount(0);
    await accessible(page);
    await page.getByRole("button", { name: "Open Maya Iyer" }).first().click();
    const review = page.getByRole("dialog", { name: "Request details" });
    await expect(review).toContainText("audit");
    await page.screenshot({ path: info.outputPath("details-hr.png") });

    // Nobody decides their own request.
    await expect(review.getByRole("button", { name: "Approve" })).toHaveCount(
      0,
    );
    await expect(
      review.getByText("Another HR admin must decide your own request"),
    ).toBeVisible();
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
    await page.screenshot({ path: info.outputPath("details-mobile.png") });
  } finally {
    await cleanup();
  }
});
