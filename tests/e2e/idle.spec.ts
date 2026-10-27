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

test("idle people are warned, can stay signed in, and are signed out when they leave", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  // A fake clock lets the test jump minutes ahead without waiting.
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();

  // HR's idle limit is 15 minutes; after 14 minutes of nothing the warning shows.
  await page.clock.fastForward("14:00");
  const warning = page.getByRole("dialog", { name: "Still there?" });
  await expect(warning).toBeVisible();
  await expect(warning.getByText(/signed out soon/)).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: info.outputPath("idle-warning.png") });

  // Saying "stay" closes it and tells the server.
  await warning.getByRole("button", { name: "Stay signed in" }).click();
  await expect(warning).toHaveCount(0);
  // Let the heartbeat reach the server before time moves again.
  await page.waitForTimeout(800);

  // Walking away for longer than the limit ends the session and explains why.
  await page.clock.fastForward("16:00");
  await expect(page).toHaveURL(/\/login\?reason=idle$/);
  await expect(
    page.getByText("You were signed out after a period of inactivity."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Explore demo workspace" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("idle-signed-out.png") });
});

test("working normally never triggers the warning", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Maya." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Holidays", exact: true }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
