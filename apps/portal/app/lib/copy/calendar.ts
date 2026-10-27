// User-visible text for the calendar screen.
export const calendarCopy = {
  weekdays: [
    [1, "Mon", "Monday"],
    [2, "Tue", "Tuesday"],
    [3, "Wed", "Wednesday"],
    [4, "Thu", "Thursday"],
    [5, "Fri", "Friday"],
    [6, "Sat", "Saturday"],
    [7, "Sun", "Sunday"],
  ] as const,
  year: {
    title: (year: number) => `Holidays in ${year}`,
    summary: (observed: number) =>
      `${observed} observed. Holidays for one office apply only to people based there.`,
    show: (year: number) => `Show ${year}`,
    add: "Add holiday",
    none: "No holidays",
    wholeOrganization: "Whole organization",
    notObserved: ", not observed",
    edit: (name: string) => `Edit ${name}`,
  },
  hero: {
    today: "Today",
    tomorrow: "Tomorrow",
    inDays: (wait: number) => `In ${wait} days`,
    nothing: "Nothing scheduled",
    noneAhead: "No holidays ahead yet.",
    detail: (date: string, locationName: string | null) =>
      `${date}${locationName ? `, ${locationName} office` : ", whole organization"}.`,
    empty:
      "HR adds holidays here; they show up in leave and attendance automatically.",
  },
  stats: {
    observed: "Observed holidays",
    observedHint: (year: number) => `Days off in ${year}`,
    next: "Next holiday",
    nextHint: (name: string) => name,
    nextNone: "None scheduled",
    days: "days",
    workingDays: "Working days",
    workingDaysSuffix: "per week",
    workingDaysHint: "Leave counts only these days",
  },
  week: {
    title: "Working week",
    manageHint:
      "Leave and attendance count only these days. Changes apply to new requests.",
    viewHint: "The days your organization works. Leave counts only these days.",
    groupLabel: "Working days",
    dayState: (long: string, on: boolean) =>
      `${long}: ${on ? "working day" : "day off"}`,
    reasonLabel: "Why are you changing the working week?",
    discard: "Discard",
    saving: "Saving…",
    save: "Save working week",
  },
  dialog: {
    editTitle: "Edit holiday",
    addTitle: "Add a holiday",
    fixedNote: (date: string, locationName: string | null) =>
      `${date}, ${locationName ?? "whole organization"}. The date and office stay fixed; add a new holiday to move it.`,
    date: "Date",
    appliesTo: "Applies to",
    wholeOrganization: "Whole organization",
    office: (name: string) => `${name} office`,
    name: "Name",
    observed: "Observed this year",
    reason: "Reason for this change",
    cancel: "Cancel",
    saving: "Saving…",
    saveHoliday: "Save holiday",
    addHoliday: "Add holiday",
    notObservedBadge: "Not observed: it will not reduce leave or attendance.",
  },
  errors: {
    save: "Could not save.",
  },
};
