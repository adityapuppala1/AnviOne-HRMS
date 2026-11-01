// Text for the Today panel on the home screen, kept here so it can be translated.
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

export const todayCopy = {
  title: "Today",
  attendance: {
    label: "Attendance",
    none: "You haven't checked in yet",
    noneHint: "Your day starts when you do.",
    checkIn: "Check in",
    checkOut: "Check out",
    saving: "Saving…",
    working: (time: string) => `Checked in at ${time}`,
    soFar: (worked: string) => `${worked} so far`,
    done: "Day complete",
    range: (from: string, to: string) => `${from} to ${to}`,
    worked: (worked: string) => `${worked} worked`,
    leave: "You're on leave today",
    holiday: "It's a holiday today",
    weekend: "Enjoy your day off",
    rest: "Nothing to record today.",
    open: "Open attendance",
    failed: "That could not be saved. Try again.",
  },
  leave: {
    label: "Leave",
    available: "days available",
    none: "No limited leave types to show.",
    request: "Request leave",
    pending: (count: number) => `${count} awaiting a decision`,
    left: (available: number, total: number) => `${available} of ${total}`,
  },
  holiday: {
    label: "Next holiday",
    none: "No more holidays this year.",
    open: "See the calendar",
    when: (date: string, days: number) =>
      `${day(date)} · ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`,
  },
  policies: {
    label: "Policies",
    waiting: (count: number) =>
      `${count} ${count === 1 ? "policy needs" : "policies need"} your acknowledgement`,
    hint: "Read each one and confirm you have understood it.",
    upToDate: "You're up to date with every policy.",
    open: "Open policies",
  },
  equipment: {
    label: "Equipment",
    waiting: (count: number) =>
      `${count} ${count === 1 ? "item" : "items"} to confirm`,
    hint: "HR issued equipment to you. Confirm that you have it.",
    open: "Confirm equipment",
  },
  decisions: {
    label: "Waiting for you",
    none: "You're all caught up.",
    count: (count: number) =>
      `${count} ${count === 1 ? "decision" : "decisions"}`,
    hint: "Leave, corrections, documents and reviews",
    open: "Open approvals",
  },
};
