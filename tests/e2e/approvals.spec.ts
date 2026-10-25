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

test("managers decide leave and corrections from one inbox", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page);
  await role(page, "Team manager");
  await page.getByRole("link", { name: /^Approvals/ }).click();
  await expect(
    page.getByRole("heading", { name: "Decisions, in one place." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs your decision" }),
  ).toBeVisible();
  await accessible(page);

  const approve = page.getByRole("button", { name: /^Approve / });
  const before = await approve.count();
  if (before > 0) {
    await approve.first().click();
    await expect(approve).toHaveCount(before - 1);
  } else {
    await expect(page.getByText("You're all caught up")).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("approvals-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("approvals-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();

  await role(page, "Employee");
  await expect(page.getByRole("link", { name: /^Approvals/ })).toHaveCount(0);
});
