import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function selectRole(page: Page, role: string) {
  await page
    .getByRole("button", { name: "Your workspace role", exact: true })
    .click();
  await page.getByRole("button", { name: role, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function setAvailability(page: Page, name: string, active: boolean) {
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page
    .getByRole("radio", { name: active ? /^Active/ : /^Inactive/ })
    .check();
  await page
    .getByLabel("Reason for change")
    .fill(
      active
        ? "Restore this synthetic record for assignment review."
        : "Retain this synthetic test record without future assignments.",
    );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(`${name} saved.`);
}

test("organization records stay scoped, audited, responsive and safe under concurrent edits", async ({
  page,
  context,
}, info) => {
  test.setTimeout(150000);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const code = `QA_${suffix}`;
  const original = `Quality lab ${suffix}`;
  const renamed = `Quality studio ${suffix}`;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Organization, kept in order." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Engineering", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("organization-desktop.png"),
    fullPage: true,
  });
  for (const width of [320, 768, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("organization-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Use dark theme", exact: true })
    .click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("organization-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Use light theme", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Add department", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(original);
  await page.getByLabel("Permanent code", { exact: true }).fill(code);
  await page.getByLabel("Reason for change").fill("          ");
  await page
    .getByRole("button", { name: "Create department", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Explain the change in 10–300 characters.",
  );
  await page
    .getByLabel("Reason for change")
    .fill("Create a synthetic department for the acceptance journey.");
  await accessible(page);
  await page
    .getByRole("button", { name: "Create department", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(`${original} created.`);
  await page.getByRole("textbox", { name: "Search departments" }).fill(code);
  await expect(
    page.getByRole("heading", { name: original, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Search departments" }),
  ).toHaveValue(code);
  await page
    .getByRole("button", { name: `Edit ${original}`, exact: true })
    .click();
  await expect(
    page.getByLabel("Permanent code", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await page
    .getByLabel("Name", { exact: true })
    .fill(`Stale revision ${suffix}`);
  await page
    .getByLabel("Reason for change")
    .fill("Attempt a change from a stale version for conflict review.");

  const otherPage = await context.newPage();
  await otherPage.goto(`/organization?kind=department&q=${code}`);
  await otherPage
    .getByRole("button", { name: `Edit ${original}`, exact: true })
    .click();
  await otherPage.getByLabel("Name", { exact: true }).fill(renamed);
  await otherPage
    .getByLabel("Reason for change")
    .fill("Rename this synthetic department from the second review window.");
  await otherPage
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(otherPage.getByRole("status")).toContainText(
    `${renamed} saved.`,
  );
  await otherPage.close();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Reload the list and review the latest record",
  );
  await page.getByRole("button", { name: "Reload list", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: `Stale revision ${suffix}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await setAvailability(page, renamed, false);
  await page.reload();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await setAvailability(page, renamed, true);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await setAvailability(page, renamed, false);
  await page
    .getByRole("textbox", { name: "Search departments" })
    .fill(`NO_SUCH_${suffix}`);
  await expect(
    page.getByRole("heading", { name: "No matching records" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear search", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "Locations", exact: true }).click();
  await expect(page).toHaveURL(/kind=location/);
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  const locationName = `Quality workspace ${suffix}`;
  await page.getByLabel("Name", { exact: true }).fill(locationName);
  await page.getByLabel("Permanent code", { exact: true }).fill(`QL_${suffix}`);
  await page
    .getByLabel("Reason for change")
    .fill("Create a synthetic location for the acceptance journey.");
  await page
    .getByRole("button", { name: "Create location", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    `${locationName} created.`,
  );
  await page
    .getByRole("textbox", { name: "Search locations" })
    .fill(`QL_${suffix}`);
  await setAvailability(page, locationName, false);

  for (const role of ["Employee", "Platform admin"]) {
    await selectRole(page, role);
    await expect(
      page.getByRole("link", { name: "Organization", exact: true }),
    ).toHaveCount(0);
    await page.goto("/organization");
    await expect(
      page.getByText(
        "Organization records require an assigned HR admin workspace.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add department", exact: true }),
    ).toHaveCount(0);
  }
  await selectRole(page, "Auditor");
  await page.goto("/activity");
  await page.getByRole("button", { name: /Activity type/ }).click();
  await page.getByRole("option", { name: "Organization records" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(
    page
      .getByRole("heading", { name: "Created an organization record" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /View event/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Reason");
  await expect(page.getByRole("dialog")).toContainText("synthetic");
});
