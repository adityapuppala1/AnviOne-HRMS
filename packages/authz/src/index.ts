import { permissionSchema, type Role } from "@anvi/contracts";
export type { Permission } from "@anvi/contracts";
import type { Permission } from "@anvi/contracts";

export type Scope = "self" | "team" | "entity";
export interface Principal {
  actorId: string;
  employeeId: string;
  tenantId: string;
  entityId: string;
  role: Role;
  roles: Role[];
  name: string;
}
const policy: Record<Role, Partial<Record<Permission, Scope>>> = {
  employee: {
    "directory.read": "self",
    "onboarding.task.update": "self",
    "leave.request": "self",
    "attendance.self": "self",
    "document.self": "self",
    "asset.self": "self",
    "policy.self": "self",
    "exit.self": "self",
    "expense.self": "self",
    "profile.self": "self",
  },
  manager: {
    "directory.read": "team",
    "onboarding.task.update": "self",
    "leave.request": "self",
    "leave.approve": "team",
    "attendance.self": "self",
    "attendance.review": "team",
    "document.self": "self",
    "asset.self": "self",
    "policy.self": "self",
    "exit.self": "self",
    "expense.self": "self",
    "expense.approve": "team",
    "insights.read": "team",
    "profile.self": "self",
    // Managers report on their team on screen only; exporting is HR's.
    "report.run": "team",
  },
  hr_admin: {
    "directory.read": "entity",
    "leave.approve": "entity",
    "attendance.review": "entity",
    "document.review": "entity",
    "organization.read": "entity",
    "organization.write": "entity",
    "onboarding.manage": "entity",
    "insights.read": "entity",
    "asset.manage": "entity",
    "policy.manage": "entity",
    "exit.manage": "entity",
    "expense.approve": "entity",
    "expense.manage": "entity",
    "profile.review": "entity",
    "report.run": "entity",
    "report.export": "entity",
  },
  platform_admin: { "branding.write": "entity", "admin.read": "entity" },
  auditor: { "audit.read": "entity", "admin.read": "entity" },
};
export const permissionDescriptions: Record<Permission, string> = {
  "directory.read": "Read the people directory",
  "branding.write":
    "Publish, review history of and roll back workspace branding",
  "audit.read": "Read the latest entity audit events",
  "organization.read": "Read organization units and masters",
  "organization.write": "Create, change and merge organization units",
  "onboarding.manage": "Manage candidates and onboarding checklists",
  "onboarding.task.update": "Update onboarding tasks assigned to me",
  "leave.request": "Request and cancel my own leave",
  "leave.approve": "Approve or reject leave",
  "attendance.self": "Check in, check out and request corrections",
  "attendance.review": "Review attendance and correction requests",
  "document.self": "Upload and read my own documents",
  "document.review": "Verify or reject employee documents",
  "insights.read": "Read workforce insights",
  "asset.manage": "Register, issue and return assets",
  "asset.self": "Read and acknowledge my own assets",
  "policy.manage": "Draft, publish and withdraw policies",
  "policy.self": "Read and acknowledge policies",
  "exit.manage": "Process resignations and exit clearance",
  "exit.self": "Submit and withdraw my own resignation",
  "expense.self": "Submit and cancel my own expense claims",
  "expense.approve": "Approve or reject expense claims",
  "expense.manage": "Mark claims paid and manage expense categories",
  "profile.self": "Read and request changes to my own profile",
  "profile.review": "Review profile change requests",
  "report.run": "Run reports on screen",
  "report.export": "Export reports as audited CSV",
  "admin.read": "Read the permission matrix and integration readiness",
};
// The role x permission table as shipped in code: changes need a reviewed deploy.
export function permissionMatrix() {
  return permissionSchema.options.map((permission) => ({
    permission,
    description: permissionDescriptions[permission],
    grants: (Object.keys(policy) as Role[]).flatMap((role) => {
      const scope = policy[role][permission];
      return scope ? [{ role, scope }] : [];
    }),
  }));
}
export function scopeFor(
  actor: Principal,
  permission: Permission,
): Scope | undefined {
  if (!actor.roles.includes(actor.role)) return undefined;
  return policy[actor.role][permission];
}
export function permissionsFor(actor: Principal): Permission[] {
  return permissionSchema.options.filter((p) => scopeFor(actor, p));
}
export function canSwitch(actor: Principal, role: Role): boolean {
  return actor.roles.includes(role);
}
