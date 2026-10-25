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
// A random weekday 4–30 weeks ahead keeps reruns from overlapping earlier requests.
function futureWeekday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 28 + Math.floor(Math.random() * 180));
  if (d.getUTCMonth() === 11 && d.getUTCDate() > 20)
    d.setUTCDate(d.getUTCDate() + 21);
  while (d.getUTCDay() % 6 === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("request, cancel and review leave across employee and manager workspaces", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page);
  await role(page, "Team manager");
  await page.getByRole("link", { name: "Leave", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Time away, planned together." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /balance$/ })).toBeVisible();
  await accessible(page);

  const day = futureWeekday();
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Request leave" });
  await dialog
    .getByRole("combobox", { name: "Leave type" })
    .selectOption({ label: "Leave without pay (no limit)" });
  await dialog.getByLabel("First day").fill(day);
  await dialog.getByLabel("Last day").fill(day);
  await expect(
    dialog.getByText("1 day of leave, weekends excluded."),
  ).toBeVisible();
  await dialog.getByRole("textbox", { name: "Reason" }).fill("Moving house");
  await accessible(page);
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const item = page
    .locator(".leave-item")
    .filter({ hasText: "Moving house" })
    .filter({ hasText: "Awaiting decision" })
    .first();
  await expect(item).toBeVisible();
  await expect(item).toContainText("HR decides.");

  await item.getByRole("button", { name: /^Cancel Leave without pay/ }).click();
  await page
    .getByRole("dialog", { name: "Cancel this leave?" })
    .getByRole("button", { name: "Cancel leave", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .locator(".leave-item")
      .filter({ hasText: "Moving house" })
      .filter({ hasText: "Cancelled" })
      .first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Team requests/ }).click();
  await expect(
    page.getByRole("heading", { name: "Awaiting a decision" }),
  ).toBeVisible();
  const approve = page.getByRole("button", { name: /^Approve leave for / });
  if (await approve.count()) {
    const name = (await approve.first().getAttribute("aria-label"))!.replace(
      "Approve leave for ",
      "",
    );
    await approve.first().click();
    await expect(
      page
        .locator(".leave-decided .leave-item")
        .filter({ hasText: name })
        .first(),
    ).toContainText("Approved");
  } else {
    await expect(page.getByText("You're all caught up")).toBeVisible();
  }
  await accessible(page);

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("leave-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("tab", { name: "Your leave" }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("leave-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();

  await role(page, "HR admin");
  await page.goto("/leave");
  await expect(page.getByRole("button", { name: "Request leave" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Awaiting a decision" }),
  ).toBeVisible();
  await accessible(page);
});
