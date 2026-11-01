import { z } from "zod";
import type { Role } from "@anvi/contracts";

// Synthetic sign-in personas for demo mode only. Each one is an identity binding
// on an employee the demo seed already creates; `pnpm demo:personas` writes them.
// Maya keeps every role so the role switcher can still be explored in one session.
export const DEMO_ISSUER = "urn:anvione:local-demo";
export const demoPersonaKeys = [
  "maya",
  "employee",
  "manager",
  "hr",
  "auditor",
  "platform",
] as const;
export const demoPersonaKeySchema = z.enum(demoPersonaKeys);
export type DemoPersonaKey = z.infer<typeof demoPersonaKeySchema>;
export interface DemoPersona {
  key: DemoPersonaKey;
  subject: string;
  // Seeded employee number: 30000000-0000-4000-8000-<number padded to 12>.
  employee: number;
  // The seeded name, checked by the persona script before it binds anything.
  name: string;
  title: string;
  roles: Role[];
  summary: string;
}
export const demoPersonas: readonly DemoPersona[] = [
  {
    key: "maya",
    subject: "maya-demo",
    employee: 1,
    name: "Maya Iyer",
    title: "People experience lead",
    roles: ["hr_admin", "employee", "manager", "platform_admin", "auditor"],
    summary: "Holds every role. Use the avatar menu to switch between them.",
  },
  {
    key: "employee",
    subject: "aarav-demo",
    employee: 10,
    name: "Aarav Shah",
    title: "Customer success lead",
    roles: ["employee"],
    summary: "Self-service only: leave, attendance, documents and expenses.",
  },
  {
    key: "manager",
    subject: "neel-demo",
    employee: 4,
    name: "Neel Rao",
    title: "Engineering manager",
    roles: ["manager"],
    summary: "Leads a team of eight. Approves their leave, time and expenses.",
  },
  {
    key: "hr",
    subject: "kabir-demo",
    employee: 12,
    name: "Kabir Sethi",
    title: "Workplace coordinator",
    roles: ["hr_admin"],
    summary:
      "A second HR admin, so two-person approval rules can be tried with Maya.",
  },
  {
    key: "auditor",
    subject: "diya-demo",
    employee: 9,
    name: "Diya Kapoor",
    title: "Finance analyst",
    roles: ["auditor"],
    summary: "Read-only: the activity log and the permission matrix.",
  },
  {
    key: "platform",
    subject: "ishaan-demo",
    employee: 8,
    name: "Ishaan Roy",
    title: "Platform engineer",
    roles: ["platform_admin"],
    summary: "Workspace branding and configuration, without people data.",
  },
];
export const demoEmployeeId = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const demoBindingId = (n: number) =>
  `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
