import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

// Behaviour under test: merging one department into another (HR) and the
// organization chart. Creating and editing records is covered by
// organization.spec.ts; the rules underneath by organization-v2.integration.ts.
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

async function createDepartment(page: Page, name: string, code: string) {
  await page
    .getByRole("button", { name: "Add department", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Permanent code", { exact: true }).fill(code);
  await page
    .getByLabel("Reason for change")
    .fill("Create a synthetic department for the merge journey.");
  await page
    .getByRole("button", { name: "Create department", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// Merged records are closed for good and never deleted through the app, so a
// run removes its own synthetic units directly.
async function cleanup(codes: string[]) {
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
        "SELECT id FROM org_unit WHERE code=ANY($1::text[])",
        [codes],
      )
    ).rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [ids.map((id) => `^organization:${id}:`)],
      );
      await client.query(
        "UPDATE org_unit SET merged_into_id=NULL WHERE id=ANY($1::uuid[])",
        [ids],
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

test("HR merges a department into another; the org chart finds anyone and moves with them", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const source = { code: `MG_A${suffix}`, name: `Merge source ${suffix}` };
  const target = { code: `MG_B${suffix}`, name: `Merge target ${suffix}` };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore demo workspace" }).click();
    await expect(
      page.getByRole("heading", { name: /Good to see you/ }),
    ).toBeVisible();

    // HR makes two departments and merges one into the other.
    await page.getByRole("link", { name: "Organization", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Organization, kept in order." }),
    ).toBeVisible();
    await createDepartment(page, source.name, source.code);
    await createDepartment(page, target.name, target.code);
    await page
      .getByRole("textbox", { name: "Search departments" })
      .fill(source.code);
    await page
      .getByRole("button", { name: `More actions for ${source.name}` })
      .click();
    await page.getByRole("menuitem", { name: "Merge into…" }).click();
    const merge = page.getByRole("dialog", { name: `Merge ${source.name}` });
    await merge
      .getByRole("button", { name: /Merge into this department/ })
      .click();
    await page.getByRole("option", { name: new RegExp(target.name) }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await merge
      .getByLabel("Reason for merge")
      .fill("The two synthetic departments were created by mistake.");
    await accessible(page);
    await page.screenshot({ path: info.outputPath("chart-merge.png") });
    await merge.getByRole("button", { name: "Merge units" }).click();
    await expect(page.getByText("Merge complete").first()).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The closed record shows where it went.
    await expect(
      page.getByText(`Merged into ${target.name}`).first(),
    ).toBeVisible();

    // Find anyone, pick them, and the chart moves to their reporting lines.
    await page.getByRole("link", { name: "Org chart", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Org chart", level: 1 }),
    ).toBeVisible();
    await findAndPick(page, "Neel");
    await expect(page).toHaveURL(/focus=/);
    await expect(
      page.getByRole("button", { name: /Neel Rao/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Go to my position" }),
    ).toBeEnabled();
    await accessible(page);
    await page.screenshot({ path: info.outputPath("chart-network.png") });

    // Vertical and horizontal.
    const vertical = page.getByRole("radio", { name: "Vertical view" });
    const horizontal = page.getByRole("radio", { name: "Horizontal view" });
    await horizontal.click();
    await expect(page.locator(".oc-viewport")).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
    await page.screenshot({ path: info.outputPath("chart-horizontal.png") });
    await vertical.click();
    await expect(page.locator(".oc-viewport")).toHaveAttribute(
      "data-orientation",
      "vertical",
    );

    // Zoom with the buttons and with the keyboard.
    const level = page.getByTestId("zoom-level");
    const read = async () => parseInt((await level.textContent()) ?? "0", 10);
    await page.getByRole("button", { name: "Fit to screen" }).click();
    await expect.poll(read).toBeGreaterThan(0);
    await page.waitForTimeout(700);
    const fitted = await read();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(read).toBeGreaterThan(fitted);
    const zoomed = await read();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(read).toBeLessThan(zoomed);
    await page.locator(".oc-viewport").focus();
    await page.waitForTimeout(300);
    const before = await read();
    await page.keyboard.press("+");
    await expect.poll(read).toBeGreaterThan(before);
    const plus = await read();
    await page.keyboard.press("-");
    await expect.poll(read).toBeLessThan(plus);
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await page.keyboard.press("0");
    await expect.poll(read).toBe(fitted);

    // The List view is the text equivalent.
    await page.getByRole("tab", { name: "List" }).click();
    await expect(page.getByText("Reports to", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Selected person", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Direct reports \(\d+\)/ }),
    ).toBeVisible();
    await accessible(page);

    // 3D: the lazy scene draws, or says plainly that WebGL is not available.
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("tab", { name: "3D" }).click();
    const scene = page.getByTestId("org-3d");
    const fallback = page.getByText(/3D needs WebGL/);
    await expect(scene.or(fallback).first()).toBeVisible();
    if (await scene.isVisible()) {
      await expect(scene.locator("canvas")).toBeVisible();
      await scene.focus();
      await page.keyboard.press("+");
      await page.keyboard.press("0");
    }
    await accessible(page);
    await page.screenshot({ path: info.outputPath("chart-3d.png") });
    expect(
      errors.filter((e) => !/WebGL|GPU stall|swiftshader/i.test(e)),
    ).toEqual([]);

    // The whole tree keeps its own search and expand controls.
    await page.getByRole("tab", { name: "Whole tree" }).click();
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("textbox", { name: "Search the chart" }).fill("Maya");
    await expect(page.getByText("Maya Iyer").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Search the chart" }).fill("");
    await accessible(page);
    await page.screenshot({ path: info.outputPath("chart-tree.png") });

    // Dark mode and a phone: still accessible, nothing wider than the screen.
    await page.getByRole("tab", { name: "Network" }).click();
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await accessible(page);
    await page.getByRole("tab", { name: "List" }).click();
    await accessible(page);
    await page.getByRole("tab", { name: "3D" }).click();
    await expect(scene.or(fallback).first()).toBeVisible();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("tab", { name: "Network" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("chart-mobile.png") });
  } finally {
    await cleanup([source.code, target.code]);
  }
});

// Type into the "Find anyone" combobox and choose the first result.
async function findAndPick(page: Page, query: string) {
  const box = page.getByRole("combobox", {
    name: "Find anyone in the organization",
  });
  await box.fill(query);
  await expect(page.getByRole("option").first()).toBeVisible();
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
}

test("An employee can search for someone outside their team and see their manager and reports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name: "Employee", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Org chart", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Org chart", level: 1 }),
  ).toBeVisible();
  await findAndPick(page, "Neel");
  await page.getByRole("tab", { name: "List" }).click();
  await expect(
    page.getByRole("button", { name: "Go to my position" }),
  ).toBeEnabled();
  await expect(page.getByText("Reports to", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Selected person", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Direct reports \(\d+\)/ }),
  ).toBeVisible();
  await expect(
    page.locator(".oc-list-focus").getByText("Neel Rao"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Show Maya Iyer/ }),
  ).toBeVisible();
  await expect(page.locator(".oc-list-row").first()).toBeVisible();
  await accessible(page);
});
