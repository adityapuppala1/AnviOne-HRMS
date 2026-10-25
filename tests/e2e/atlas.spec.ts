import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page) {
  if (!page.url().endsWith("/login")) await page.goto("/login");
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
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("team exploration, profile tabs, directory display and personal preferences", async ({
  page,
}, info) => {
  await login(page);
  await page
    .getByRole("button", { name: "Engineering 4", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Explore Engineering", exact: true })
    .click();
  await expect(page.getByLabel("Department", { exact: true })).toHaveValue(
    "Engineering",
  );
  await expect(page.getByText("4 people", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "List view" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("link", { name: /Neel Rao/ }).click();
  await expect(page.getByRole("heading", { name: "Neel Rao" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Employment", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Employee code", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("profile-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Team explorer", exact: true }).click();
  await page.getByRole("tab", { name: /Locations/ }).click();
  await expect(page).toHaveURL(/view=locations/);
  await page.getByRole("link", { name: /Bengaluru 4 people/ }).click();
  await expect(page.getByLabel("Location", { exact: true })).toHaveValue(
    "Bengaluru",
  );
  await page
    .getByRole("link", { name: "Display preferences", exact: true })
    .click();
  await page.getByRole("radio", { name: /Compact/ }).check();
  // React Aria exposes a visually hidden input; click the visible switch track.
  await page.locator("label.switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Compact/ })).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Reduce motion" }),
  ).toBeChecked();
  await accessible(page);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await accessible(page);
  await page.getByRole("link", { name: "Team explorer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Meet the bigger picture." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await role(page, "Employee");
  await page.getByRole("link", { name: "Team explorer", exact: true }).click();
  await expect(
    page.getByText("1 person in scope", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Engineering/ })).toHaveCount(0);
  await role(page, "Platform admin");
  await page.goto("/teams");
  await expect(
    page.getByText(
      "Your current workspace does not include team or people access.",
    ),
  ).toBeVisible();
});

test("branding previews and audit search, filters, details and empty states", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await role(page, "Platform admin");
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Your workspace. Your signature." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mobile preview" }).click();
  await expect(page.locator(".preview-window")).toHaveClass(
    /preview-device-mobile/,
  );
  await page.getByRole("button", { name: "Desktop preview" }).click();
  await accessible(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("branding-desktop.png"),
    fullPage: true,
  });
  await role(page, "Auditor");
  await page.goto("/activity");
  await page
    .getByRole("textbox", { name: "Search activity" })
    .fill("no matching record 18765");
  await expect(
    page.getByRole("heading", { name: "No matching activity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("combobox", { name: "Activity type" })
    .selectOption("session.");
  await expect(
    page.getByRole("heading", { name: "Published workspace settings" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /View event/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Request ID");
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await accessible(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("activity-desktop.png"),
    fullPage: false,
  });
});

test("every available page fits mobile, tablet, laptop and wide screens", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Explore demo workspace" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: info.outputPath("login-desktop.png"),
    fullPage: true,
  });
  await accessible(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await fits(page);
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("login-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const routes = [
    "/",
    "/people",
    "/teams",
    "/people/30000000-0000-4000-8000-000000000001",
    "/preferences",
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const width of [320, 360, 390, 768, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(page);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await accessible(page);
    await page.screenshot({
      path: info.outputPath(
        `${route.startsWith("/people/") ? "profile" : route.split("/")[1] || "home"}-mobile.png`,
      ),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: info.outputPath(
        `${route.startsWith("/people/") ? "profile" : route.split("/")[1] || "home"}-desktop.png`,
      ),
      fullPage: true,
    });
  }
  for (const [roleName, route] of [
    ["Platform admin", "/settings"],
    ["Auditor", "/activity"],
  ]) {
    await role(page, roleName!);
    await page.goto(route!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const width of [320, 360, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(page);
    }
    await page.setViewportSize({ width: 360, height: 900 });
    await accessible(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto("/missing-page");
  await accessible(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await fits(page);
});

test("all palettes and light/dark modes keep core screens accessible", async ({
  page,
}) => {
  test.setTimeout(180000);
  const throttled: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 429 && response.url().includes("/api/v1/")) {
      throttled.push(new URL(response.url()).pathname);
    }
  });
  await login(page);
  // Rendering-only palette coverage: persisted branding is tested separately via the UI.
  for (const palette of ["ocean", "iris", "forest"]) {
    for (const mode of ["light", "dark"]) {
      await page
        .getByRole("link", { name: "Display preferences", exact: true })
        .click();
      await page
        .getByRole("radio", {
          name: mode === "light" ? "Light" : "Dark",
          exact: true,
        })
        .check();
      for (const route of [
        "/",
        "/people",
        "/teams",
        "/people/30000000-0000-4000-8000-000000000001",
        "/preferences",
      ]) {
        // Exercise normal client navigation. Reloading the whole app for every
        // palette/route discards its query cache and creates an artificial burst
        // against the real authentication/API limits on faster CI runners.
        if (route.startsWith("/people/")) {
          await page
            .getByRole("link", { name: "Overview", exact: true })
            .click();
          await page
            .getByRole("link", { name: /Your place in the picture/ })
            .click();
        } else {
          const label =
            route === "/"
              ? "Overview"
              : route === "/people"
                ? "People directory"
                : route === "/teams"
                  ? "Team explorer"
                  : "Display preferences";
          await page.getByRole("link", { name: label, exact: true }).click();
        }
        await expect(page).toHaveURL(
          new URL(route, "http://127.0.0.1:5173").href,
        );
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, palette);
        await accessible(page);
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await page.locator("label.switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.goto("/login");
  await accessible(page);
  expect(throttled).toEqual([]);
});
