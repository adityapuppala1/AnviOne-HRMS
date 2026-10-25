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
  },
  manager: {
    "directory.read": "team",
    "onboarding.task.update": "self",
    "leave.request": "self",
    "leave.approve": "team",
  },
  hr_admin: {
    "directory.read": "entity",
    "leave.approve": "entity",
    "organization.read": "entity",
    "organization.write": "entity",
    "onboarding.manage": "entity",
  },
  platform_admin: { "branding.write": "entity" },
  auditor: { "audit.read": "entity" },
};
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
