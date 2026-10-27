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

test("upload, download and withdraw a document; HR verifies others' documents", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page);
  await role(page, "Employee");
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your papers, kept private." }),
  ).toBeVisible();
  await accessible(page);

  const title = `Address proof ${Math.random().toString(36).slice(2, 7)}`;
  await page.getByRole("button", { name: "Upload a document" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload a document" });
  await dialog.getByRole("button", { name: /What is it\?/ }).click();
  await page.getByRole("option", { name: "Other" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Title" }).fill(title);
  await dialog.getByLabel("File").setInputFiles({
    name: "address-proof.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      `%PDF-1.4\n% ${title}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n`,
      "latin1",
    ),
  });
  await accessible(page);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator(".document-row").filter({ hasText: title });
  await expect(row).toContainText("Awaiting HR");
  await expect(row).toContainText("address-proof.pdf");
  const download = page.waitForEvent("download");
  await row.getByRole("link", { name: `Download ${title}` }).click();
  expect((await download).suggestedFilename()).toBe("address-proof.pdf");
  await row.getByRole("button", { name: `Withdraw ${title}` }).click();
  await expect(row).toContainText("Withdrawn");

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("documents-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await role(page, "HR admin");
  await page.goto("/documents");
  // HR reviews but does not own documents, so the review lane is the whole page.
  const reviewTab = page.getByRole("tab", { name: "Review" });
  if (await reviewTab.count()) await reviewTab.click();
  await expect(
    page.getByRole("heading", { name: "Waiting for verification" }),
  ).toBeVisible();
  const verify = page.getByRole("button", { name: /^Verify / });
  if (await verify.count()) {
    const before = await verify.count();
    await verify.first().click();
    await expect(verify).toHaveCount(before - 1);
  } else {
    await expect(page.getByText("Nothing to verify")).toBeVisible();
  }
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("documents-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();
});
