import {
  test,
  expect,
  request,
  resetRateLimits,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "./support/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { loginAs, type PersonaKey } from "./support/personas";

// Behaviour under test: Recognition and pulse surveys (ENG-01). Aarav thanks Neel for a value,
// Neel reacts, Kabir (HR) hides the post with a reason (it leaves the feed) and restores it. Kabir
// writes and publishes a survey; five different people answer (Aarav and Neel on screen, Maya,
// Kabir and a synthetic fifth colleague through the API, because only four demo personas can
// answer); results stay withheld while open, a second answer is refused, and after HR closes the
// survey the counts appear.
const evidence = "docs/acceptance-evidence/engage";
const origin = "http://127.0.0.1:5173";

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
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function openEngage(page: Page, tab?: string) {
  await resetRateLimits();
  await page.goto("/engage");
  await expect(
    page.getByRole("heading", { name: "Recognition", level: 1 }),
  ).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
}

async function as(browser: Browser, persona: PersonaKey) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await loginAs(page, persona);
  await page.goto("/engage");
  return { page, context };
}

// A signed-in API client for a demo persona.
async function apiAs(persona: string) {
  await resetRateLimits();
  const ctx = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const login = await ctx.post("/api/v1/auth/demo", { data: { persona } });
  expect(login.ok()).toBeTruthy();
  const me = (await (await ctx.get("/api/v1/me")).json()) as {
    csrfToken: string;
  };
  return { ctx, csrf: me.csrfToken };
}

type Client = { ctx: APIRequestContext; csrf: string };

// The demo seed binds only four people who may answer a survey. The fifth is Rohan (a seeded
// employee) given a synthetic sign-in and an eight-hour session straight in the local demo
// database, the same way `pnpm demo:personas` binds the others. Idempotent; left in place.
async function rohanClient(): Promise<Client> {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* environment already set */
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url || !/@127\.0\.0\.1:55432\//.test(url))
    throw new Error("Needs the local Compose database");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  try {
    const employee = "30000000-0000-4000-8000-000000000006";
    const binding = "40000000-0000-4000-8000-0000000000e6";
    await db.query(
      `INSERT INTO identity_binding(id,tenant_id,entity_id,employee_id,issuer,subject,active,roles)
       VALUES ($1,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',$2,
               'urn:anvione:local-demo','rohan-e2e-engage',true,ARRAY['employee'])
       ON CONFLICT (issuer,subject) DO UPDATE SET active=true`,
      [binding, employee],
    );
    await db.query(
      `INSERT INTO app_session(token_hash,actor_id,role,csrf_token,expires_at)
       VALUES ($1,$2,'employee',$3,now() + interval '2 hours')`,
      [createHash("sha256").update(token).digest("hex"), binding, csrf],
    );
  } finally {
    await db.end();
  }
  const ctx = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      Origin: origin,
      Cookie: `anvi_dev_session=${token}`,
    },
  });
  return { ctx, csrf };
}

async function surveyIdByTitle(client: Client, title: string) {
  const res = await client.ctx.get("/api/v1/engage/surveys?limit=50");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    items: { id: string; title: string }[];
  };
  const found = body.items.find((s) => s.title === title);
  expect(found, "survey is listed for this person").toBeTruthy();
  return found!.id;
}

async function answerViaApi(client: Client, title: string, rating: number) {
  const id = await surveyIdByTitle(client, title);
  const detail = (await (
    await client.ctx.get(`/api/v1/engage/surveys/${id}`)
  ).json()) as { questions: { id: string; kind: string }[] };
  const answers = detail.questions.flatMap((q): Record<string, unknown>[] =>
    q.kind === "rating"
      ? [{ questionId: q.id, rating }]
      : q.kind === "choice"
        ? [{ questionId: q.id, choice: rating === 3 ? 1 : 0 }]
        : [],
  );
  return client.ctx.post(`/api/v1/engage/surveys/${id}/responses`, {
    headers: { "X-CSRF-Token": client.csrf },
    data: { answers },
  });
}

async function openSurvey(page: Page, title: string) {
  await page.getByRole("button", { name: `Details: ${title}` }).click();
  const panel = page.getByRole("dialog", { name: title });
  await expect(panel).toBeVisible();
  return panel;
}

async function respondOnScreen(
  page: Page,
  title: string,
  rating: string,
  choice: string,
  written?: string,
) {
  await openEngage(page, "Surveys");
  const panel = await openSurvey(page, title);
  await panel.getByRole("button", { name: "Respond", exact: true }).click();
  const form = page.getByRole("dialog", { name: title });
  await expect(
    form.getByText(
      "Your answers are stored without your name; results show only when at least 5 people answered and the survey has closed.",
    ),
  ).toBeVisible();
  await form.getByRole("radio", { name: rating, exact: true }).check({
    force: true,
  });
  await form.getByRole("radio", { name: choice, exact: true }).check({
    force: true,
  });
  if (written)
    await form.getByRole("textbox", { name: /Your answer/ }).fill(written);
  await form.getByRole("button", { name: "Send my answers" }).click();
  await expect(form.getByText("Answers received")).toBeVisible();
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// Records are kept for good (database triggers refuse deletes), so this spec cannot remove its
// synthetic data. Every run uses a random tag. Each run leaves: one company value, one recognition
// post (hidden then restored), one closed survey with five answers, and per-run sessions. The
// synthetic Rohan sign-in (subject rohan-e2e-engage) stays bound in the demo database. Each person
// can give 10 posts a day, so very many reruns in one UTC day would hit the cap.
test("recognition and an anonymous pulse survey run end to end", async ({
  browser,
}) => {
  test.setTimeout(480000);
  mkdirSync(evidence, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 7);
  const valueName = `Grit ${tag}`;
  const valueRenamed = `Grit and grace ${tag}`;
  const message = `Thank you for staying late to fix the release ${tag}`;
  const title = `Pulse ${tag}`;
  const written = `Great team ${tag}`;
  const shot = (page: Page, name: string) =>
    page.screenshot({ path: `${evidence}/${name}.png` });
  const contexts: BrowserContext[] = [];
  const clients: Client[] = [];
  const card = (page: Page) =>
    page.getByRole("article").filter({ hasText: tag });
  try {
    const kabir = await as(browser, "hr");
    const neel = await as(browser, "manager");
    const aarav = await as(browser, "employee");
    contexts.push(kabir.context, neel.context, aarav.context);
    const hr = kabir.page;

    await test.step("HR adds and renames a company value", async () => {
      await openEngage(hr, "Manage");
      await hr.getByRole("button", { name: "Add a value" }).click();
      const form = hr.getByRole("dialog", { name: "New value" });
      await form.getByLabel("Value name").fill(valueName);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await expect(hr.getByText(valueName, { exact: true })).toBeVisible();
      await hr
        .getByRole("button", { name: `Edit value: ${valueName}` })
        .click();
      const edit = hr.getByRole("dialog", { name: "Edit value" });
      await edit.getByLabel("Value name").fill(valueRenamed);
      await edit.getByRole("button", { name: "Save" }).click();
      await expect(hr.getByText(valueRenamed, { exact: true })).toBeVisible();
      await shot(hr, "manage-values");
    });

    await test.step("the employee gives recognition", async () => {
      const page = aarav.page;
      await openEngage(page);
      await expect(page.getByRole("tab", { name: "Manage" })).toHaveCount(0);
      await expect(
        page.getByText(/\d+ of 10 given today/).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Give recognition" }).click();
      const form = page.getByRole("dialog", { name: "Give recognition" });
      await form.getByRole("textbox", { name: /Colleague/ }).fill("Neel");
      await form.getByRole("button", { name: "Neel Rao" }).click();
      await pick(page, form, /Company value/, valueRenamed);
      await form.getByLabel("Message").fill(message);
      await expect(form.getByText("/280")).toBeVisible();
      await shot(page, "give-dialog");
      await form.getByRole("button", { name: "Post recognition" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(card(page)).toBeVisible();
      await expect(card(page)).toContainText("Aarav Shah");
      await expect(card(page)).toContainText("Neel Rao");
      await expect(card(page)).toContainText(valueRenamed);
      await expect(card(page)).toContainText(message);
      await shot(page, "feed");
    });

    await test.step("the colleague reacts, once", async () => {
      const page = neel.page;
      await openEngage(page);
      const post = card(page);
      await expect(post).toBeVisible();
      await expect(post).toContainText("For you");
      await post.getByRole("button", { name: /^Applause/ }).click();
      await expect(
        post.getByRole("button", { name: /^Applause/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        post.getByRole("button", { name: /^Applause/ }),
      ).toContainText("1");
      // Choosing another code swaps the reaction (one per person).
      await post.getByRole("button", { name: /^Thanks/ }).click();
      await expect(
        post.getByRole("button", { name: /^Thanks/ }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        post.getByRole("button", { name: /^Applause/ }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("tab", { name: "Mine", exact: true }).click();
      await expect(card(page)).toBeVisible();
    });

    await test.step("HR hides the post with a reason and it leaves the feed", async () => {
      await openEngage(hr);
      await card(hr).getByRole("button", { name: "Hide post" }).click();
      const form = hr.getByRole("dialog", { name: "Hide this post" });
      await expect(
        form.getByRole("button", { name: "Hide post" }),
      ).toBeDisabled();
      await form.getByLabel("Reason").fill(`Contains a customer name ${tag}`);
      await form.getByRole("button", { name: "Hide post" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await expect(card(hr)).toHaveCount(0);
      await openEngage(aarav.page);
      await expect(card(aarav.page)).toHaveCount(0);
      await openEngage(neel.page);
      await expect(card(neel.page)).toHaveCount(0);
    });

    await test.step("HR restores it from the hidden list", async () => {
      await openEngage(hr, "Manage");
      await expect(card(hr)).toBeVisible();
      await shot(hr, "manage-hidden");
      await card(hr).getByRole("button", { name: "Restore post" }).click();
      const form = hr.getByRole("dialog", { name: "Restore this post" });
      await expect(
        form.getByText(`Contains a customer name ${tag}`),
      ).toBeVisible();
      await form.getByLabel("Reason").fill(`Name removed from context ${tag}`);
      await form.getByRole("button", { name: "Restore post" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      await expect(card(hr)).toHaveCount(0);
      await openEngage(hr);
      await expect(card(hr)).toBeVisible();
      await openEngage(aarav.page);
      await expect(card(aarav.page)).toBeVisible();
    });

    await test.step("HR writes and publishes a survey", async () => {
      await openEngage(hr, "Surveys");
      await hr.getByRole("button", { name: "New survey" }).click();
      const form = hr.getByRole("dialog", { name: "New survey" });
      await form.getByLabel("Survey title").fill(title);
      await form
        .getByRole("textbox", { name: /Question text \(Question 1\)/ })
        .fill(`How was your week ${tag}`);
      await form.getByRole("button", { name: "Add a question" }).click();
      const q2 = form.getByRole("group", { name: "Question 2" });
      await pick(hr, q2, /Type/, "Single choice");
      await q2
        .getByRole("textbox", { name: /Question text/ })
        .fill(`Which part helped most ${tag}`);
      await q2
        .getByRole("textbox", { name: /Options/ })
        .fill("Teamwork\nTools");
      await form.getByRole("button", { name: "Add a question" }).click();
      const q3 = form.getByRole("group", { name: "Question 3" });
      await pick(hr, q3, /Type/, "Short text");
      await q3
        .getByRole("textbox", { name: /Question text/ })
        .fill(`Anything to add ${tag}`);
      await shot(hr, "survey-editor");
      await form.getByRole("button", { name: "Save draft" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const panel = await openSurvey(hr, title);
      await expect(panel).toContainText("Draft");
      await panel.getByRole("button", { name: "Publish", exact: true }).click();
      const confirm = hr.getByRole("dialog", { name: "Publish this survey" });
      await confirm.getByRole("button", { name: "Publish survey" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      const open = await openSurvey(hr, title);
      await expect(open).toContainText("Open");
      await hr.keyboard.press("Escape");
    });

    await test.step("results are withheld while the survey is open", async () => {
      const panel = await openSurvey(hr, title);
      await panel.getByRole("button", { name: "Results", exact: true }).click();
      const results = hr.getByRole("dialog", { name: `Results: ${title}` });
      await expect(
        results.getByText(/Results are withheld: the survey is still open/),
      ).toBeVisible();
      await shot(hr, "results-withheld-open");
      await results.getByRole("button", { name: "Close", exact: true }).click();
    });

    await test.step("two people answer on screen and cannot answer twice", async () => {
      await respondOnScreen(aarav.page, title, "4", "Teamwork", written);
      const page = aarav.page;
      await openEngage(page, "Surveys");
      const panel = await openSurvey(page, title);
      await expect(panel).toContainText("You responded");
      await expect(
        panel.getByRole("button", { name: "Respond", exact: true }),
      ).toHaveCount(0);
      await shot(page, "survey-responded");
      await respondOnScreen(neel.page, title, "5", "Teamwork");
    });

    await test.step("three more answer through the API; a second answer is refused", async () => {
      const maya = await apiAs("maya");
      const kabirApi = await apiAs("hr");
      const rohan = await rohanClient();
      clients.push(maya, kabirApi, rohan);
      expect((await answerViaApi(maya, title, 4)).ok()).toBeTruthy();
      expect((await answerViaApi(kabirApi, title, 3)).ok()).toBeTruthy();
      expect((await answerViaApi(rohan, title, 4)).ok()).toBeTruthy();
      const again = await answerViaApi(maya, title, 4);
      expect(again.ok()).toBeFalsy();
      expect([400, 403, 404, 409]).toContain(again.status());
    });

    await test.step("results stay withheld until HR closes the survey", async () => {
      await openEngage(hr, "Surveys");
      let panel = await openSurvey(hr, title);
      await expect(panel).toContainText("5 of");
      await panel.getByRole("button", { name: "Results", exact: true }).click();
      const withheld = hr.getByRole("dialog", { name: `Results: ${title}` });
      await expect(
        withheld.getByText(/Results are withheld: the survey is still open/),
      ).toBeVisible();
      await withheld
        .getByRole("button", { name: "Close", exact: true })
        .click();
      panel = await openSurvey(hr, title);
      await panel
        .getByRole("button", { name: "Close survey", exact: true })
        .click();
      const confirm = hr.getByRole("dialog", { name: "Close this survey" });
      await confirm.getByRole("button", { name: "Close survey" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("HR sees counts, averages and shuffled text once closed", async () => {
      const panel = await openSurvey(hr, title);
      await expect(panel).toContainText("Closed");
      await panel.getByRole("button", { name: "Results", exact: true }).click();
      const results = hr.getByRole("dialog", { name: `Results: ${title}` });
      await expect(
        results.getByText(/5 of \d+ eligible people answered/),
      ).toBeVisible();
      await expect(
        results.getByText("Results are released.", { exact: false }),
      ).toBeVisible();
      await expect(results.getByText("Average 4.0 out of 5")).toBeVisible();
      await expect(results.getByText("Score 4: 3 of 5")).toBeVisible();
      await expect(results.getByText("Score 5: 1 of 5")).toBeVisible();
      await expect(results.getByText("Teamwork: 4 of 5")).toBeVisible();
      await expect(results.getByText("Tools: 1 of 5")).toBeVisible();
      await expect(results.getByText(written)).toBeVisible();
      await accessible(hr);
      await shot(hr, "results-released");
      await results.getByRole("button", { name: "Close", exact: true }).click();
      // Closed: nobody can answer any more.
      await openEngage(aarav.page, "Surveys");
      const mine = await openSurvey(aarav.page, title);
      await expect(mine).toContainText("You responded");
      await aarav.page.keyboard.press("Escape");
    });

    await test.step("every tab is accessible in light and dark", async () => {
      const groups: [Page, string[]][] = [
        [hr, ["Feed", "Mine", "Surveys", "Manage"]],
        [neel.page, ["Feed", "Mine", "Surveys"]],
        [aarav.page, ["Feed", "Mine", "Surveys"]],
      ];
      for (const mode of ["light", "dark"]) {
        for (const [page, tabs] of groups) {
          await openEngage(page);
          if (mode === "dark")
            await page.getByRole("button", { name: "Use dark theme" }).click();
          for (const tab of tabs) {
            await resetRateLimits();
            await page.getByRole("tab", { name: tab, exact: true }).click();
            await expect(page.getByRole("tabpanel")).toBeVisible();
            await page.waitForTimeout(700);
            await accessible(page);
          }
        }
        await openEngage(hr, "Feed");
        await hr.waitForTimeout(700);
        await shot(hr, `feed-${mode}`);
        await hr.getByRole("tab", { name: "Surveys", exact: true }).click();
        await hr.waitForTimeout(500);
        await shot(hr, `surveys-${mode}`);
      }
      // The respond dialog and the give dialog, in dark mode.
      await openEngage(aarav.page);
      await aarav.page
        .getByRole("button", { name: "Give recognition" })
        .click();
      await aarav.page.waitForTimeout(500);
      await accessible(aarav.page);
      await shot(aarav.page, "give-dialog-dark");
      await aarav.page.keyboard.press("Escape");
    });

    await test.step("phones never scroll sideways", async () => {
      for (const [page, tabs] of [
        [hr, ["Feed", "Mine", "Surveys", "Manage"]],
        [aarav.page, ["Feed", "Mine", "Surveys"]],
      ] as [Page, string[]][]) {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const tab of tabs) {
          await page.getByRole("tab", { name: tab, exact: true }).click();
          await page.waitForTimeout(500);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(
            overflow,
            `${tab} overflows the phone width`,
          ).toBeLessThanOrEqual(0);
          await shot(page, `phone-${tab.toLowerCase()}`);
        }
      }
    });
  } finally {
    for (const client of clients) await client.ctx.dispose();
    for (const context of contexts) await context.close();
  }
});
