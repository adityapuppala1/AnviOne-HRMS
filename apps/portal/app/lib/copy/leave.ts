import type { LeaveState } from "@anvi/contracts";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export const leaveCopy = {
  days,
  states: {
    pending: "Awaiting decision",
    approved: "Approved",
    rejected: "Declined",
    cancelled: "Cancelled",
  } satisfies Record<LeaveState, string>,
  unavailable:
    "Leave is available in employee, manager and HR workspaces. Switch role to continue.",
  hero: {
    title: "Time away, planned together.",
    requesterIntro:
      "See what you have left, ask for time off and follow each decision.",
    approverIntro:
      "Decide the requests routed to you and keep an eye on what is coming up.",
    requestLeave: "Request leave",
  },
  tabs: {
    label: "Leave views",
    mine: "Your leave",
    team: "Team requests",
  },
  mine: {
    balanceTitle: (year: number) => `Your ${year} balance`,
    balanceHint:
      "Approved leave is used; requests awaiting a decision are held.",
    requestsTitle: "Your requests",
    requestsHint: "Coming up first, then everything already decided.",
    emptyTitle: "No leave requested yet",
    emptyBody: "Use Request leave to plan your first time away.",
    comingUp: "Coming up",
    history: "History",
  },
  cancelDialog: {
    title: "Cancel this leave?",
    summary: (
      typeName: string,
      when: string,
      dayCount: number,
      approved: boolean,
    ) =>
      `${typeName}, ${when} (${days(dayCount)}). ${
        approved
          ? "The days return to your balance."
          : "Your approver will no longer see it."
      }`,
    keep: "Keep it",
    cancelling: "Cancelling…",
    confirm: "Cancel leave",
    failed: "Could not cancel this leave.",
  },
  balance: {
    noLimit: (paid: boolean) => `${paid ? "Paid" : "Unpaid"}, no annual limit`,
    openNote: (used: number, pending: number) =>
      used + pending > 0
        ? `${days(used)} taken, ${days(pending)} awaiting a decision this year.`
        : "Nothing taken this year.",
    ofLeft: (total: number) => `of ${total} days left`,
    railLabel: (
      name: string,
      used: number,
      pending: number,
      available: number,
      total: number,
    ) =>
      `${name}: ${used} used, ${pending} awaiting a decision, ${available} available of ${total}`,
    usedNote: (used: number) => `${days(used)} used`,
    onHold: (pending: number) => `, ${days(pending)} on hold`,
  },
  list: {
    detail: (when: string, dayCount: number, byManager: boolean) =>
      `${when}, ${days(dayCount)}. ${byManager ? "Your manager decides." : "HR decides."}`,
    decision: (state: string, by: string, note: string | null) =>
      `${state} by ${by}${note ? `: ${note}` : "."}`,
    cancelAria: (typeName: string, when: string) =>
      `Cancel ${typeName}, ${when}`,
    cancel: "Cancel",
  },
  approvals: {
    saveFailed: "Could not save the decision.",
    awaitingTitle: "Awaiting a decision",
    caughtUpTitle: "You're all caught up",
    caughtUpBody: "New requests routed to you will appear here.",
    cardType: (typeName: string, dayCount: number) =>
      `${typeName}, ${days(dayCount)}`,
    approveAria: (name: string) => `Approve leave for ${name}`,
    declineAria: (name: string) => `Decline leave for ${name}`,
    saving: "Saving…",
    approve: "Approve",
    decline: "Decline",
    routed: (byManager: boolean) =>
      byManager
        ? "Their manager decides this request."
        : "Another HR colleague decides this request.",
    decidedTitle: "Recently decided",
    decidedHint: "The latest 20 decisions and cancellations you can see.",
    decidedDetail: (typeName: string, when: string, dayCount: number) =>
      `${typeName}, ${when}, ${days(dayCount)}`,
    decidedBy: (by: string, note: string | null) =>
      `By ${by}${note ? `: ${note}` : "."}`,
  },
  declineDialog: {
    title: "Decline this request?",
    summary: (name: string, typeName: string, when: string) =>
      `${name} asked for ${typeName.toLowerCase()}, ${when}. They will see your note.`,
    reasonLabel: "Why are you declining?",
    goBack: "Go back",
    saving: "Saving…",
    submit: "Decline request",
  },
  request: {
    title: "Request leave",
    failed: "Could not send this request.",
    countOk: (dayCount: number) =>
      `${days(dayCount)} of leave, not counting days off or holidays.`,
    countAllOff:
      "These dates are all days off or holidays. Choose at least one working day.",
    countPick: "Pick your dates to see how many working days this uses.",
    countShort: (dayCount: number, left: number) =>
      `${days(dayCount)}, more than the ${days(left)} you have left.`,
    typeLabel: "Leave type",
    optionNoLimit: " (no limit)",
    optionLeft: (available: number) => ` (${days(available)} left)`,
    firstDay: "First day",
    lastDay: "Last day",
    reasonLabel: "Reason",
    hint: "Your approver sees this. Keep medical details private.",
    cancel: "Cancel",
    sending: "Sending…",
    send: "Send request",
  },
};
