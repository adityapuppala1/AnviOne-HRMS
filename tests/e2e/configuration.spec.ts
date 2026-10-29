import { test, expect, type Page } from "./support/test";
import AxeBuilder from "@axe-core/playwright";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function loginAs(page: Page, role: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name: role, exact: true }).click();
}
async function openConfiguration(page: Page) {
  await page.getByRole("link", { name: "Configuration", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Configuration", level: 1 }),
  ).toBeVisible();
}
async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}
async function publishOrganization(page: Page, name: string) {
  await page
    .getByRole("link", { name: "Workspace settings", exact: true })
    .click();
  await page.getByLabel("Organization name").fill(name);
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Workspace settings published.",
  );
}
async function clean(page: Page) {
  const found = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(found.violations).toEqual([]);
}
async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("platform admin rolls branding back and the history records a new version", async ({
  page,
}) => {
  await loginAs(page, "Platform admin");
  await page
    .getByRole("link", { name: "Workspace settings", exact: true })
    .click();
  const original = await page.getByLabel("Organization name").inputValue();
  try {
    await openConfiguration(page);
    const timeline = page.getByRole("list", { name: "Branding versions" });
    await expect(timeline.getByRole("listitem").first()).toBeVisible();

    await publishOrganization(page, `Config check ${Date.now()}`);
    await openConfiguration(page);
    const top = timeline.getByRole("listitem").first();
    await expect(top).toContainText("Current");
    const label =
      (await top
        .getByText(/^v\d+$/)
        .first()
        .textContent()) ?? "";
    const topVersion = Number(label.slice(1));
    expect(topVersion).toBeGreaterThan(1);

    await page
      .getByRole("button", { name: `Roll back to v${topVersion - 1}` })
      .click();
    const dialog = page.getByRole("dialog", { name: "Roll back branding" });
    await expect(dialog).toContainText("publishes a new version");
    await expect(dialog).toContainText("What will change");
    await expect(
      dialog.getByRole("button", { name: "Roll back", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: "Reason" })
      .fill("Restoring the earlier look after a check.");
    await dialog
      .getByRole("button", { name: "Roll back", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    const newTop = timeline.getByRole("listitem").first();
    await expect(
      newTop.getByText(`v${topVersion + 1}`, { exact: true }),
    ).toBeVisible();
    await expect(newTop).toContainText("Rolled back");
    await expect(newTop).toContainText("Current");
    await expect(newTop).toContainText(`Copies v${topVersion - 1}`);
  } finally {
    // History rows are immutable: put the original look live and keep the rows.
    await page.goto("/settings");
    if ((await page.getByLabel("Organization name").inputValue()) !== original)
      await publishOrganization(page, original);
  }
});

test("access matrix and integrations are read-only, honest and accessible", async ({
  page,
}) => {
  await loginAs(page, "Platform admin");
  await openConfiguration(page);

  await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
  await clean(page);

  await openTab(page, "Access");
  const matrix = page.getByRole("grid", { name: "Permission matrix" });
  await expect(matrix).toBeVisible();
  await expect(
    page.getByText(
      "Permissions are defined in code and change only through a reviewed release; this view cannot edit them.",
    ),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search permissions" })
    .fill("branding.write");
  await expect(matrix).toContainText("branding.write");
  await expect(matrix.getByRole("row")).toHaveCount(2);
  await clean(page);

  await openTab(page, "Integrations");
  const list = page.getByRole("list", { name: "Integrations" });
  await expect(list.getByRole("listitem")).toHaveCount(7);
  const body = (await page.locator("main").innerText()).toLowerCase();
  expect(body).not.toContain("password");
  expect(body).not.toContain("://");
  await clean(page);

  await page.getByRole("button", { name: "Use dark theme" }).click();
  for (const tab of ["History", "Access", "Integrations"]) {
    await openTab(page, tab);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await clean(page);
  }
  await page.getByRole("button", { name: "Use light theme" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["History", "Access", "Integrations"]) {
    await openTab(page, tab);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await noSidewaysScroll(page);
  }
  await openTab(page, "Access");
  await expect(
    page.getByRole("list", { name: "Permission matrix" }),
  ).toBeVisible();
  await noSidewaysScroll(page);
});

test("an employee does not see Configuration", async ({ page }) => {
  await loginAs(page, "Employee");
  await expect(
    page.getByRole("link", { name: "Configuration", exact: true }),
  ).toHaveCount(0);
  await page.goto("/configuration");
  await expect(page.getByRole("alert")).toContainText(
    "Configuration is available",
  );
});
