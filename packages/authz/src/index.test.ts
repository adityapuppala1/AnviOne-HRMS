import { describe, expect, it } from "vitest";
import { scopeFor, canSwitch, permissionsFor, type Principal } from "./index";
const actor: Principal = {
  actorId: "actor",
  employeeId: "employee",
  tenantId: "tenant",
  entityId: "entity",
  role: "hr_admin",
  roles: ["hr_admin", "employee"],
  name: "Synthetic",
};
describe("deny-by-default role contexts", () => {
  it("reduces scope after a role switch", () => {
    expect(scopeFor(actor, "directory.read")).toBe("entity");
    expect(scopeFor({ ...actor, role: "employee" }, "directory.read")).toBe(
      "self",
    );
  });
  it("rejects roles not granted to the actor", () => {
    expect(canSwitch(actor, "platform_admin")).toBe(false);
    expect(permissionsFor({ ...actor, role: "platform_admin" })).toEqual([]);
  });
  it("configuration authority does not expose employee records or audit", () => {
    const admin = {
      ...actor,
      role: "platform_admin" as const,
      roles: ["platform_admin" as const],
    };
    expect(permissionsFor(admin)).toEqual(["branding.write"]);
  });
  it("keeps auditors read-only", () => {
    expect(
      permissionsFor({ ...actor, role: "auditor", roles: ["auditor"] }),
    ).toEqual(["audit.read"]);
  });
  it("limits organization maintenance to an assigned HR context", () => {
    expect(scopeFor(actor, "organization.write")).toBe("entity");
    for (const role of [
      "employee",
      "manager",
      "platform_admin",
      "auditor",
    ] as const) {
      const other = { ...actor, role, roles: [role] };
      expect(scopeFor(other, "organization.read")).toBeUndefined();
      expect(scopeFor(other, "organization.write")).toBeUndefined();
    }
    expect(
      scopeFor({ ...actor, roles: ["employee"] }, "organization.write"),
    ).toBeUndefined();
  });
  it("shows workforce insights to managers (team) and HR (organization) only", () => {
    expect(scopeFor(actor, "insights.read")).toBe("entity");
    expect(
      scopeFor(
        { ...actor, role: "manager", roles: ["manager"] },
        "insights.read",
      ),
    ).toBe("team");
    for (const role of ["employee", "platform_admin", "auditor"] as const)
      expect(
        scopeFor({ ...actor, role, roles: [role] }, "insights.read"),
      ).toBeUndefined();
  });
  it("grants only self-scoped onboarding work to employee contexts", () => {
    for (const role of ["employee", "manager"] as const)
      expect(
        scopeFor({ ...actor, role, roles: [role] }, "onboarding.task.update"),
      ).toBe("self");
    expect(scopeFor(actor, "onboarding.task.update")).toBeUndefined();
    expect(
      scopeFor(
        { ...actor, role: "auditor", roles: ["auditor"] },
        "onboarding.task.update",
      ),
    ).toBeUndefined();
  });
});
