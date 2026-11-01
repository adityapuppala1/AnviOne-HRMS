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
import pg from "pg";
import { mkdirSync } from "node:fs";
import { loginAs, type PersonaKey } from "./support/personas";

// Behaviour under test: Learning (LRN-01) with an employee (Aarav), his manager (Neel) and HR
// (Kabir). HR creates and publishes courses and assigns one to Aarav; Aarav starts and completes it
// with a note; Neel sees it read-only under Team; HR waives a second, overdue assignment with a
// reason; Aarav sees the overdue badge before and the waiver after; HR assigns a course to
// themselves and gets the four-eyes message instead of record/waive buttons.
const evidence = "docs/acceptance-evidence/learning";

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

async function openLearning(page: Page, tab?: string) {
  await resetRateLimits();
  await page.goto("/learning");
  await expect(
    page.getByRole("heading", { name: "Learning", level: 1 }),
  ).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
}

async function as(browser: Browser, persona: PersonaKey) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await loginAs(page, persona);
  await page.goto("/learning");
  return { page, context };
}

async function openDetails(page: Page, title: string) {
  const card = page.getByRole("button", { name: `Details: ${title}` });
  await expect(card).toBeVisible();
  await card.click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail).toBeVisible();
  return detail;
}

async function closeDetail(page: Page) {
  // Focus may sit on a button that just disappeared, so press Escape on the panel itself.
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const inDays = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function adminPool() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* environment already set */
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url || !/@127\.0\.0\.1:55432\//.test(url))
    throw new Error("Needs the local Compose database");
  return new pg.Pool({ connectionString: url });
}

// Test-only: the product refuses past due dates, so move one back as the migrator.
async function backdate(tag: string, titlePrefix: string, days: number) {
  const pool = adminPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "ALTER TABLE lrn_assignment DISABLE TRIGGER lrn_assignment_guard_update",
    );
    await client.query(
      `UPDATE lrn_assignment SET due_on=CURRENT_DATE-$2::int
       WHERE course_id IN (SELECT id FROM lrn_course WHERE title=$1)`,
      [`${titlePrefix} ${tag}`, days],
    );
    await client.query(
      "ALTER TABLE lrn_assignment ENABLE ALWAYS TRIGGER lrn_assignment_guard_update",
    );
    await client.query("COMMIT");
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally {
    client.release();
    await pool.end();
  }
}

// Learning records are kept by design (triggers refuse deletes), so a run removes its own
// synthetic rows directly as the migrator, the same way tests/learn.integration.ts does.
async function cleanup(tag: string) {
  const pool = adminPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    const { rows: triggers } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE 'lrn\\_%'`,
    );
    for (const row of triggers)
      await client.query(`ALTER TABLE ${row.t} DISABLE TRIGGER ${row.name}`);
    const courses = (
      await client.query<{ id: string }>(
        "SELECT id FROM lrn_course WHERE title LIKE $1",
        [`% ${tag}`],
      )
    ).rows.map((r) => r.id);
    const assignments = (
      await client.query<{ id: string; b: string | null }>(
        "SELECT id, batch_id AS b FROM lrn_assignment WHERE course_id=ANY($1::uuid[])",
        [courses],
      )
    ).rows;
    const all = [
      ...courses,
      ...assignments.map((r) => r.id),
      ...assignments.flatMap((r) => (r.b ? [r.b] : [])),
    ];
    await client.query(
      "DELETE FROM outbox_event WHERE event_type LIKE 'learn.%' AND aggregate_id=ANY($1::uuid[])",
      [all],
    );
    await client.query(
      "DELETE FROM audit_event WHERE action LIKE 'learn.%' AND target=ANY($1::text[])",
      [
        [
          ...courses.map((i) => `lrn-course:${i}`),
          ...assignments.map((r) => `lrn-assignment:${r.id}`),
        ],
      ],
    );
    await client.query(
      "DELETE FROM lrn_completion WHERE course_id=ANY($1::uuid[])",
      [courses],
    );
    await client.query(
      "DELETE FROM lrn_assignment WHERE course_id=ANY($1::uuid[])",
      [courses],
    );
    await client.query("DELETE FROM lrn_course WHERE id=ANY($1::uuid[])", [
      courses,
    ]);
    for (const row of triggers)
      await client.query(
        `ALTER TABLE ${row.t} ENABLE ALWAYS TRIGGER ${row.name}`,
      );
    await client.query("COMMIT");
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally {
    client.release();
    await pool.end();
  }
}

async function createCourse(
  page: Page,
  tag: string,
  title: string,
  extra: { link?: string; validity?: string } = {},
) {
  await page.getByRole("button", { name: "New course" }).click();
  const form = page.getByRole("dialog", { name: "New course" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Category").fill("Safety");
  await form
    .getByRole("textbox", { name: "Description" })
    .fill(`How to work safely ${tag}`);
  if (extra.link) await form.getByLabel("External link").fill(extra.link);
  if (extra.validity)
    await form.getByLabel("Certification valid for").fill(extra.validity);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search" }).fill(title);
  await page
    .getByRole("button", { name: `Publish: ${title}` })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: `Assign: ${title}` }).first(),
  ).toBeVisible();
}

async function assignTo(
  page: Page,
  title: string,
  person: string,
  due: string,
) {
  await page.getByRole("textbox", { name: "Search" }).first().fill(title);
  await page
    .getByRole("button", { name: `Assign: ${title}` })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: "Assign this course" });
  await form.getByLabel("Find a person").fill(person.split(" ")[0]!);
  await pick(page, form, /Person/, `${person}`.replace(/ /g, " "));
  await form.getByLabel("Due date").fill(due);
  await form.getByRole("button", { name: "Assign course" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Assigned to 1 person. Skipped 0",
  );
  await form.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("learning runs from a published course to a completion, a waiver and four-eyes", async ({
  browser,
}) => {
  test.setTimeout(420000);
  mkdirSync(evidence, { recursive: true });
  const tag = Math.random().toString(36).slice(2, 7);
  const safety = `Safety basics ${tag}`;
  const ethics = `Ethics refresher ${tag}`;
  const optional = `Wellbeing talks ${tag}`;
  const completeNote = `Finished the module ${tag}`;
  const waiveReason = `Covered by prior certification ${tag}`;
  const shot = (page: Page, name: string) =>
    page.screenshot({ path: `${evidence}/${name}.png` });
  const contexts: BrowserContext[] = [];
  try {
    const kabir = await as(browser, "hr");
    const neel = await as(browser, "manager");
    const aarav = await as(browser, "employee");
    contexts.push(kabir.context, neel.context, aarav.context);
    const hr = kabir.page;

    await test.step("HR creates and publishes courses and sees the honest limits", async () => {
      await openLearning(hr, "Manage");
      await expect(
        hr.getByText(/no content player, quiz, attendance capture/i).first(),
      ).toBeVisible();
      await hr.getByRole("button", { name: "New course" }).click();
      const form = hr.getByRole("dialog", { name: "New course" });
      await form.getByLabel("External link").fill("http://insecure.test/x");
      await form.getByLabel("Title").fill(safety);
      await form.getByLabel("Category").fill("Safety");
      await accessible(hr);
      await shot(hr, "course-form");
      await form.getByRole("button", { name: "Cancel" }).click();
      await createCourse(hr, tag, safety, {
        link: "https://learn.example.com/safety",
        validity: "12",
      });
      await createCourse(hr, tag, ethics);
      await createCourse(hr, tag, optional);
      await hr.getByRole("textbox", { name: "Search" }).first().fill(tag);
      await shot(hr, "manage-courses");
    });

    await test.step("an employee sees published courses only and enrols in an optional one", async () => {
      const page = aarav.page;
      await openLearning(page, "Catalogue");
      await page.getByRole("textbox", { name: "Search" }).fill(tag);
      await expect(
        page.getByRole("button", { name: `Details: ${optional}` }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Draft/ })).toHaveCount(0);
      const detail = await openDetails(page, safety);
      await expect(detail).toContainText("Open learn.example.com");
      const link = detail.getByRole("link", { name: /learn\.example\.com/ });
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toHaveAttribute("target", "_blank");
      await closeDetail(page);
      const enrol = await openDetails(page, optional);
      await shot(page, "catalogue-detail");
      await enrol.getByRole("button", { name: "Enrol" }).click();
      await expect(page.getByRole("status")).toContainText(
        `You are enrolled in ${optional}`,
      );
    });

    await test.step("HR assigns the safety course to Aarav and the ethics course to Aarav", async () => {
      await openLearning(hr, "Manage");
      await assignTo(hr, safety, "Aarav Shah", inDays(14));
      await assignTo(hr, ethics, "Aarav Shah", inDays(14));
      await backdate(tag, "Ethics refresher", 3);
    });

    await test.step("Aarav sees the overdue badge, starts the course and completes it with a note", async () => {
      const page = aarav.page;
      await openLearning(page, "My learning");
      await shot(page, "my-learning-overdue");
      const late = await openDetails(page, ethics);
      await expect(late).toContainText("Overdue");
      await closeDetail(page);
      const detail = await openDetails(page, safety);
      await expect(detail).toContainText("Not started");
      await expect(detail).toContainText("Open learn.example.com");
      await detail.getByRole("button", { name: "Start course" }).click();
      await closeDetail(page);
      const started = await openDetails(page, safety);
      await expect(started).toContainText("In progress");
      await started.getByRole("button", { name: "Mark complete" }).click();
      const form = page.getByRole("dialog", {
        name: "Mark this course complete?",
      });
      await form.getByLabel(/Note \(optional/).fill(completeNote);
      await accessible(page);
      await shot(page, "complete-dialog");
      await form.getByRole("button", { name: "Mark complete" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const done = await openDetails(page, safety);
      await expect(done).toContainText("Completed");
      await expect(done).toContainText("Certification current");
      await expect(done).toContainText(completeNote);
      await shot(page, "my-learning-completed");
      await closeDetail(page);
    });

    await test.step("the manager sees the team assignment read-only", async () => {
      const page = neel.page;
      await openLearning(page, "Team");
      await expect(page.getByText(/Read only\. Direct reports/)).toBeVisible();
      const detail = await openDetails(page, safety);
      await expect(detail).toContainText("Aarav Shah");
      await expect(detail).toContainText("Completed");
      await expect(detail).toContainText(completeNote);
      await expect(
        detail.getByRole("button", {
          name: /Start course|Mark complete|Waive/,
        }),
      ).toHaveCount(0);
      await shot(page, "team-detail");
      await closeDetail(page);
      await expect(page.getByRole("tab", { name: "Manage" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Compliance" })).toHaveCount(
        0,
      );
    });

    await test.step("HR filters overdue assignments and waives one with a reason", async () => {
      await openLearning(hr, "Manage");
      const all = hr.locator("section.lrn-section").nth(1);
      await pick(hr, all, /Overdue/, "Overdue only");
      await pick(hr, all, /Course/, ethics);
      await shot(hr, "manage-assignments-overdue");
      const detail = await openDetails(hr, ethics);
      await expect(detail).toContainText("Aarav Shah");
      await detail.getByRole("button", { name: "Waive" }).click();
      const form = hr.getByRole("dialog", { name: "Waive this assignment?" });
      await expect(
        form.getByRole("button", { name: "Waive assignment" }),
      ).toBeDisabled();
      await form.getByLabel(/Reason \(required/).fill(waiveReason);
      await shot(hr, "waive-dialog");
      await form.getByRole("button", { name: "Waive assignment" }).click();
      await expect(hr.getByRole("dialog")).toHaveCount(0);
      // Waived assignments are no longer overdue.
      await expect(
        hr.getByRole("button", { name: `Details: ${ethics}` }),
      ).toHaveCount(0);
    });

    await test.step("the waiver and its reason show in Aarav's history", async () => {
      const page = aarav.page;
      await openLearning(page, "My learning");
      const detail = await openDetails(page, ethics);
      await expect(detail).toContainText("Waived");
      await expect(detail).toContainText(waiveReason);
      await expect(detail).not.toContainText("Overdue");
      await closeDetail(page);
    });

    await test.step("HR assigned to a course gets the four-eyes message, not record or waive", async () => {
      await openLearning(hr, "Manage");
      await assignTo(hr, safety, "Kabir Sethi", inDays(10));
      const all = hr.locator("section.lrn-section").nth(1);
      await pick(hr, all, /Course/, safety);
      await pick(hr, all, /Status/, "Not started");
      const detail = await openDetails(hr, safety);
      await expect(detail).toContainText("This is your own assignment");
      await expect(
        detail.getByRole("button", { name: /Record completion|Waive/ }),
      ).toHaveCount(0);
      await expect(
        detail.getByRole("button", { name: "Mark complete" }),
      ).toBeVisible();
      await shot(hr, "four-eyes");
      await closeDetail(hr);
    });

    await test.step("HR reads the compliance report as counts", async () => {
      await openLearning(hr, "Compliance");
      await expect(
        hr.getByText("No names or notes appear in this report."),
      ).toBeVisible();
      await expect(hr.getByText(safety).first()).toBeVisible();
      await shot(hr, "compliance");
    });

    await test.step("every tab is accessible in light and dark", async () => {
      const groups: [Page, string[]][] = [
        [hr, ["My learning", "Catalogue", "Manage", "Compliance"]],
        [neel.page, ["My learning", "Catalogue", "Team"]],
        [aarav.page, ["My learning", "Catalogue"]],
      ];
      for (const mode of ["light", "dark"]) {
        for (const [page, tabs] of groups) {
          await openLearning(page);
          if (mode === "dark")
            await page.getByRole("button", { name: "Use dark theme" }).click();
          for (const tab of tabs) {
            await page.getByRole("tab", { name: tab, exact: true }).click();
            await expect(page.getByRole("tabpanel")).toBeVisible();
            await page.waitForTimeout(400);
            await accessible(page);
          }
        }
        await openLearning(hr, "Compliance");
        await shot(hr, `compliance-${mode}`);
        await hr.getByRole("tab", { name: "Manage", exact: true }).click();
        await shot(hr, `manage-${mode}`);
      }
      await openLearning(aarav.page, "My learning");
      const detail = await openDetails(aarav.page, safety);
      await expect(detail).toContainText("Completed");
      await aarav.page.waitForTimeout(400);
      await accessible(aarav.page);
      await shot(aarav.page, "my-learning-dark");
      await closeDetail(aarav.page);
    });

    await test.step("phones never scroll sideways", async () => {
      for (const [page, tabs] of [
        [hr, ["My learning", "Catalogue", "Manage", "Compliance"]],
        [neel.page, ["Team"]],
        [aarav.page, ["My learning", "Catalogue"]],
      ] as [Page, string[]][]) {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const tab of tabs) {
          await page.getByRole("tab", { name: tab, exact: true }).click();
          await page.waitForTimeout(400);
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
    await cleanup(tag);
  }
});
