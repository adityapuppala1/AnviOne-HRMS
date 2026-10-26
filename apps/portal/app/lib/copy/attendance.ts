// All user-visible text for the attendance screen, kept in one place so it
// can be translated later.
export const attendanceCopy = {
  dayLabels: {
    present: "Present",
    in_progress: "Checked in",
    incomplete: "Missing check-out",
    leave: "On leave",
    weekend: "Non-working day",
    holiday: "Holiday",
    unaccounted: "Unaccounted (provisional LOP)",
    not_started: "Not checked in yet",
  },
  presenceLabels: {
    in: "In now",
    done: "Day complete",
    leave: "On leave",
    not_in: "Not in yet",
    weekend: "Non-working day",
    holiday: "Holiday",
  },
  correctionLabels: {
    pending: "Awaiting decision",
    approved: "Approved",
    rejected: "Declined",
    cancelled: "Cancelled",
  },
  noAccess:
    "Attendance is available in employee, manager and HR workspaces. Switch role to continue.",
  hero: {
    title: "Your day, on the record.",
    selfIntro:
      "Check in when you start, check out when you finish, and fix any day that went unrecorded.",
    reviewerIntro:
      "See who is in today and decide the corrections routed to you.",
  },
  tabs: {
    label: "Attendance views",
    mine: "Your attendance",
    team: "Team today",
  },
  errors: {
    save: "Could not save.",
    cancel: "Could not cancel.",
    send: "Could not send the request.",
    decision: "Could not save the decision.",
  },
  month: {
    title: "The last 30 days",
    hint: "Select a day to see its times or ask for a correction.",
    legend: "Legend",
    cellLabel: (date: string, status: string, pending: boolean) =>
      `${date}: ${status}${pending ? ", correction awaiting a decision" : ""}`,
  },
  corrections: {
    title: "Your corrections",
    hint: "Requests to fix a past day, newest first.",
    emptyTitle: "No corrections requested",
    emptyHint: "If a day was recorded wrongly, select it and request one.",
  },
  thread: {
    dayComplete: (worked: string) => `Day complete, ${worked}`,
    checkedInAt: (time: string) => `Checked in at ${time}`,
    onLeave: "You're on leave today",
    holiday: (name: string | null | undefined) => `Holiday: ${name}`,
    ready: "Ready when you are",
    soFar: (worked: string) => `${worked} so far. Check out when you finish.`,
    range: (from: string, to: string | null | undefined) => `${from} to ${to}.`,
    serverClock: "Your check-in time comes from the server clock.",
    saving: "Saving…",
    checkOut: "Check out",
    checkIn: "Check in",
  },
  detail: {
    summary: (p: {
      label: string;
      leaveType?: string | null;
      holiday?: string | null;
      checkIn?: string | null;
      checkOut?: string | null;
      duration: string | null;
      corrected: boolean;
    }) =>
      `${p.label}${p.leaveType ? `: ${p.leaveType}` : ""}${
        p.holiday ? `: ${p.holiday}` : ""
      }${
        p.checkIn
          ? `. ${p.checkIn}${p.checkOut ? ` to ${p.checkOut}` : ", no check-out"}`
          : ""
      }${p.duration !== null ? ` (${p.duration})` : ""}${
        p.corrected ? ", corrected" : ""
      }.`,
    flagged: "Flagged for review only. Nothing is deducted from pay.",
    pending: "A correction is awaiting a decision.",
    request: "Request a correction",
  },
  item: {
    meta: (when: string, approver: string) =>
      `${when}. ${approver === "manager" ? "Manager decides." : "HR decides."}`,
    personWhen: (date: string, from: string, to: string) =>
      `${date}, ${from} to ${to}`,
    range: (from: string, to: string) => `${from} to ${to}`,
    decidedBy: (label: string, by: string, note: string | null | undefined) =>
      `${label} by ${by}${note ? `: ${note}` : "."}`,
    cancelLabel: (date: string) => `Cancel correction for ${date}`,
    cancel: "Cancel",
  },
  dialog: {
    title: "Request a correction",
    intro: (date: string) =>
      `${date}. Enter the times you actually worked; your approver sees your reason.`,
    checkedIn: "Checked in at",
    checkedOut: "Checked out at",
    reason: "What happened?",
    cancel: "Cancel",
    sending: "Sending…",
    send: "Send correction",
  },
  team: {
    boardTitle: (date: string) => `Who's in, ${date}`,
    summary: (inCount: number, done: number, leave: number, total: number) =>
      `${inCount} in now, ${done} finished, ${leave} on leave, of ${total} people you can see.`,
    nobody: "Nobody reports to you yet.",
    awaitingTitle: "Corrections awaiting a decision",
    noneTitle: "No corrections to review",
    noneHint: "Requests routed to you will appear here.",
    approveLabel: (name: string) => `Approve correction for ${name}`,
    declineLabel: (name: string) => `Decline correction for ${name}`,
    saving: "Saving…",
    approve: "Approve",
    decline: "Decline",
    routedManager: "Their manager decides this correction.",
    routedHr: "Another HR colleague decides this correction.",
    decidedTitle: "Recently decided",
    decidedHint: "The latest 20 corrections you can see.",
    declineDialogTitle: "Decline this correction?",
    declineIntro: (name: string, from: string, to: string, date: string) =>
      `${name} asked to record ${from}–${to} on ${date}. They will see your note.`,
    declineWhy: "Why are you declining?",
    goBack: "Go back",
    declineSubmit: "Decline correction",
  },
};
