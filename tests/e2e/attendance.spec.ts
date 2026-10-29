import { test, expect, type Page } from "./support/test";
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

test("check in, correct a past day and review the team board", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page);
  await role(page, "Team manager");
  await page.getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your day, on the record." }),
  ).toBeVisible();
  await accessible(page);

  // Reruns on the same day find Maya already checked in.
  const checkIn = page.getByRole("button", { name: "Check in", exact: true });
  if (await checkIn.isVisible()) await checkIn.click();
  await expect(
    page.getByRole("heading", { name: /^(Checked in at|Day complete)/ }),
  ).toBeVisible();

  const gap = page.getByRole("button", { name: /Unaccounted/ }).first();
  if (await gap.count()) {
    await gap.click();
    await expect(page.getByText("Nothing is deducted from pay.")).toBeVisible();
    await page.getByRole("button", { name: "Request a correction" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a correction" });
    await dialog
      .getByRole("textbox", { name: "What happened?" })
      .fill("Worked from the client site");
    await accessible(page);
    await dialog.getByRole("button", { name: "Send correction" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const item = page
      .locator(".attendance-corrections .leave-item")
      .filter({ hasText: "Worked from the client site" })
      .filter({ hasText: "Awaiting decision" })
      .first();
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: /^Cancel correction/ }).click();
    await expect(
      page
        .locator(".attendance-corrections .leave-item")
        .filter({ hasText: "Worked from the client site" })
        .first(),
    ).toContainText("Cancelled");
  }

  await page.getByRole("tab", { name: /Team today/ }).click();
  await expect(page.getByRole("heading", { name: /^Who's in/ })).toBeVisible();
  await expect(
    page
      .locator('[data-collection="attendance-board"]')
      .getByRole("row")
      .nth(1),
  ).toBeVisible();
  const approve = page.getByRole("button", {
    name: /^Approve correction for /,
  });
  if (await approve.count()) {
    await approve.first().click();
    await expect(page.locator(".leave-decided")).toContainText("Approved");
  }
  await accessible(page);

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "Your attendance" }).click();
  await page.screenshot({
    path: info.outputPath("attendance-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("attendance-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();

  await role(page, "HR admin");
  await page.goto("/attendance");
  await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Who's in/ })).toBeVisible();
  await accessible(page);
});
