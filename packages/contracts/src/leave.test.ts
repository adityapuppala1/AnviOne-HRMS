import { describe, it, expect } from "vitest";
import {
  leaveRequestCreateSchema,
  leaveDecisionSchema,
  leaveCancelSchema,
} from "./index";

const request = {
  leaveTypeId: "00000000-0000-4000-8000-000000000001",
  startDate: "2027-02-01",
  endDate: "2027-02-05",
  reason: "Family visit",
};
describe("leave contracts", () => {
  it("accepts a bounded request and keeps the requester out of the body", () => {
    expect(leaveRequestCreateSchema.safeParse(request).success).toBe(true);
    expect(
      leaveRequestCreateSchema.safeParse({
        ...request,
        employeeId: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });
  it("rejects reversed, cross-year, over-long and impossible ranges", () => {
    for (const dates of [
      { startDate: "2027-02-05", endDate: "2027-02-01" },
      { startDate: "2026-12-30", endDate: "2027-01-02" },
      { startDate: "2027-02-01", endDate: "2027-03-15" },
      { startDate: "2027-02-30", endDate: "2027-03-01" },
    ])
      expect(
        leaveRequestCreateSchema.safeParse({ ...request, ...dates }).success,
      ).toBe(false);
    expect(
      leaveRequestCreateSchema.safeParse({ ...request, reason: "  " }).success,
    ).toBe(false);
  });
  it("requires a note to decline and a positive version", () => {
    expect(
      leaveDecisionSchema.safeParse({
        version: 1,
        decision: "approve",
        note: null,
      }).success,
    ).toBe(true);
    expect(
      leaveDecisionSchema.safeParse({
        version: 1,
        decision: "reject",
        note: null,
      }).success,
    ).toBe(false);
    expect(
      leaveDecisionSchema.safeParse({
        version: 1,
        decision: "reject",
        note: "Team offsite that week",
      }).success,
    ).toBe(true);
    expect(leaveCancelSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});
