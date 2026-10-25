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
  const checklist = page.getByRole("region", { name: "Onboarding checklist" });
  await checklist
    .getByRole("button", { name: "Use starter checklist" })
    .click();
  await dialog
    .getByLabel("Checklist reason")
    .fill("Prepare fictional onboarding coordination tasks for review.");
  await dialog
    .getByRole("button", { name: "Start checklist", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(checklist.locator(".checklist-item")).toHaveCount(5);
  await checklist
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  await dialog
    .getByLabel("Task title")
    .fill("Choose a fictional induction topic");
  await dialog.getByLabel("Coordinating owner").selectOption("candidate");
  await dialog.getByLabel("Days from joining").fill("1");
  await dialog
    .getByLabel("Prerequisite")
    .selectOption({ label: "Record a fictional readiness check" });
  await dialog.getByRole("checkbox", { name: "Required task" }).uncheck();
  await accessible(page);
  await dialog
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(checklist.locator(".checklist-item")).toHaveCount(6);
  await checklist.getByLabel("Task owner").selectOption("candidate");
  await expect(checklist.locator(".checklist-item")).toHaveCount(2);
  await checklist.getByLabel("Task owner").selectOption("all");
  await checklist.getByLabel("Task status").selectOption("completed");
  await expect(checklist.getByRole("status")).toHaveText(
    "No tasks match these filters.",
  );
  await checklist.getByLabel("Task status").selectOption("all");
  await checklist
    .getByRole("button", {
      name: "Update Record a fictional readiness check",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByLabel("New task status").locator('option[value="completed"]'),
  ).toHaveJSProperty("disabled", true);
  await dialog.getByLabel("New task status").selectOption("blocked");
  await dialog
    .getByLabel("Completion / change note")
    .fill("Waiting for the fictional candidate coordination step.");
  await dialog.getByRole("button", { name: "Save task status" }).click();
  await expect(dialog).toHaveCount(0);
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
  const candidateTasks = candidate.getByRole("region", {
    name: "Your checklist",
  });
  await expect(candidateTasks.locator(".candidate-task")).toHaveCount(2);
  await expect(
    candidate.getByRole("heading", {
      name: "Record a fictional readiness check",
      exact: true,
    }),
  ).toHaveCount(0);
  await candidateTasks
    .getByRole("button", {
      name: "Update Share a fictional collaboration preference",
      exact: true,
    })
    .click();
  await expect(candidateTasks.getByLabel("New task status")).toBeFocused();
  await candidateTasks
    .getByLabel("Completion / change note")
    .fill("I prefer fictional collaborative design reviews with my team.");
  await candidateTasks
    .getByRole("button", { name: "Save task status" })
    .click();
  await expect(
    candidateTasks.getByText("1 of 1 required tasks complete.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    candidateTasks.getByRole("button", {
      name: "Update Share a fictional collaboration preference",
      exact: true,
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Request changes", exact: true }),
  ).toBeVisible();
  for (const task of [
    "Record a fictional readiness check",
    "Plan the fictional induction",
  ]) {
    await checklist
      .getByRole("button", { name: `Update ${task}`, exact: true })
      .click();
    await dialog.getByLabel("New task status").selectOption("completed");
    await dialog
      .getByLabel("Completion / change note")
      .fill(
        "Completed this fictional coordination task for acceptance review.",
      );
    await dialog.getByRole("button", { name: "Save task status" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      checklist.locator(".checklist-item").filter({
        has: page.getByRole("heading", { name: task, exact: true }),
      }),
    ).toContainText("Completed");
  }
  await expect(
    checklist.getByText("3/3 required", { exact: true }),
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
  const comparison = page.getByRole("region", { name: "Submission changes" });
  await expect(
    comparison.getByText(
      "I am a fictional product designer who enjoys thoughtful workplace experiences.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    comparison.getByText(
      "I am a fictional product designer interested in accessible team collaboration.",
      { exact: true },
    ),
  ).toBeVisible();
  await comparison.screenshot({
    path: info.outputPath("submission-comparison.png"),
  });
  await page
    .getByLabel("Action / review reason")
    .fill("Fictional introduction reviewed and approved for this form only.");
  await page.getByRole("button", { name: "Approve form", exact: true }).click();
  await expect(
    page.locator(".intake-detail").getByText("Form approved", { exact: true }),
  ).toBeVisible();
  await accessible(page);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await accessible(page);
  }
  await page
    .getByRole("button", { name: "Use dark theme", exact: true })
    .click();
  await accessible(page);
  await checklist.screenshot({ path: info.outputPath("checklist-dark.png") });
  await page
    .getByRole("button", { name: "Use light theme", exact: true })
    .click();
  await checklist.screenshot({
    path: info.outputPath("checklist-desktop.png"),
  });
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
  await candidateTasks
    .getByRole("button", {
      name: "Update Choose a fictional induction topic",
      exact: true,
    })
    .click();
  await expect(
    candidateTasks
      .getByLabel("New task status")
      .locator('option[value="completed"]'),
  ).toHaveJSProperty("disabled", false);
  await candidateTasks
    .getByLabel("Completion / change note")
    .fill("I would like a fictional introduction to accessible collaboration.");
  await candidateTasks
    .getByRole("button", { name: "Save task status" })
    .click();
  await expect(
    candidateTasks.locator(".candidate-task").filter({
      has: candidate.getByRole("heading", {
        name: "Choose a fictional induction topic",
        exact: true,
      }),
    }),
  ).toContainText("Completed");
  await candidate.setViewportSize({ width: 390, height: 844 });
  await candidateTasks.screenshot({
    path: info.outputPath("candidate-checklist-mobile.png"),
  });
  await candidate.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await candidateTasks
      .locator(".candidate-task-completed .candidate-task-heading span")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await accessible(candidate);
});
