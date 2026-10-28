import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

// Behaviour under test: HR assigns and clears a designation on a profile.
// The rules underneath are covered by classification.integration.ts.
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
    const ids = (
      await client.query<{ id: string }>(
        "SELECT id FROM org_unit WHERE code=$1",
        [code],
      )
    ).rows.map((row) => row.id);
    await client.query(
      "DELETE FROM audit_event WHERE action LIKE 'employee.classified%' AND occurred_at >= $1",
      [since],
    );
    await client.query(
      "DELETE FROM outbox_event WHERE event_type LIKE 'employee.classified%' AND occurred_at >= $1",
      [since],
    );
    if (ids.length) {
      await client.query(
        "UPDATE employee SET designation_id=NULL WHERE designation_id=ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [ids.map((id) => `^organization:${id}:`)],
      );
      await client.query("DELETE FROM org_unit WHERE id=ANY($1::uuid[])", [
        ids,
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

test("HR assigns a designation on a profile, then clears it", async ({
  page,
}) => {
  test.setTimeout(120000);
  const since = new Date(Date.now() - 5000);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const code = `DS_${suffix}`;
  const name = `Synthetic designation ${suffix}`;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: /Good to see you/ }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Organization", exact: true }).click();
    await page.getByRole("tab", { name: "Designations" }).click();
    await page
      .getByRole("button", { name: "Add designation", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Permanent code", { exact: true }).fill(code);
    await page
      .getByLabel("Reason for change")
      .fill("Create a synthetic designation for the profile journey.");
    await page
      .getByRole("button", { name: "Create designation", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/people");
    await page
      .getByRole("link", { name: /Aarav Shah/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Aarav Shah" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Employment", exact: true }).click();

    await page
      .getByRole("button", { name: "Edit classification", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Designation/ }).click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await dialog
      .getByLabel("Reason for change")
      .fill("Assign the synthetic designation in a test.");
    await dialog
      .getByRole("button", { name: "Save classification", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(`${code} - ${name}`)).toBeVisible();

    await page
      .getByRole("button", { name: "Edit classification", exact: true })
      .click();
    await dialog.getByRole("button", { name: /Designation/ }).click();
    await page.getByRole("option", { name: "None", exact: true }).click();
    await dialog
      .getByLabel("Reason for change")
      .fill("Clear the synthetic designation in a test.");
    await dialog
      .getByRole("button", { name: "Save classification", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(`${code} - ${name}`)).toHaveCount(0);
  } finally {
    await cleanup(code, since);
  }
});
