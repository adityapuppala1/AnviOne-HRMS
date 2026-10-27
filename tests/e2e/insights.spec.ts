import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
async function enter(page: Page) {
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

test("insights show scoped figures and charts, and stay accessible", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enter(page);
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your workforce, at a glance." }),
  ).toBeVisible();
  await expect(
    page.getByText("Figures cover everyone in your organization."),
  ).toBeVisible();

  // Key figures count up to whole numbers.
  const figures = page.getByRole("region", { name: "Key figures" });
  await expect(figures.locator(".number-ticker").first()).toHaveText(/^\d+$/);
  await expect(figures.getByText("People", { exact: true })).toBeVisible();

  // Five charts, each with the same data as a table.
  const charts = page.getByRole("img", {
    name: /^(People by|Joining|Leave taken|Check-ins)/,
  });
  await expect(charts).toHaveCount(5);
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  const first = page.locator(".insights-table").first();
  await first.getByText("Show the figures as a table").click();
  await expect(first.getByRole("table")).toBeVisible();
  await expect(
    first.getByRole("columnheader", { name: "Label" }),
  ).toBeVisible();

  await accessible(page);
  // Let the bars finish drawing in before capturing.
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: info.outputPath("insights.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await accessible(page);
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: info.outputPath("insights-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();

  // Managers see their team; employees do not get the page.
  await role(page, "Team manager");
  // Switching role returns to the overview; open Insights again.
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(
    page.getByText("Figures cover you and your direct reports."),
  ).toBeVisible();
  await role(page, "Employee");
  await expect(page.getByRole("link", { name: "Insights" })).toHaveCount(0);
  await page.goto("/insights");
  await expect(
    page.getByText("Insights are available to managers and HR."),
  ).toBeVisible();

  // Phones keep one column and never scroll sideways.
  await role(page, "HR admin");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/insights");
  await expect(
    page.getByRole("img", { name: /^People by department/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("insights-mobile.png"),
    fullPage: true,
  });
});

test("the help centre searches its answers", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enter(page);
  await page.getByRole("link", { name: "Help centre", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Help centre", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Leave", level: 2 }),
  ).toBeVisible();
  await accessible(page);

  const search = page.getByRole("searchbox", { name: "Search help" });
  await search.fill("check in");
  await expect(page.getByRole("status")).toContainText("answer");
  await expect(
    page.getByRole("heading", { name: "Attendance", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Leave", level: 2 }),
  ).toHaveCount(0);
  await expect(
    page.getByText("The time is recorded by the server"),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: info.outputPath("help.png"), fullPage: true });

  await search.fill("zzzzqx");
  await expect(
    page.getByRole("heading", { name: "No answers match your search" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(
    page.getByRole("heading", { name: "Leave", level: 2 }),
  ).toBeVisible();
});
