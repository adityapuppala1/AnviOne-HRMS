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

test("the Updates bell opens a clear, accessible feed", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();
  await role(page, "Employee");

  const bell = page.getByRole("button", { name: /^Updates/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const dialog = page.getByRole("dialog", { name: "Updates" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Decisions on your own requests from the last 30 days."),
  ).toBeVisible();
  // Either decisions are listed or the empty state says what will appear.
  await expect(
    dialog.locator(".update-row, .updates-empty").first(),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: info.outputPath("updates.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The same bell works on a phone, in dark mode, without sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: /^Updates/ }).click();
  await expect(page.getByRole("dialog", { name: "Updates" })).toBeVisible();
  await accessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("updates-mobile.png") });
});
