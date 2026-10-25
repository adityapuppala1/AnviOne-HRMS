import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function login(page: import("@playwright/test").Page) {
  if (!page.url().endsWith("/login")) await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
}
test("directory search, profiles, command menu, reduced access and sign-out", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "People directory", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search directory" }).fill("Zara");
  await expect(page.getByText("1 person", { exact: true })).toBeVisible();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Zara Khan" }) })
    .click();
  await expect(page).toHaveURL(
    /\/people\/30000000-0000-4000-8000-000000000003$/,
  );
  await expect(
    page.getByRole("heading", { name: "Zara Khan", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "Overview", exact: true }),
  ).toContainText("demo3@anvi.example");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search people and pages" })
    .fill("Neel");
  await page.getByRole("button", { name: /Neel Rao/ }).click();
  await expect(page.getByRole("heading", { name: "Neel Rao" })).toBeVisible();
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name: "Employee", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "People directory", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Maya Iyer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zara Khan" })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search directory" })
    .fill("no such colleague");
  await expect(
    page.getByRole("heading", { name: "No people found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to AnviOne." }),
  ).toBeVisible();
});
test("runtime branding publishes and persists with a visible audit record", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Platform admin", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Workspace settings", exact: true })
    .click();
  const original = await page.getByLabel("Organization name").inputValue();
  await page.getByLabel("Organization name").fill("Anvi preview studio");
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Workspace settings published.",
  );
  await page.reload();
  await expect(page.getByLabel("Organization name")).toHaveValue(
    "Anvi preview studio",
  );
  await page.getByLabel("Organization name").fill(original);
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Workspace settings published.",
  );
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name: "Auditor", exact: true }).click();
  await page.getByRole("link", { name: "Activity log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Published workspace settings" }).first(),
  ).toBeVisible();
});
test("responsive layouts, accessible screens and reduced motion", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  let a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await login(page);
  for (const width of [360, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "Use dark theme" }).click();
  a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("home-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();
  await page.goto("/people");
  await expect(
    page.getByRole("heading", { name: "Arjun Mehta" }),
  ).toBeVisible();
  a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.setViewportSize({ width: 360, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".page-enter")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});
