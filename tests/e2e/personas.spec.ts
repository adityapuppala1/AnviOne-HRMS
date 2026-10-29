import { test, expect } from "./support/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs, personas, type PersonaKey } from "./support/personas";

const cases: Record<
  PersonaKey,
  { shown: string[]; hidden: string[]; denied: [string, string] }
> = {
  maya: {
    shown: [
      "Organization",
      "Reports",
      "Exit",
      "Performance",
      "Helpdesk",
      "Recognition",
      "Learning",
      "Shifts",
    ],
    hidden: ["Activity log"],
    denied: ["/activity", "Activity history requires an assigned Auditor"],
  },
  employee: {
    shown: [
      "Leave",
      "Expenses",
      "My details",
      "Performance",
      "Helpdesk",
      "Recognition",
      "Learning",
      "Shifts",
    ],
    hidden: [
      "Reports",
      "Organization",
      "Approvals",
      "Activity log",
      "Configuration",
    ],
    denied: ["/reports", "Reports are not available to your role."],
  },
  manager: {
    shown: [
      "Team explorer",
      "Approvals",
      "Reports",
      "Performance",
      "Helpdesk",
      "Recognition",
      "Learning",
      "Shifts",
    ],
    hidden: [
      "Organization",
      "Candidate intake",
      "Activity log",
      "Configuration",
    ],
    denied: [
      "/organization",
      "Organization records require an assigned HR admin",
    ],
  },
  hr: {
    shown: [
      "Organization",
      "Reports",
      "Exit",
      "Candidate intake",
      "Performance",
      "Helpdesk",
      "Recognition",
      "Learning",
      "Shifts",
    ],
    hidden: ["Activity log", "Workspace settings"],
    denied: ["/activity", "Activity history requires an assigned Auditor"],
  },
  auditor: {
    shown: ["Activity log", "Configuration"],
    hidden: [
      "Reports",
      "People directory",
      "Leave",
      "Organization",
      "Performance",
      "Helpdesk",
      "Recognition",
      "Learning",
      "Shifts",
    ],
    denied: ["/reports", "Reports are not available to your role."],
  },
  platform: {
    shown: ["Configuration", "Workspace settings"],
    hidden: [
      "Reports",
      "People directory",
      "Activity log",
      "Leave",
      "Performance",
      "Helpdesk",
      "Recognition",
      "Learning",
      "Shifts",
    ],
    denied: [
      "/organization",
      "Organization records require an assigned HR admin",
    ],
  },
};

test("the sign-in screen lists every demo persona accessibly", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Explore demo workspace" }),
  ).toBeVisible();
  for (const { name, role } of Object.values(personas))
    await expect(
      page.getByRole("button", { name: `Sign in as ${name} (${role})` }),
    ).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
});

for (const [key, expected] of Object.entries(cases) as [
  PersonaKey,
  (typeof cases)[PersonaKey],
][])
  test(`${key} persona sees only its own workspace`, async ({ page }) => {
    await loginAs(page, key);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const label of expected.shown)
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    for (const label of expected.hidden)
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Switch workspace role", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Choose your workspace" });
    await expect(dialog.getByRole("button")).toHaveCount(
      personas[key].roles.length + 1,
    );
    for (const role of personas[key].roles)
      await expect(
        dialog.getByRole("button", { name: new RegExp(`^${role}`) }),
      ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(expected.denied[0]);
    await expect(page.getByText(expected.denied[1])).toBeVisible();
  });
