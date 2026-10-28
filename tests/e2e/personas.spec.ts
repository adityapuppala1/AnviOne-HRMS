import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "redis";
import { loginAs, personas, type PersonaKey } from "./support/personas";

// Six sign-ins plus their config reads would spend most of the per-minute auth
// budget, so clear the local rate-limit counters first (local Valkey only).
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
// Before and after, so the specs that follow keep their own budget too.
test.beforeAll(resetRateLimits);
test.afterAll(resetRateLimits);

const cases: Record<
  PersonaKey,
  { shown: string[]; hidden: string[]; denied: [string, string] }
> = {
  maya: {
    shown: ["Organization", "Reports", "Exit"],
    hidden: ["Activity log"],
    denied: ["/activity", "Activity history requires an assigned Auditor"],
  },
  employee: {
    shown: ["Leave", "Expenses", "My details"],
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
    shown: ["Team explorer", "Approvals", "Reports"],
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
    shown: ["Organization", "Reports", "Exit", "Candidate intake"],
    hidden: ["Activity log", "Workspace settings"],
    denied: ["/activity", "Activity history requires an assigned Auditor"],
  },
  auditor: {
    shown: ["Activity log", "Configuration"],
    hidden: ["Reports", "People directory", "Leave", "Organization"],
    denied: ["/reports", "Reports are not available to your role."],
  },
  platform: {
    shown: ["Configuration", "Workspace settings"],
    hidden: ["Reports", "People directory", "Activity log", "Leave"],
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
