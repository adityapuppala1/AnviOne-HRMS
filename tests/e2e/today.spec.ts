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
async function role(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("the home Today panel shows what each role needs first", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();

  // HR decides things but does not record attendance or request leave here.
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toBeVisible();
  await expect(today.getByText("Next holiday")).toBeVisible();
  await expect(today.getByText("Waiting for you")).toBeVisible();
  await expect(
    today.getByRole("button", { name: /^Check (in|out)$/ }),
  ).toHaveCount(0);

  // An employee records the day, sees leave left and the next holiday.
  await role(page, "Employee");
  await expect(today.getByText("Attendance", { exact: true })).toBeVisible();
  const checkIn = today.getByRole("button", { name: "Check in", exact: true });
  // Reruns on the same day find Maya already checked in.
  if (await checkIn.isVisible()) await checkIn.click();
  await expect(today.getByText(/^(Checked in at|Day complete)/)).toBeVisible();
  await expect(today.getByText("days available")).toBeVisible();
  await expect(today.locator(".number-ticker").first()).toHaveText(
    /^\d+(\.\d)?$/,
  );
  await expect(today.getByText("Waiting for you")).toHaveCount(0);
  await accessible(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath("today.png") });

  // A manager both records their own day and decides others'.
  await role(page, "Team manager");
  await expect(today.getByText("Attendance", { exact: true })).toBeVisible();
  await expect(today.getByText("Waiting for you")).toBeVisible();

  // Dark mode on a phone: one column, nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(today).toBeVisible();
  await accessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("today-mobile.png") });
});
