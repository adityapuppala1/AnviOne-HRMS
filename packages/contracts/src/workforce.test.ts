import { describe, it, expect } from "vitest";
import {
  leaveRequestCreateSchema,
  leaveDecisionSchema,
  leaveCancelSchema,
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceCorrectionCreateSchema,
  holidayCreateSchema,
  holidayUpdateSchema,
  workWeekUpdateSchema,
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

describe("attendance contracts", () => {
  it("never accepts client-chosen punch times", () => {
    expect(attendanceCheckInSchema.safeParse({}).success).toBe(true);
    expect(
      attendanceCheckInSchema.safeParse({ checkIn: "07:00" }).success,
    ).toBe(false);
    expect(
      attendanceCheckOutSchema.safeParse({ version: 1, checkOut: "23:00" })
        .success,
    ).toBe(false);
  });
  it("requires ordered, well-formed correction times", () => {
    const base = {
      workDate: "2026-10-20",
      checkIn: "09:00",
      checkOut: "17:30",
      reason: "Forgot to punch",
    };
    expect(attendanceCorrectionCreateSchema.safeParse(base).success).toBe(true);
    for (const change of [
      { checkOut: "08:00" },
      { checkIn: "9:00" },
      { checkOut: "24:00" },
      { workDate: "2026-02-30" },
      { employeeId: "00000000-0000-4000-8000-000000000002" },
    ])
      expect(
        attendanceCorrectionCreateSchema.safeParse({ ...base, ...change })
          .success,
      ).toBe(false);
  });
});

describe("calendar contracts", () => {
  const reason = "Office closed for the regional festival";
  it("accepts unique ISO weekdays and rejects empty or repeated sets", () => {
    expect(
      workWeekUpdateSchema.safeParse({
        days: [1, 2, 3, 4, 5],
        version: 1,
        reason,
      }).success,
    ).toBe(true);
    for (const days of [[], [1, 1], [0], [8], [1, 2, 3, 4, 5, 6, 7, 1]])
      expect(
        workWeekUpdateSchema.safeParse({ days, version: 1, reason }).success,
      ).toBe(false);
  });
  it("requires a real date, a bounded name and a reason for holidays", () => {
    const base = {
      date: "2026-11-09",
      name: "Diwali",
      locationId: null,
      reason,
    };
    expect(holidayCreateSchema.safeParse(base).success).toBe(true);
    for (const change of [
      { date: "2026-02-30" },
      { name: "D" },
      { reason: "short" },
      { locationId: "not-a-uuid" },
      { active: true },
    ])
      expect(
        holidayCreateSchema.safeParse({ ...base, ...change }).success,
      ).toBe(false);
    expect(
      holidayUpdateSchema.safeParse({
        name: "Diwali",
        active: false,
        version: 2,
        reason,
        date: "2026-11-10",
      }).success,
    ).toBe(false);
  });
});
