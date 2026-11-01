import {
  test,
  expect,
  resetRateLimits,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "./support/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { loginAs, type PersonaKey } from "./support/personas";

// Behaviour under test: Helpdesk (HLP-01) with an employee (Aarav), his manager (Neel) and HR
// (Kabir). HR writes and publishes an article; Aarav sees it suggested while raising a case; Kabir
// takes the case, adds an internal note and a public reply, waits on the employee, resumes and
// resolves; Aarav cannot see the internal note, reopens once, then closes with a rating. A
// confidential case is visible to HR but not to the manager. HR raising their own case gets the
// four-eyes message.
const evidence = "docs/acceptance-evidence/helpdesk";

// Three signed-in contexts per run: skip per-context traces and failure shots.
test.use({ trace: "off", screenshot: "off", actionTimeout: 15000 });

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

async function pick(page: Page, scope: Locator, label: RegExp, option: string) {
  await scope.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
  // Let the listbox finish closing so axe does not read it mid-fade.
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function openHelpdesk(page: Page, tab?: string) {
  // Three browsers share one address, so keep well inside the per-minute API budget.
  await resetRateLimits();
  await page.goto("/helpdesk");
  await expect(
    page.getByRole("heading", { name: "Helpdesk", level: 1 }),
  ).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
}

async function as(browser: Browser, persona: PersonaKey) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await loginAs(page, persona);
  // Leave the home screen (it draws a WebGL globe) so three browsers stay light.
  await page.goto("/helpdesk");
  return { page, context };
}

// Records are kept for good, so older runs fill the lists: search by the run's tag, then open.
async function openCase(page: Page, tag: string, subject: string) {
  await page.getByRole("textbox", { name: "Search" }).fill(tag);
  const card = page.getByRole("button", { name: `Details: ${subject}` });
  await expect(card).toBeVisible();
  await card.click();
  const detail = page.getByRole("dialog", { name: subject });
  await expect(detail).toBeVisible();
  return detail;
}

async function raise(
  page: Page,
  input: {
    subject: string;
    description: string;
    priority?: string;
    confidential?: boolean;
  },
) {
  await page
    .getByRole("button", { name: "Raise a case", exact: true })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: "Raise a case" });
  await pick(page, form, /Category/, "Payroll query");
  await form.getByLabel("Subject").fill(input.subject);
  await form.getByLabel("What do you need help with?").fill(input.description);
  if (input.priority) await pick(page, form, /Priority/, input.priority);
  if (input.confidential)
    await form
      .getByRole("checkbox", { name: /Keep this case confidential/ })
      .check({ force: true });
  return form;
}

// Helpdesk records are kept by design (database triggers refuse deletes), so this spec cannot
// remove its synthetic cases, comments, categories or articles. Every run uses a fresh random tag
// in names, so reruns never collide. Each run leaves one category, one archived article and four
// cases (one closed, one cancelled, one with HR as requester).

test("helpdesk runs from a raised case to a rated close", async ({
  browser,
}) => {
  test.setTimeout(420000);
  mkdirSync(evidence, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 7);
  const articleTitle = `Payslip guide ${tag}`;
  const subject = `Payslip question ${tag}`;
  const secretSubject = `Private matter ${tag}`;
  const hrSubject = `Laptop request ${tag}`;
  const internalNote = `Check payroll ledger ${tag}`;
  const publicReply = `We are checking your payslip ${tag}`;
  const question = `Which month is wrong ${tag}`;
  const shot = (page: Page, name: string) =>
    page.screenshot({ path: `${evidence}/${name}.png` });
  const contexts: BrowserContext[] = [];
  try {
    const kabir = await as(browser, "hr");
    const neel = await as(browser, "manager");
    const aarav = await as(browser, "employee");
    contexts.push(kabir.context, neel.context, aarav.context);
    const hr = kabir.page;

    await test.step("HR writes and publishes a knowledge article", async () => {
      await openHelpdesk(hr, "Settings");
      await expect(
        hr.getByText(/wall-clock hours, not business hours/i).first(),
      ).toBeVisible();
      await hr.getByRole("button", { name: "Write an article" }).click();
      const form = hr.getByRole("dialog", { name: "Write an article" });
      await form.getByLabel("Title").fill(articleTitle);
      await form
        .getByRole("textbox", { name: /Article text/ })
        .fill(`Your payslip is issued on the last working day ${tag}.`);
      await form
        .getByLabel("Keywords (comma separated)")
        .fill(`payslip, ${tag}`);
      await accessible(hr);
      await shot(hr, "article-form");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await hr
        .getByRole("button", { name: `Publish: ${articleTitle}` })
        .first()
        .click();
      await expect(
        hr.getByRole("button", { name: `Archive: ${articleTitle}` }).first(),
      ).toBeVisible();
    });

    await test.step("the employee sees the suggestion, labelled as keyword matching", async () => {
      const page = aarav.page;
      await openHelpdesk(page);
      await expect(page.getByRole("tab", { name: "Agent queue" })).toHaveCount(
        0,
      );
      await expect(page.getByRole("tab", { name: "Settings" })).toHaveCount(0);
      const form = await raise(page, {
        subject,
        description: `My payslip total looks wrong this month ${tag}`,
        priority: "High",
      });
      const suggest = form.getByRole("region", {
        name: "These articles may help",
      });
      await expect(suggest).toContainText("Suggested by keyword match, not AI");
      await expect(suggest).toContainText(articleTitle);
      await suggest.getByText(articleTitle).click();
      await expect(suggest).toContainText(`last working day ${tag}`);
      await accessible(page);
      await shot(page, "raise-case");
      await form.getByRole("button", { name: "Raise case" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("status")).toContainText(
        /Case HLP-\d+ was raised/,
      );
      const detail = await openCase(page, tag, subject);
      await expect(detail).toContainText("Open");
      await expect(detail).toContainText("Not assigned yet");
      await expect(detail).toContainText(
        "Wall-clock hours, not business hours",
      );
      await shot(page, "my-case-open");
      await page.keyboard.press("Escape");
    });

    await test.step("HR takes the case, adds an internal note and a public reply", async () => {
      await openHelpdesk(hr, "Agent queue");
      const detail = await openCase(hr, tag, subject);
      await expect(detail).toContainText("Aarav Shah");
      await detail.getByRole("button", { name: "Take this case" }).click();
      await detail.getByRole("button", { name: "Start work" }).click();
      await expect(
        detail.getByRole("button", { name: "Wait on employee" }),
      ).toBeVisible();
      await detail.getByLabel("Write a message").fill(internalNote);
      await detail.getByRole("button", { name: "Add internal note" }).click();
      await expect(detail).toContainText(internalNote);
      await expect(detail).toContainText(
        "Internal — the employee cannot see this",
      );
      await detail.getByLabel("Write a message").fill(publicReply);
      await detail.getByRole("button", { name: "Send reply" }).click();
      await expect(detail).toContainText(publicReply);
      await detail.getByRole("button", { name: "Link an article" }).click();
      const link = hr.getByRole("dialog", { name: "Link an article" });
      await pick(hr, link, /Article/, articleTitle);
      await link.getByRole("button", { name: "Link article" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const again = await openCase(hr, tag, subject);
      await expect(again).toContainText(articleTitle);
      await again.getByRole("button", { name: "Assign" }).click();
      const assign = hr.getByRole("dialog", { name: "Assign this case" });
      await assign.getByRole("button", { name: /Assign to/ }).click();
      await expect(hr.getByRole("option", { name: "Maya Iyer" })).toBeVisible();
      await hr.keyboard.press("Escape");
      await assign.getByRole("button", { name: "Cancel" }).click();
      const open = await openCase(hr, tag, subject);
      await accessible(hr);
      await shot(hr, "agent-case");
      await open.getByRole("button", { name: "Change priority" }).click();
      const priority = hr.getByRole("dialog", { name: "Change priority" });
      await pick(hr, priority, /Priority/, "Urgent");
      await priority.getByRole("button", { name: "Change priority" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("HR waits on the employee with a question", async () => {
      const detail = await openCase(hr, tag, subject);
      await detail.getByRole("button", { name: "Wait on employee" }).click();
      const form = hr.getByRole("dialog", { name: "Wait on the employee?" });
      await form
        .getByLabel("Question for the employee (optional)")
        .fill(question);
      await shot(hr, "wait-dialog");
      await form.getByRole("button", { name: "Wait on employee" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const after = await openCase(hr, tag, subject);
      await expect(after).toContainText("Waiting on employee");
      await expect(after).toContainText(question);
      await hr.keyboard.press("Escape");
    });

    await test.step("the employee sees the reply but never the internal note, and answers", async () => {
      const page = aarav.page;
      await openHelpdesk(page);
      const detail = await openCase(page, tag, subject);
      await expect(detail).toContainText("Waiting on employee");
      await expect(detail).toContainText(publicReply);
      await expect(detail).toContainText(question);
      await expect(detail).toContainText(articleTitle);
      await expect(detail).not.toContainText(internalNote);
      await expect(detail).not.toContainText("Internal —");
      await expect(
        detail.getByRole("button", { name: "Add internal note" }),
      ).toHaveCount(0);
      await detail.getByLabel("Write a message").fill(`It is March ${tag}`);
      await detail.getByRole("button", { name: "Add comment" }).click();
      await expect(detail).toContainText(`It is March ${tag}`);
      await shot(page, "my-case-waiting");
      await page.keyboard.press("Escape");
    });

    await test.step("HR resumes and resolves", async () => {
      const detail = await openCase(hr, tag, subject);
      await expect(detail).toContainText(`It is March ${tag}`);
      await detail.getByRole("button", { name: "Resume" }).click();
      const resume = hr.getByRole("dialog", { name: "Resume work?" });
      await resume.getByRole("button", { name: "Resume" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const again = await openCase(hr, tag, subject);
      await expect(again).toContainText("In progress");
      await again.getByRole("button", { name: "Resolve", exact: true }).click();
      const form = hr.getByRole("dialog", { name: "Resolve this case?" });
      await form.getByLabel("Resolution note (optional)").fill(`Fixed ${tag}`);
      await form.getByRole("button", { name: "Resolve" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const done = await openCase(hr, tag, subject);
      await expect(done).toContainText("Resolved");
      await hr.keyboard.press("Escape");
    });

    await test.step("the employee reopens within the window, HR resolves again, the employee closes with a rating", async () => {
      const page = aarav.page;
      await openHelpdesk(page);
      const detail = await openCase(page, tag, subject);
      await expect(detail).toContainText("Resolved");
      await expect(detail).toContainText("You can reopen until");
      await shot(page, "my-case-resolved");
      await detail.getByRole("button", { name: "Reopen" }).click();
      const reopen = page.getByRole("dialog", { name: "Reopen this case?" });
      await expect(
        reopen.getByRole("button", { name: "Reopen", exact: true }),
      ).toBeDisabled();
      await reopen
        .getByLabel("What is still not right?")
        .fill(`April is wrong too ${tag}`);
      await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const open = await openCase(page, tag, subject);
      await expect(open).toContainText("In progress");
      await expect(open).toContainText("Reopened");
      await page.keyboard.press("Escape");

      const queue = await openCase(hr, tag, subject);
      await expect(queue).toContainText("In progress");
      await expect(queue).toContainText("Reopened");
      await queue.getByRole("button", { name: "Resolve", exact: true }).click();
      await hr
        .getByRole("dialog", { name: "Resolve this case?" })
        .getByRole("button", { name: "Resolve" })
        .click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);

      const resolved = await openCase(page, tag, subject);
      await resolved.getByRole("button", { name: "Close case" }).click();
      const close = page.getByRole("dialog", { name: "Close this case?" });
      await pick(page, close, /How helpful/, "5 of 5");
      await accessible(page);
      await shot(page, "close-with-rating");
      await close.getByRole("button", { name: "Close case" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const closed = await openCase(page, tag, subject);
      await expect(closed).toContainText("Closed");
      await expect(closed).toContainText("Your rating");
      await expect(closed).toContainText("5 of 5");
      await expect(
        closed.getByRole("button", { name: "Reopen", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
    });

    await test.step("a confidential case is visible to HR but not to the manager, and can be cancelled", async () => {
      const page = aarav.page;
      await openHelpdesk(page);
      const form = await raise(page, {
        subject: secretSubject,
        description: `A private matter I only want HR to see ${tag}`,
        confidential: true,
      });
      await form.getByRole("button", { name: "Raise case" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const mine = await openCase(page, tag, secretSubject);
      await expect(mine).toContainText("Confidential");
      await page.keyboard.press("Escape");

      await openHelpdesk(neel.page);
      await expect(
        neel.page.getByRole("tab", { name: "Agent queue" }),
      ).toHaveCount(0);
      await neel.page.getByRole("textbox", { name: "Search" }).fill(tag);
      await expect(neel.page.getByText("No cases match")).toBeVisible();
      await expect(
        neel.page.getByRole("button", { name: /^Details:/ }),
      ).toHaveCount(0);

      await openHelpdesk(hr, "Agent queue");
      const queue = await openCase(hr, tag, secretSubject);
      await expect(queue).toContainText("Confidential");
      await expect(queue).toContainText("Clear confidential");
      await shot(hr, "agent-confidential");
      await hr.keyboard.press("Escape");

      const cancel = await openCase(page, tag, secretSubject);
      await cancel.getByRole("button", { name: "Cancel case" }).click();
      const dialog = page.getByRole("dialog", { name: "Cancel this case?" });
      await dialog.getByLabel("Reason").fill(`Sorted it out myself ${tag}`);
      await dialog.getByRole("button", { name: "Cancel case" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const gone = await openCase(page, tag, secretSubject);
      await expect(gone).toContainText("Cancelled");
      await page.keyboard.press("Escape");
    });

    await test.step("HR raising their own case sees the four-eyes message and cannot take it", async () => {
      await openHelpdesk(hr);
      const form = await raise(hr, {
        subject: hrSubject,
        description: `I need a new laptop charger ${tag}`,
      });
      await form.getByRole("button", { name: "Raise case" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const detail = await openCase(hr, tag, hrSubject);
      await expect(detail).toContainText(
        "You raised this case, so you cannot work it",
      );
      await expect(
        detail.getByRole("button", { name: "Take this case" }),
      ).toHaveCount(0);
      await expect(
        detail.getByRole("button", { name: "Add internal note" }),
      ).toHaveCount(0);
      await shot(hr, "four-eyes");
      await hr.keyboard.press("Escape");
    });

    await test.step("HR adds a category and opens a service target", async () => {
      await openHelpdesk(hr, "Settings");
      await hr.getByRole("button", { name: "Add category" }).click();
      const form = hr.getByRole("dialog", { name: "Add category" });
      await form.getByLabel("Name").fill(`Test ${tag}`);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await expect(hr.getByText(`Test ${tag}`).first()).toBeVisible();
      await hr.getByRole("button", { name: "Edit: Urgent" }).click();
      const sla = hr.getByRole("dialog", { name: "Service target: Urgent" });
      await expect(sla).toContainText("not business hours");
      await accessible(hr);
      await shot(hr, "settings-sla");
      await sla.getByRole("button", { name: "Cancel" }).click();
      await hr
        .getByRole("button", { name: `Archive: ${articleTitle}` })
        .first()
        .click();
      await expect(
        hr.getByRole("button", { name: `Publish: ${articleTitle}` }).first(),
      ).toBeVisible();
    });

    await test.step("every tab is accessible in light and dark", async () => {
      const groups: [Page, string[]][] = [
        [hr, ["My cases", "Agent queue", "Knowledge", "Settings"]],
        [neel.page, ["My cases", "Knowledge"]],
        [aarav.page, ["My cases", "Knowledge"]],
      ];
      for (const mode of ["light", "dark"]) {
        for (const [page, tabs] of groups) {
          await openHelpdesk(page);
          if (mode === "dark")
            await page.getByRole("button", { name: "Use dark theme" }).click();
          for (const tab of tabs) {
            await page.getByRole("tab", { name: tab, exact: true }).click();
            await expect(page.getByRole("tabpanel")).toBeVisible();
            await page.waitForTimeout(300);
            await accessible(page);
          }
        }
        await openHelpdesk(hr, "Agent queue");
        await shot(hr, `queue-${mode}`);
        await hr.getByRole("tab", { name: "Settings", exact: true }).click();
        await shot(hr, `settings-${mode}`);
      }
      await openHelpdesk(aarav.page, "My cases");
      const detail = await openCase(aarav.page, tag, subject);
      await expect(detail).toContainText("Closed");
      await aarav.page.waitForTimeout(400);
      await accessible(aarav.page);
      await shot(aarav.page, "my-case-dark");
      await aarav.page.keyboard.press("Escape");
    });

    await test.step("phones never scroll sideways", async () => {
      for (const [page, tabs] of [
        [hr, ["My cases", "Agent queue", "Knowledge", "Settings"]],
        [aarav.page, ["My cases", "Knowledge"]],
      ] as [Page, string[]][]) {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const tab of tabs) {
          await page.getByRole("tab", { name: tab, exact: true }).click();
          await page.waitForTimeout(300);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(
            overflow,
            `${tab} overflows the phone width`,
          ).toBeLessThanOrEqual(0);
          await shot(page, `phone-${tab.toLowerCase().replace(/ /g, "-")}`);
        }
      }
    });
  } finally {
    for (const context of contexts) await context.close();
  }
});
