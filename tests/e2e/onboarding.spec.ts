import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
test("candidate invitation, autosave, correction and approval across isolated hosts", async ({
  page,
  context,
}, info) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(15000);
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Candidate intake", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make room for someone new." }),
  ).toBeVisible();
  await accessible(page);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "New intake", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const suffix = randomUUID().slice(0, 8);
  await dialog.getByLabel("Full name").fill(`Avery ${suffix}`);
  await dialog
    .getByLabel("Nominated email")
    .fill(`avery-${suffix}@anvi.example`);
  await dialog.getByLabel("Proposed role").fill("Product designer");
  await dialog.getByLabel("Proposed joining date").fill("2027-01-01");
  for (const label of ["Department", "Location", "Reporting manager"]) {
    await expect(dialog.getByLabel(label).locator("option")).not.toHaveCount(1);
    await dialog.getByLabel(label).selectOption({ index: 1 });
  }
  await accessible(page);
  await dialog
    .getByRole("button", { name: "Create intake", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: `Avery ${suffix}`, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Action / review reason")
    .fill("Prepare fictional candidate welcome for acceptance review.");
  await page
    .getByRole("button", { name: "Create invitation preview", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Rotate invitation preview",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open delivery tray", exact: true })
    .click();
  const invitation = page.getByRole("link", {
    name: "Open candidate invitation",
  });
  await expect(invitation).toBeVisible();
  const href = await invitation.getAttribute("href");
  const candidate = await context.newPage();
  await candidate.goto(href!);
  await expect(candidate).toHaveURL("http://127.0.0.2:5174/");
  await accessible(candidate);
  await candidate
    .getByRole("button", { name: "Continue with invitation" })
    .click();
  await expect(candidate.getByLabel("Verification code")).toBeVisible();
  await page.getByRole("button", { name: "Refresh delivery tray" }).click();
  const code = await page.locator(".intake-code strong").innerText();
  await candidate.getByLabel("Verification code").fill(code);
  await candidate.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    candidate.getByRole("heading", { name: /Good to meet you/ }),
  ).toBeVisible();
  expect(
    (await context.cookies("http://127.0.0.1:5173")).some(
      (c) => c.name === "anvi_candidate_preview",
    ),
  ).toBe(false);
  expect(
    (await context.cookies("http://127.0.0.2:5174")).some(
      (c) => c.name === "anvi_dev_session",
    ),
  ).toBe(false);
  await candidate.getByLabel("What should we call you?").fill("Avery");
  await candidate
    .getByLabel("A professional introduction")
    .fill(
      "I am a fictional product designer who enjoys thoughtful workplace experiences.",
    );
  await candidate.getByRole("checkbox").check();
  await expect(
    candidate.getByRole("button", { name: "Submit introduction" }),
  ).toBeEnabled();
  await expect(candidate.getByRole("status")).toHaveText("All changes saved");
  await candidate.reload();
  await expect(candidate.getByLabel("What should we call you?")).toHaveValue(
    "Avery",
  );
  for (const width of [320, 390, 768, 1440]) {
    await candidate.setViewportSize({ width, height: 1000 });
    expect(
      await candidate.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await accessible(candidate);
  }
  await candidate.screenshot({
    path: info.outputPath("candidate-desktop.png"),
    fullPage: true,
  });
  await candidate.setViewportSize({ width: 390, height: 844 });
  await candidate.screenshot({
    path: info.outputPath("candidate-mobile.png"),
    fullPage: true,
  });
  await candidate.getByRole("button", { name: "Submit introduction" }).click();
  await expect(
    candidate.getByRole("heading", { name: "Thank you. Over to HR." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Request changes", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Action / review reason")
    .fill("Please add your fictional collaboration interests.");
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await expect(
    page.getByText(
      "Latest review: Please add your fictional collaboration interests.",
    ),
  ).toBeVisible();
  await candidate.getByRole("button", { name: "Check review status" }).click();
  await expect(candidate.getByText("HR requested an update")).toBeVisible();
  await candidate
    .getByLabel("A professional introduction")
    .fill(
      "I am a fictional product designer interested in accessible team collaboration.",
    );
  await expect(
    candidate.getByRole("button", { name: "Submit introduction" }),
  ).toBeEnabled();
  await candidate.getByRole("button", { name: "Submit introduction" }).click();
  await expect(
    candidate.getByRole("heading", { name: "Thank you. Over to HR." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Approve form", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Action / review reason")
    .fill("Fictional introduction reviewed and approved for this form only.");
  await page.getByRole("button", { name: "Approve form", exact: true }).click();
  await expect(
    page.locator(".intake-detail").getByText("Form approved", { exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("heading", { name: "Make room for someone new." })
    .click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("intake-review-desktop.png"),
    fullPage: true,
  });
  await candidate.getByRole("button", { name: "Check review status" }).click();
  await expect(
    candidate.getByRole("heading", { name: "Your form is approved." }),
  ).toBeVisible();
  await accessible(candidate);
});
