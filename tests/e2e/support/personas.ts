import { expect, type Page } from "./test";

// Demo personas bound by `pnpm demo:personas` (also run by `pnpm db:seed`).
export const personas = {
  maya: {
    name: "Maya Iyer",
    role: "All roles",
    roles: [
      "HR admin",
      "Employee",
      "Team manager",
      "Platform admin",
      "Auditor",
    ],
  },
  employee: { name: "Aarav Shah", role: "Employee", roles: ["Employee"] },
  manager: { name: "Neel Rao", role: "Team manager", roles: ["Team manager"] },
  hr: { name: "Kabir Sethi", role: "HR admin", roles: ["HR admin"] },
  auditor: { name: "Diya Kapoor", role: "Auditor", roles: ["Auditor"] },
  platform: {
    name: "Ishaan Roy",
    role: "Platform admin",
    roles: ["Platform admin"],
  },
} as const;
export type PersonaKey = keyof typeof personas;

export async function loginAs(page: Page, persona: PersonaKey) {
  const { name, role } = personas[persona];
  if (!page.url().endsWith("/login")) await page.goto("/login");
  await page
    .getByRole("button", { name: `Sign in as ${name} (${role})` })
    .click();
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
}
