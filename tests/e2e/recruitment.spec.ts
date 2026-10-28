import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "redis";
import { mkdirSync } from "node:fs";
import { loginAs, type PersonaKey } from "./support/personas";

// Behaviour under test: Recruitment (REC-01) as HR (Kabir and Maya), a hiring
// manager (Neel) and an interviewer employee (Aarav). The manager cannot list
// departments or locations yet (no organization.read), so HR raises the
// requisition and names the manager; the spec documents that limit.
const evidence = "docs/acceptance-evidence/recruitment";

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

async function person(scope: Locator, label: string, name: string) {
  await scope.getByLabel(label).fill(name.split(" ")[0]!);
  await scope.getByRole("button", { name: new RegExp(name) }).click();
}

async function openRecruitment(page: Page, tab?: string) {
  await page.goto("/recruitment");
  await expect(
    page.getByRole("heading", { name: "Recruitment", level: 1 }),
  ).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab }).click();
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
  await page.goto("/recruitment");
  return { page, context };
}

// Recruitment records are kept by design (database triggers refuse deletes, even
// for the owner), so this spec cannot remove its synthetic rows. Every run uses
// a fresh random tag in names and emails, so reruns never collide.

test("recruitment runs from requisition to an accepted offer", async ({
  browser,
}) => {
  test.setTimeout(420000);
  mkdirSync(evidence, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  // The slot is a couple of minutes away: scorecards open once an interview has
  // started, and interviews are kept for good so each run needs its own slot.
  const slotStart = new Date(Math.ceil((Date.now() + 100000) / 60000) * 60000);
  const jobTitle = `QA Engineer ${tag}`;
  const candidateName = `Priya Test ${tag}`;
  const email = `priya.${tag.toLowerCase()}@example.test`;
  const preboarding = `priya.${tag.toLowerCase()}@anvi.example`;
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

    // Interviews are kept for good, so earlier runs may still hold the
    // interviewer's calendar. Cancel their still-scheduled synthetic rounds.
    await test.step("earlier synthetic interviews are cancelled", async () => {
      const me = await (await hr.request.get("/api/v1/me")).json();
      const list = await hr.request.get(
        "/api/v1/recruit/interviews?status=scheduled&q=Priya%20Test&limit=100",
      );
      const rows = (
        (await list.json()) as { items: { id: string; version: number }[] }
      ).items;
      for (const row of rows) {
        const result = await hr.request.post(
          `/api/v1/recruit/interviews/${row.id}/status`,
          {
            headers: {
              "X-CSRF-Token": me.csrfToken,
              Origin: "http://127.0.0.1:5173",
            },
            data: {
              version: row.version,
              status: "cancelled",
              note: "Synthetic interview from an earlier test run",
            },
          },
        );
        expect(result.ok(), await result.text()).toBe(true);
      }
    });

    await test.step("a manager sees Recruitment but cannot list org units yet", async () => {
      await openRecruitment(neel.page);
      const tabs = neel.page.getByRole("tablist", {
        name: "Recruitment views",
      });
      await expect(tabs.getByRole("tab", { name: "Candidates" })).toHaveCount(
        0,
      );
      await expect(tabs.getByRole("tab", { name: "Offers" })).toHaveCount(0);
      await neel.page
        .getByRole("button", { name: "Raise requisition" })
        .click();
      await expect(
        neel.page.getByText("Department and location lists are not available"),
      ).toBeVisible();
      await neel.page
        .getByRole("button", { name: "Close", exact: true })
        .click();
    });

    await test.step("HR raises a requisition naming the manager, a second HR approves", async () => {
      await openRecruitment(hr);
      await accessible(hr);
      await hr.getByRole("button", { name: "Raise requisition" }).click();
      const form = hr.getByRole("dialog", { name: "Raise a requisition" });
      await form.getByLabel("Job title").fill(jobTitle);
      await pick(hr, form, /Department/, "Engineering");
      await pick(hr, form, /Location/, "Bengaluru");
      await person(form, "Hiring manager", "Neel Rao");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await hr.getByRole("button", { name: `Details: ${jobTitle}` }).click();
      const detail = hr.getByRole("dialog", { name: jobTitle });
      await detail.getByRole("button", { name: "Submit for approval" }).click();
      await expect(detail).toContainText("Waiting for approval");
      await shot(hr, "requisition-pending");
      await hr.keyboard.press("Escape");

      await openRecruitment(maya.page);
      await maya.page
        .getByRole("button", { name: `Details: ${jobTitle}` })
        .click();
      const decide = maya.page.getByRole("dialog", { name: jobTitle });
      await decide.getByRole("button", { name: "Approve" }).click();
      await expect(decide).toContainText("Approved");
      await decide
        .getByRole("button", { name: "Open for applications" })
        .click();
      await expect(decide).toContainText("Open");
      await maya.page.keyboard.press("Escape");
    });

    await test.step("the hiring manager follows the requisition", async () => {
      await openRecruitment(neel.page);
      await expect(
        neel.page.getByRole("button", { name: `Details: ${jobTitle}` }),
      ).toBeVisible();
      await shot(neel.page, "manager-requisitions");
    });

    await test.step("HR adds a candidate, contact details stay masked until revealed", async () => {
      await openRecruitment(hr, "Candidates");
      await hr.getByRole("button", { name: "Add candidate" }).click();
      const form = hr.getByRole("dialog", { name: "Add a candidate" });
      await form.getByLabel("Full name").fill(candidateName);
      await form.getByLabel("Email").fill(email);
      await form.getByLabel("Phone (optional)").fill("+91 98765 43210");
      await form.getByLabel("Current company (optional)").fill("Test Labs");
      await form.getByLabel("Experience (years)").fill("4");
      await form.getByLabel("Notes (optional)").fill(`Synthetic ${tag}`);
      await form
        .getByRole("checkbox", { name: /agreed to their details/ })
        .check({ force: true });
      await form.getByRole("button", { name: "Add candidate" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await hr.getByRole("textbox", { name: "Search" }).fill(tag);
      await hr
        .getByRole("button", { name: `Details: ${candidateName}` })
        .click();
      const detail = hr.getByRole("dialog", { name: candidateName });
      await expect(detail).not.toContainText(email);
      await accessible(hr);
      await shot(hr, "candidate-masked");
      await detail
        .getByRole("button", { name: "Reveal contact details" })
        .click();
      await expect(detail).toContainText(email);
      await expect(detail).toContainText("recorded in the activity log");
      await shot(hr, "candidate-revealed");
      await detail
        .getByRole("button", { name: "Add to a requisition" })
        .click();
      const apply = hr.getByRole("dialog", { name: "Add to a requisition" });
      await pick(hr, apply, /Requisition/, jobTitle);
      await apply.getByRole("button", { name: "Add application" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("the manager cannot reach candidate contact details", async () => {
      await neel.page.goto("/recruitment");
      await expect(
        neel.page.getByRole("tab", { name: "Candidates" }),
      ).toHaveCount(0);
      const response = await neel.page.request.get(
        "/api/v1/recruit/candidates",
      );
      expect(response.status()).toBe(403);
    });

    await test.step("HR moves the application and schedules an interview", async () => {
      await openRecruitment(hr, "Pipeline");
      await pick(hr, hr.locator("main"), /Requisition/, jobTitle);
      const applied = hr.getByRole("region", { name: /^Applied/ });
      await expect(applied).toContainText(candidateName);
      await hr
        .getByRole("button", { name: `Move ${candidateName} to another stage` })
        .click();
      const move = hr.getByRole("dialog", { name: "Move to another stage" });
      await pick(hr, move, /Move to/, "Interview");
      await move.getByRole("button", { name: "Move", exact: true }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await expect(
        hr.getByRole("region", { name: /^Interview/ }),
      ).toContainText(candidateName);
      await shot(hr, "pipeline");

      const schedule = async (round: string) => {
        await hr.getByRole("button", { name: "Schedule interview" }).click();
        const form = hr.getByRole("dialog", { name: "Schedule an interview" });
        await form.getByLabel("Round name").fill(round);
        const start = slotStart;
        const local = new Date(
          start.getTime() - start.getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16);
        await form.getByLabel("Date and time").fill(local);
        await pick(hr, form, /Duration/, "15 minutes");
        await person(form, "Interview panel", "Aarav Shah");
        await form
          .getByRole("button", { name: "Schedule", exact: true })
          .click();
        return form;
      };
      await schedule("Technical round");
      await expect(hr.getByRole("dialog")).toHaveCount(0);

      // The same panel at the same time is refused, and the reason is shown.
      const clash = await schedule("Second round");
      await expect(clash.getByRole("alert")).toBeVisible();
      await shot(hr, "interview-conflict");
      await clash.getByRole("button", { name: "Cancel" }).click();
    });

    await test.step("the interview starts", async () => {
      // A scorecard opens once the interview has started, so wait for the slot.
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, slotStart.getTime() - Date.now() + 3000),
        ),
      );
    });

    await test.step("the interviewer submits a blind scorecard", async () => {
      await openRecruitment(aarav.page);
      await expect(aarav.page.getByRole("tab")).toHaveCount(0);
      await aarav.page
        .getByRole("button", {
          name: `Details: ${candidateName}, Technical round`,
        })
        .click();
      const detail = aarav.page.getByRole("dialog", {
        name: new RegExp(candidateName),
      });
      await expect(detail).toContainText("Scorecards are blind");
      await accessible(aarav.page);
      await shot(aarav.page, "interviewer-blind");
      await detail.getByRole("button", { name: "Submit scorecard" }).click();
      const card = aarav.page.getByRole("dialog", {
        name: "Submit your scorecard",
      });
      await pick(aarav.page, card, /Skills/, "4");
      await pick(aarav.page, card, /Communication/, "5");
      await pick(aarav.page, card, /Recommendation/, "Strong yes");
      await card.getByRole("button", { name: "Submit scorecard" }).click();
      await expect(aarav.page.getByRole("dialog")).toHaveCount(0);
      await aarav.page
        .getByRole("button", {
          name: `Details: ${candidateName}, Technical round`,
        })
        .click();
      const after = aarav.page.getByRole("dialog", {
        name: new RegExp(candidateName),
      });
      await expect(after).toContainText("(you)");
      await expect(after).not.toContainText("Scorecards are blind");
      await shot(aarav.page, "interviewer-submitted");
    });

    await test.step("HR makes an offer; a different HR user approves it", async () => {
      await openRecruitment(hr, "Pipeline");
      await pick(hr, hr.locator("main"), /Requisition/, jobTitle);
      await hr.getByRole("button", { name: "Make offer" }).click();
      const form = hr.getByRole("dialog", { name: "Create an offer" });
      await pick(hr, form, /Application/, candidateName);
      const join = new Date(Date.now() + 30 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      await form.getByLabel("Proposed joining date").fill(join);
      await form.getByRole("button", { name: "New offer" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);

      await openRecruitment(hr, "Offers");
      await hr
        .getByRole("button", { name: `Details: ${candidateName}` })
        .click();
      const detail = hr.getByRole("dialog", { name: candidateName });
      await detail.getByRole("button", { name: "Submit for approval" }).click();
      await expect(detail).toContainText("Waiting for approval");
      // The creator is not offered the approve action.
      await expect(
        detail.getByRole("button", { name: "Approve", exact: true }),
      ).toHaveCount(0);
      await hr.keyboard.press("Escape");

      await openRecruitment(maya.page, "Offers");
      await maya.page
        .getByRole("button", { name: `Details: ${candidateName}` })
        .click();
      const approve = maya.page.getByRole("dialog", { name: candidateName });
      await approve
        .getByRole("button", { name: "Approve", exact: true })
        .click();
      await expect(approve).toContainText("Approved");
      await maya.page.keyboard.press("Escape");
    });

    await test.step("HR sends the offer and records the acceptance", async () => {
      await openRecruitment(hr, "Offers");
      await hr
        .getByRole("button", { name: `Details: ${candidateName}` })
        .click();
      const detail = hr.getByRole("dialog", { name: candidateName });
      await detail.getByRole("button", { name: "Record as sent" }).click();
      await expect(detail).toContainText("Sent");
      await detail.getByRole("button", { name: "Record acceptance" }).click();
      const accept = hr.getByRole("dialog", {
        name: "Record that the candidate accepted",
      });
      await expect(accept).toContainText("@anvi.example");
      await accept.getByLabel("Pre-boarding email address").fill(preboarding);
      await accept.getByRole("button", { name: "Record acceptance" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await expect(
        hr.getByRole("status").filter({ hasText: "pre-boarding" }),
      ).toBeVisible();
      await shot(hr, "offer-accepted");

      await openRecruitment(hr, "Pipeline");
      await pick(hr, hr.locator("main"), /Requisition/, jobTitle);
      await expect(hr.getByRole("region", { name: /^Hired/ })).toContainText(
        candidateName,
      );
    });

    await test.step("the funnel shows counts without personal data", async () => {
      await openRecruitment(hr, "Funnel");
      await pick(hr, hr.locator("main"), /Requisition/, jobTitle);
      await expect(hr.getByRole("img", { name: "Applied: 1" })).toBeVisible();
      await expect(hr.getByRole("img", { name: "Hired: 1" })).toBeVisible();
      await expect(hr.locator("main")).not.toContainText(candidateName);
      await accessible(hr);
      await shot(hr, "funnel");
    });

    await test.step("every tab is accessible in light and dark", async () => {
      for (const mode of ["light", "dark"]) {
        if (mode === "dark")
          await hr.getByRole("button", { name: "Use dark theme" }).click();
        for (const tab of [
          "Requisitions",
          "Candidates",
          "Pipeline",
          "Interviews",
          "Offers",
          "Funnel",
        ]) {
          await hr.getByRole("tab", { name: tab }).click();
          await expect(hr.getByRole("tabpanel")).toBeVisible();
          await hr.waitForTimeout(300);
          await accessible(hr);
        }
        await hr.getByRole("tab", { name: "Requisitions" }).click();
        await shot(hr, `requisitions-${mode}`);
      }
    });

    await test.step("phones never scroll sideways", async () => {
      await hr.setViewportSize({ width: 390, height: 844 });
      for (const tab of [
        "Requisitions",
        "Candidates",
        "Pipeline",
        "Interviews",
        "Offers",
        "Funnel",
      ]) {
        await hr.getByRole("tab", { name: tab }).click();
        await hr.waitForTimeout(300);
        const overflow = await hr.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(
          overflow,
          `${tab} overflows the phone width`,
        ).toBeLessThanOrEqual(0);
        await shot(hr, `phone-${tab.toLowerCase()}`);
      }
    });
  } finally {
    for (const context of contexts) await context.close();
  }
});
