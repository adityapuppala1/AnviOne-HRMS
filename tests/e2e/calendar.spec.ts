import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();
}
async function role(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
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

test("HR adds and retires a holiday; everyone sees the calendar", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  // The demo session opens in the HR admin workspace.
  await login(page);
  await page.getByRole("link", { name: "Holidays", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("group", { name: "Working days" })).toBeVisible();
  await accessible(page);

  // Work in next year so a random date never collides with an observed seeded
  // holiday; the holiday is retired before the run ends.
  const year = new Date().getUTCFullYear() + 1;
  await page.getByRole("button", { name: `Show ${year}` }).click();
  await expect(
    page.getByRole("heading", { name: `Holidays in ${year}` }),
  ).toBeVisible();
  const month = String(2 + Math.floor(Math.random() * 9)).padStart(2, "0");
  // Seeded holidays never fall on the 28th, and earlier runs retire theirs.
  const dayOfMonth = "28";
  const name = `Offsite ${Math.random().toString(36).slice(2, 7)}`;

  await page.getByRole("button", { name: "Add holiday" }).click();
  const add = page.getByRole("dialog", { name: "Add a holiday" });
  await add.getByLabel("Date").fill(`${year}-${month}-${dayOfMonth}`);
  await add.getByRole("textbox", { name: "Name" }).fill(name);
  await add
    .getByRole("textbox", { name: "Reason for this change" })
    .fill("Company-wide planning offsite");
  await accessible(page);
  await add.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator(".calendar-month li").filter({ hasText: name });
  await expect(row).toContainText("Whole organization");

  await row.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: "Edit holiday" });
  await edit.getByRole("checkbox", { name: "Observed this year" }).uncheck();
  await edit
    .getByRole("textbox", { name: "Reason for this change" })
    .fill("Offsite moved to a working day");
  await edit.getByRole("button", { name: "Save holiday" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("not observed");

  await role(page, "Employee");
  await page.goto("/calendar");
  await expect(page.getByRole("button", { name: "Add holiday" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("img", { name: /^Monday: (working day|day off)$/ }),
  ).toBeVisible();
  await accessible(page);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("calendar-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("calendar-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();
});
