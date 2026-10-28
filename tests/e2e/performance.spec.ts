import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "redis";
import { mkdirSync } from "node:fs";
import { loginAs, type PersonaKey } from "./support/personas";

// Behaviour under test: Performance (PERF-01) with an employee (Aarav), his manager (Neel),
// HR (Kabir) and a second HR user (Maya). Neel's active goal is the parent of Aarav's goal; HR
// opens a cycle for Aarav's department; self-review, manager review and finalisation follow.
const evidence = "docs/acceptance-evidence/performance";

async function resetRateLimits() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* No local .env: nothing to reset. */
  }
  const url = process.env.RATE_LIMIT_URL;
  if (!url) return;
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.port !== "56379") return;
  const client = createClient({ url });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: "anvione:rl:*",
      COUNT: 200,
    }))
      if (keys.length) await client.del(keys);
  } finally {
    await client.quit();
  }
}
// Four signed-in contexts per run: skip per-context traces and failure shots.
test.use({ trace: "off", screenshot: "off", actionTimeout: 15000 });
test.beforeAll(resetRateLimits);
test.afterAll(resetRateLimits);

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

async function openPerformance(page: Page, tab?: string) {
  // Four browsers share one address, so keep well inside the per-minute API budget.
  await resetRateLimits();
  await page.goto("/performance");
  await expect(
    page.getByRole("heading", { name: "Performance", level: 1 }),
  ).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
}

async function as(
  browser: import("@playwright/test").Browser,
  persona: PersonaKey,
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await loginAs(page, persona);
  // Leave the home screen (it draws a WebGL globe) so four browsers stay light.
  await page.goto("/performance");
  return { page, context };
}

// Records are kept for good, so older runs fill the lists: page forward until the row shows.
async function openRow(page: Page, name: string) {
  const row = page.getByRole("button", { name }).first();
  // Wait for the list to finish loading before deciding the row is on another page.
  await expect(page.getByText(/^(Showing|No )/).first()).toBeVisible();
  for (let turn = 0; turn < 30; turn++) {
    if (await row.isVisible()) break;
    const next = page.getByRole("button", { name: "Next", exact: true });
    if (!(await next.isVisible()) || (await next.isDisabled())) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  await row.click();
}

const iso = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function rate(scope: Locator, area: string, value: number) {
  await scope
    .getByRole("radio", { name: new RegExp(`^${area}: ${value},`) })
    .check({ force: true });
}

// Performance records are kept by design (database triggers refuse deletes), so this spec
// cannot remove its synthetic goals, cycles or reviews. Every run uses a fresh random tag in
// names, so reruns never collide. Each run leaves two open cycles, three goals and their reviews.

test("performance runs from goal to a finalised review", async ({
  browser,
}) => {
  test.setTimeout(420000);
  mkdirSync(evidence, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  const parentTitle = `Grow the platform ${tag}`;
  const goalTitle = `Improve onboarding ${tag}`;
  const cycleName = `Review ${tag}`;
  const peopleCycle = `People review ${tag}`;
  const shot = (page: Page, name: string) =>
    page.screenshot({ path: `${evidence}/${name}.png` });
  const contexts: import("@playwright/test").BrowserContext[] = [];
  try {
    const kabir = await as(browser, "hr");
    const maya = await as(browser, "maya");
    const neel = await as(browser, "manager");
    const aarav = await as(browser, "employee");
    contexts.push(kabir.context, maya.context, neel.context, aarav.context);
    const hr = kabir.page;

    await test.step("a manager sets and activates a goal with a key result", async () => {
      const page = neel.page;
      await openPerformance(page);
      await page.getByRole("button", { name: "New goal" }).click();
      const form = page.getByRole("dialog", { name: "New goal" });
      await form.getByLabel("Goal", { exact: true }).fill(parentTitle);
      await form.getByLabel("Description (optional)").fill(`Synthetic ${tag}`);
      await form.getByLabel("Starts").fill(iso(0));
      await form.getByLabel("Ends").fill(iso(120));
      await form.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openRow(page, `Details: ${parentTitle}`);
      const detail = page.getByRole("dialog", { name: parentTitle });
      await expect(detail).toContainText("Add at least one before activating");
      await detail.getByRole("button", { name: "Add key result" }).click();
      const kr = page.getByRole("dialog", { name: "Add a key result" });
      await kr
        .getByLabel("Key result", { exact: true })
        .fill("Teams on the platform");
      await kr.getByLabel("Starting value").fill("0");
      await kr.getByLabel("Target value").fill("10");
      await accessible(page);
      await shot(page, "key-result-form");
      await kr
        .getByRole("button", { name: "Add a key result", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openRow(page, `Details: ${parentTitle}`);
      const again = page.getByRole("dialog", { name: parentTitle });
      await expect(again).toContainText("Teams on the platform");
      await again.getByRole("button", { name: "Activate" }).click();
      await expect(again).toContainText("Active");
      await page.keyboard.press("Escape");
    });

    await test.step("the employee creates a goal aligned to the manager's, adds a key result and logs progress", async () => {
      const page = aarav.page;
      await openPerformance(page);
      await expect(
        page.getByRole("tab", { name: "Review cycles" }),
      ).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Finalise" })).toHaveCount(0);
      await page.getByRole("button", { name: "New goal" }).click();
      const form = page.getByRole("dialog", { name: "New goal" });
      await form.getByLabel("Goal", { exact: true }).fill(goalTitle);
      await form.getByLabel("Starts").fill(iso(0));
      await form.getByLabel("Ends").fill(iso(90));
      await pick(page, form, /Aligns to/, `${parentTitle} (Neel Rao)`);
      await accessible(page);
      await shot(page, "goal-form");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await openRow(page, `Details: ${goalTitle}`);
      const detail = page.getByRole("dialog", { name: goalTitle });
      // Goals are visible to their owner, manager and HR, so the parent shows only as a hint.
      await expect(detail).toContainText("not visible to you");
      await detail.getByRole("button", { name: "Add key result" }).click();
      const kr = page.getByRole("dialog", { name: "Add a key result" });
      await kr
        .getByLabel("Key result", { exact: true })
        .fill("Setup completed in a day");
      await pick(page, kr, /Unit/, "Percent");
      await kr.getByLabel("Starting value").fill("0");
      await kr.getByLabel("Target value").fill("100");
      await kr
        .getByRole("button", { name: "Add a key result", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await openRow(page, `Details: ${goalTitle}`);
      const open = page.getByRole("dialog", { name: goalTitle });
      await open.getByRole("button", { name: "Activate" }).click();
      await expect(open).toContainText("Active");
      await open.getByRole("button", { name: "Log progress" }).click();
      const log = page.getByRole("dialog", { name: "Log progress" });
      await log.getByLabel("New value").fill("40");
      await log.getByLabel("Note (optional)").fill(`Synthetic ${tag}`);
      await log.getByRole("button", { name: "Log progress" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await openRow(page, `Details: ${goalTitle}`);
      const after = page.getByRole("dialog", { name: goalTitle });
      await expect(
        after.getByRole("progressbar", { name: /Overall progress/ }),
      ).toHaveAttribute("aria-valuenow", "40");
      await after.getByRole("button", { name: "Show history" }).click();
      await expect(after).toContainText("0% to 40%");
      await shot(page, "goal-detail");
      await page.keyboard.press("Escape");
    });

    await test.step("the manager sees the report's goal and the aligned goal under their own", async () => {
      const page = neel.page;
      await openPerformance(page, "Team goals");
      await page.getByRole("textbox", { name: "Search" }).fill(tag);
      await openRow(page, `Details: ${goalTitle}`);
      const detail = page.getByRole("dialog", { name: goalTitle });
      await expect(detail).toContainText("Aarav Shah");
      await expect(
        detail.getByRole("progressbar", { name: /Overall progress/ }),
      ).toHaveAttribute("aria-valuenow", "40");
      await shot(page, "team-goal");
      await page.keyboard.press("Escape");
      await openPerformance(page, "Goals");
      await openRow(page, `Details: ${parentTitle}`);
      const parent = page.getByRole("dialog", { name: parentTitle });
      await expect(parent).toContainText("Aligned goals");
      await expect(parent).toContainText(goalTitle);
      await page.keyboard.press("Escape");
    });

    await test.step("HR creates a cycle and a second HR user opens it", async () => {
      await openPerformance(hr, "Review cycles");
      await hr.getByRole("button", { name: "New review cycle" }).click();
      const form = hr.getByRole("dialog", { name: "New review cycle" });
      await form.getByLabel("Cycle name").fill(cycleName);
      await form.getByLabel("Review period starts").fill(iso(0));
      await form.getByLabel("Review period ends").fill(iso(90));
      await form.getByLabel("Self-reviews due").fill(iso(30));
      await form.getByLabel("Manager reviews due").fill(iso(60));
      await pick(hr, form, /Department/, "Customer experience");
      await accessible(hr);
      await shot(hr, "cycle-form");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);

      await openPerformance(maya.page, "Review cycles");
      await openRow(maya.page, `Details: ${cycleName}`);
      const detail = maya.page.getByRole("dialog", { name: cycleName });
      await expect(detail).toContainText("Draft");
      await detail.getByRole("button", { name: "Open cycle" }).click();
      const confirm = maya.page.getByRole("dialog", {
        name: "Open this cycle?",
      });
      await confirm.getByRole("button", { name: "Open cycle" }).click();
      await expect(maya.page.getByRole("dialog")).toHaveCount(0);
      await expect(
        maya.page.getByRole("status").filter({ hasText: "is open" }),
      ).toContainText(
        new RegExp(
          String.raw`${cycleName} is open\. \d+ reviews? (was|were) generated`,
        ),
      );
      await shot(maya.page, "cycle-opened");
    });

    await test.step("the employee writes a self-review and the status stays honest", async () => {
      const page = aarav.page;
      await openPerformance(page, "My reviews");
      await openRow(page, `Details: ${cycleName}`);
      const detail = page.getByRole("dialog", { name: cycleName });
      await expect(detail).toContainText("Your self-review is waiting for you");
      await expect(detail).toContainText("Your manager's review");
      await detail.getByRole("button", { name: "Write self-review" }).click();
      const form = page.getByRole("dialog", { name: "Your self-review" });
      await expect(
        form.getByRole("button", { name: "Submit review" }),
      ).toBeDisabled();
      await rate(form, "Quality of work", 4);
      await rate(form, "Delivery", 3);
      await rate(form, "Collaboration", 4);
      await rate(form, "Ownership", 5);
      await rate(form, "Growth", 3);
      await form.getByLabel("Comment (optional)").fill(`Self comment ${tag}`);
      await accessible(page);
      await shot(page, "self-review-form");
      await form.getByRole("button", { name: "Submit review" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openRow(page, `Details: ${cycleName}`);
      const after = page.getByRole("dialog", { name: cycleName });
      await expect(after).toContainText("Waiting for your manager's review");
      await expect(after).toContainText("Self comment " + tag);
      await expect(after).toContainText("Your self-review is in");
      await shot(page, "my-review-waiting");
      await page.keyboard.press("Escape");
    });

    await test.step("the manager reviews blind, then sees both reviews", async () => {
      const page = neel.page;
      await openPerformance(page, "Team reviews");
      await openRow(page, `Details: Aarav Shah`);
      const detail = page.getByRole("dialog", { name: /Aarav Shah/ });
      await expect(detail).toContainText("The self-review stays hidden");
      await expect(detail).not.toContainText("Self comment");
      await detail
        .getByRole("button", { name: "Write manager review" })
        .click();
      const form = page.getByRole("dialog", {
        name: "Manager review for Aarav Shah",
      });
      await rate(form, "Quality of work", 4);
      await rate(form, "Delivery", 4);
      await rate(form, "Collaboration", 5);
      await rate(form, "Ownership", 4);
      await rate(form, "Growth", 4);
      await form
        .getByLabel("Comment (optional)")
        .fill(`Manager comment ${tag}`);
      await form.getByRole("button", { name: "Submit review" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openRow(page, `Details: Aarav Shah`);
      const after = page.getByRole("dialog", { name: /Aarav Shah/ });
      await expect(after).toContainText("Self comment " + tag);
      await expect(after).toContainText("Manager comment " + tag);
      await shot(page, "manager-review-both");
      await page.keyboard.press("Escape");
    });

    await test.step("the employee cannot see the manager review before HR finalises", async () => {
      const page = aarav.page;
      await openPerformance(page, "My reviews");
      await openRow(page, `Details: ${cycleName}`);
      const detail = page.getByRole("dialog", { name: cycleName });
      await expect(detail).toContainText("With HR for the final rating");
      await expect(detail).not.toContainText("Manager comment");
      await page.keyboard.press("Escape");
    });

    await test.step("HR finalises with a reason", async () => {
      await openPerformance(hr, "Finalise");
      await openRow(hr, `Details: Aarav Shah, ${cycleName}`);
      const detail = hr.getByRole("dialog", {
        name: `Aarav Shah, ${cycleName}`,
      });
      await expect(detail).toContainText("Self comment " + tag);
      await detail.getByRole("button", { name: "Finalise review" }).click();
      const form = hr.getByRole("dialog", {
        name: "Finalise review for Aarav Shah",
      });
      await rate(form, "Final rating", 4);
      await form.getByLabel("Reason for the rating").fill("short");
      await expect(
        form.getByRole("button", { name: "Finalise" }),
      ).toBeDisabled();
      await form
        .getByLabel("Reason for the rating")
        .fill(`Consistent delivery this cycle ${tag}`);
      await accessible(hr);
      await shot(hr, "finalise-form");
      await form.getByRole("button", { name: "Finalise", exact: true }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("the employee sees the finalised result", async () => {
      const page = aarav.page;
      await openPerformance(page, "My reviews");
      await openRow(page, `Details: ${cycleName}`);
      const detail = page.getByRole("dialog", { name: cycleName });
      await expect(detail).toContainText("Your result is ready");
      await expect(detail).toContainText("Final rating 4 of 5");
      await expect(detail).toContainText(
        `Consistent delivery this cycle ${tag}`,
      );
      await expect(detail).toContainText("Manager comment " + tag);
      await shot(page, "my-review-result");
      await page.keyboard.press("Escape");
    });

    await test.step("HR cannot finalise their own review: the four-eyes message shows", async () => {
      await openPerformance(hr, "Review cycles");
      await hr.getByRole("button", { name: "New review cycle" }).click();
      const form = hr.getByRole("dialog", { name: "New review cycle" });
      await form.getByLabel("Cycle name").fill(peopleCycle);
      await form.getByLabel("Review period starts").fill(iso(0));
      await form.getByLabel("Review period ends").fill(iso(90));
      await form.getByLabel("Self-reviews due").fill(iso(30));
      await form.getByLabel("Manager reviews due").fill(iso(60));
      await pick(hr, form, /Department/, "People & culture");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await openPerformance(maya.page, "Review cycles");
      await openRow(maya.page, `Details: ${peopleCycle}`);
      await maya.page
        .getByRole("dialog", { name: peopleCycle })
        .getByRole("button", { name: "Open cycle" })
        .click();
      await maya.page
        .getByRole("dialog", { name: "Open this cycle?" })
        .getByRole("button", { name: "Open cycle" })
        .click();
      // Maya has no manager, so she is skipped and the count says so.
      await expect(
        maya.page.getByRole("status").filter({ hasText: "is open" }),
      ).toContainText("skipped because they have no manager");

      await openPerformance(hr, "Finalise");
      await hr.getByRole("button", { name: /Status/ }).click();
      await hr.getByRole("option", { name: "All statuses" }).click();
      await expect(hr.getByRole("listbox")).toHaveCount(0);
      await openRow(hr, `Details: Kabir Sethi, ${peopleCycle}`);
      const own = hr.getByRole("dialog", {
        name: `Kabir Sethi, ${peopleCycle}`,
      });
      await expect(own).toContainText("You cannot finalise this review");
      await expect(
        own.getByRole("button", { name: "Finalise review" }),
      ).toHaveCount(0);
      await shot(hr, "four-eyes");
      await hr.keyboard.press("Escape");
    });

    await test.step("every tab is accessible in light and dark", async () => {
      const groups: [Page, string[]][] = [
        [hr, ["All goals", "Review cycles", "Finalise"]],
        [neel.page, ["Goals", "Team goals", "My reviews", "Team reviews"]],
        [aarav.page, ["Goals", "My reviews"]],
      ];
      for (const mode of ["light", "dark"]) {
        for (const [page, tabs] of groups) {
          await openPerformance(page);
          if (mode === "dark")
            await page.getByRole("button", { name: "Use dark theme" }).click();
          for (const tab of tabs) {
            await page.getByRole("tab", { name: tab, exact: true }).click();
            await expect(page.getByRole("tabpanel")).toBeVisible();
            await page.waitForTimeout(300);
            await accessible(page);
          }
        }
        await openPerformance(hr, "All goals");
        await shot(hr, `goals-${mode}`);
        await hr
          .getByRole("tab", { name: "Review cycles", exact: true })
          .click();
        await shot(hr, `cycles-${mode}`);
      }
      await openPerformance(aarav.page, "Goals");
      await aarav.page.getByRole("textbox", { name: "Search" }).fill(tag);
      await openRow(aarav.page, `Details: ${goalTitle}`);
      await expect(
        aarav.page.getByRole("dialog", { name: goalTitle }),
      ).toBeVisible();
      await aarav.page.waitForTimeout(400);
      await accessible(aarav.page);
      await shot(aarav.page, "goal-detail-dark");
      await aarav.page.keyboard.press("Escape");
    });

    await test.step("phones never scroll sideways", async () => {
      for (const [page, tabs] of [
        [hr, ["All goals", "Review cycles", "Finalise"]],
        [aarav.page, ["Goals", "My reviews"]],
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
