import type { ExitClearanceItem, ExitKind, ExitStatus } from "@anvi/contracts";

export const exitCopy = {
  denied:
    "Exits are available to HR and to employees. Switch role to continue.",
  statusNames: {
    submitted: "Awaiting decision",
    accepted: "Accepted",
    completed: "Completed",
    withdrawn: "Withdrawn",
    rejected: "Declined",
  } satisfies Record<ExitStatus, string>,
  kinds: {
    resignation: "Resignation",
    termination: "Termination",
    end_of_contract: "End of contract",
    retirement: "Retirement",
    other: "Other",
  } satisfies Record<ExitKind, string>,
  items: {
    assets: {
      label: "Company assets",
      help: "Laptops, phones and anything else issued to the person.",
    },
    finance: {
      label: "Finance dues",
      help: "Advances, loans and expense claims are settled.",
    },
    it_access: {
      label: "IT access",
      help: "Accounts and devices outside this app are handled by IT.",
    },
    manager_handover: {
      label: "Manager handover",
      help: "Work and knowledge are handed over to the team.",
    },
    hr_documents: {
      label: "HR documents",
      help: "Relieving and experience letters are ready.",
    },
  } satisfies Record<ExitClearanceItem, { label: string; help: string }>,
  clearanceStatus: {
    pending: "Pending",
    cleared: "Cleared",
    waived: "Waived",
  },
  steps: {
    heading: "Progress",
    submitted: "Submitted",
    accepted: "Accepted",
    clearances: "Clearances",
    completed: "Completed",
    current: "Current step",
    done: "Done",
    next: "Still to come",
    stopped: (status: string) => `Stopped: ${status.toLowerCase()}`,
  },
  help: {
    title: "How exits work",
    body: "Sign-in access stops when HR completes the case, and the person becomes inactive. Accounts and devices in other systems are not touched from here, so IT handles those separately.",
  },
  form: {
    cancel: "Cancel",
    close: "Close",
    count: (used: number) => `${used} of 500 characters`,
    noteOptional: "Note (optional)",
    noteOptionalHint: "Up to 500 characters.",
  },

  /* Employee view ------------------------------------------------------ */
  mine: {
    title: "Leaving the company",
    subtitle:
      "Resign, follow what happens next and see your clearance checklist.",
    loadFailed: "We could not load your exit details.",
    emptyTitle: "You have not resigned",
    emptyBody:
      "If you decide to leave, you can submit your resignation here. HR reviews it, sets your last working day and walks you through a short clearance checklist.",
    whatHappens: "What happens next",
    stepsList: [
      "You submit your resignation. Today is recorded as your notice date.",
      "HR accepts it and sets your last working day, or gets in touch if something needs discussing.",
      "You hand back company assets and HR ticks off the clearance checklist.",
      "HR completes your exit. Your sign-in access stops from then on.",
    ],
    submit: "Submit resignation",
    currentHeading: "Your resignation",
    noticeOn: "Notice date",
    lastDay: "Last working day",
    lastDayPending: "HR will set this when they accept",
    reasonLabel: "Your reason",
    hrNote: "Note from HR",
    rejectedIntro: "HR could not accept this resignation.",
    clearancesHeading: "Clearance checklist",
    clearancesIntro:
      "HR ticks these off one by one. You can see where things stand.",
    clearancesWaiting: "The checklist opens once HR accepts your resignation.",
    clearedBy: (name: string, date: string) => `Cleared by ${name} on ${date}`,
    waivedBy: (name: string, date: string) => `Waived by ${name} on ${date}`,
    pendingNow: "Not cleared yet",
    withdraw: "Withdraw resignation",
    askHr:
      "HR has already accepted your resignation. To change your mind, ask HR to withdraw it.",
    historyHeading: "Earlier cases",
    historyEmpty: "",
    historyEntry: (kind: string, noticeDate: string) =>
      `${kind} from ${noticeDate}`,
  },
  resign: {
    title: "Submit resignation",
    intro:
      "Today is recorded as your notice date. HR will set your last working day when they accept.",
    reason: "Why are you leaving?",
    reasonHint: "3 to 500 characters. HR sees this.",
    submit: "Submit resignation",
    saving: "Submitting…",
    failed: "We could not submit your resignation. Try again.",
  },
  withdrawMine: {
    title: "Withdraw resignation",
    intro:
      "Your resignation will be withdrawn and you will carry on as normal. You can submit a new one later if you need to.",
    note: "Note (optional)",
    submit: "Withdraw resignation",
    saving: "Withdrawing…",
    failed: "We could not withdraw your resignation. Try again.",
  },

  /* HR view ------------------------------------------------------------ */
  title: "Exits",
  subtitle:
    "Receive resignations, start exits, set last working days and run the clearance checklist.",
  start: "Start an exit",
  stats: {
    open: "Open cases",
    openHint: "Not yet closed",
    awaiting: "Awaiting decision",
    awaitingHint: "Resignations to accept or decline",
    clearance: "In clearance",
    clearanceHint: "Accepted, checklist running",
    completed: "Completed",
    completedHint: "Finished exits",
  },
  toolbar: {
    searchLabel: "Search exits",
    searchPlaceholder: "Search by name, code or reason",
    statusLabel: "Filter by status",
    all: "All",
  },
  list: {
    heading: "Exit cases",
    total: (count: number) => `${count} ${count === 1 ? "case" : "cases"}`,
    loadFailed: "We could not load exit cases.",
    emptyTitle: "No exits yet",
    emptyBody:
      "Resignations show up here when employees submit them. You can also start an exit yourself.",
    noMatchTitle: "No exits match",
    noMatchBody: "Try a different search or status.",
    clearFilters: "Clear filters",
    noticeOn: (date: string) => `Notice ${date}`,
    lastDay: (date: string) => `Last working day ${date}`,
    lastDayNone: "Last working day not set",
    cleared: (done: number, total: number) => `${done} of ${total} cleared`,
    open: "Open",
    openLabel: (name: string) => `Open ${name}`,
  },
  startDialog: {
    title: "Start an exit",
    intro:
      "Use this for exits that HR begins, such as an end of contract or retirement.",
    find: "Find the employee",
    findHint: "Type a name to search the directory.",
    results: "Matching employees",
    none: "No employees match that search.",
    selected: "Selected employee",
    change: "Change",
    kind: "Kind of exit",
    reason: "Reason",
    reasonHint: "3 to 500 characters.",
    notice: "Notice given on",
    noticeHint: "Today or a day within the last 90 days.",
    needPerson: "Pick an employee first.",
    submit: "Start exit",
    saving: "Starting…",
    failed: "We could not start this exit. Try again.",
  },
  details: {
    title: "Exit details",
    loadFailed: "We could not load this exit.",
    facts: "Facts",
    kind: "Kind",
    notice: "Notice date",
    lastDay: "Last working day",
    lastDayNone: "Not set yet",
    department: "Department",
    code: "Employee code",
    submittedBy: "Started by",
    decidedBy: (name: string, date: string) => `Decided by ${name} on ${date}`,
    closedBy: (name: string, date: string) => `Closed by ${name} on ${date}`,
    reason: "Reason given",
    decisionNote: "Decision note",
    assetsHeading: "Company assets",
    assetsOpen: (count: number) =>
      `${count} ${count === 1 ? "asset" : "assets"} not yet returned`,
    assetsNone: "No assets outstanding",
    assetsBlocked:
      "The company assets item cannot be cleared or waived, and the exit cannot be completed, until every asset is received back.",
    assetsLink: "Go to assets",
    clearances: "Clearance checklist",
    clearancesWaiting:
      "The checklist opens when the case is accepted. Then each of the five items is cleared or waived.",
    clearancesLocked: "The checklist can no longer be changed.",
    progress: (done: number, total: number) => `${done} of ${total} cleared`,
    clearedBy: (name: string, date: string) => `Cleared by ${name} on ${date}`,
    waivedBy: (name: string, date: string) => `Waived by ${name} on ${date}`,
    pendingNow: "Not cleared yet",
    noteLabel: (note: string) => `Note: ${note}`,
    clear: "Clear",
    waive: "Waive",
    reopen: "Reopen",
    clearLabel: (item: string) => `Clear ${item}`,
    waiveLabel: (item: string) => `Waive ${item}`,
    reopenLabel: (item: string) => `Reopen ${item}`,
    clearFailed: "We could not update this item. Try again.",
    blockedReason: "Blocked until every asset is returned",
    completeBlocked: "Clear or waive every item to enable Complete exit.",
    completeBlockedAssets: "Receive every asset back to enable Complete exit.",
    actions: "Decision",
    accept: "Accept",
    reject: "Reject",
    withdraw: "Withdraw",
    complete: "Complete exit",
  },
  accept: {
    title: "Accept exit",
    intro: (name: string) =>
      `Accepting starts the clearance checklist for ${name}.`,
    lastDay: "Last working day",
    lastDayHint: (from: string, to: string) =>
      `Between ${from} and ${to}, which is 180 days after the notice date.`,
    note: "Note (optional)",
    submit: "Accept",
    saving: "Accepting…",
    failed: "We could not accept this exit. Try again.",
  },
  reject: {
    title: "Reject resignation",
    intro: (name: string) =>
      `Tell ${name} why the resignation cannot be accepted. They will see this note.`,
    note: "Reason",
    noteHint: "3 to 500 characters.",
    submit: "Reject",
    saving: "Rejecting…",
    failed: "We could not reject this exit. Try again.",
  },
  withdrawHr: {
    title: "Withdraw exit",
    introSubmitted: "The exit will be withdrawn and the person carries on.",
    introAccepted:
      "The exit was already accepted. Say why it is being withdrawn so there is a record.",
    note: "Reason",
    noteHint: "3 to 500 characters.",
    submit: "Withdraw",
    saving: "Withdrawing…",
    failed: "We could not withdraw this exit. Try again.",
  },
  complete: {
    title: "Complete exit",
    intro: (name: string) =>
      `${name} will lose access to this workspace and become inactive. This cannot be undone.`,
    external:
      "Accounts and devices in other systems are not changed from here.",
    submit: "Complete exit",
    saving: "Completing…",
    failed: "We could not complete this exit. Try again.",
    early: "Early release",
    earlyHint: (date: string) =>
      `The last working day is ${date} and has not been reached. Tick this to release the person earlier, and say why.`,
    earlyNote: "Reason for early release",
    earlyNoteHint: "3 to 500 characters.",
  },
  waiveDialog: {
    title: "Waive clearance",
    intro: (item: string) =>
      `Waiving ${item} marks it as not needed for this person. Say why so there is a record.`,
    note: "Reason",
    noteHint: "3 to 300 characters.",
    submit: "Waive item",
    saving: "Saving…",
    failed: "We could not waive this item. Try again.",
  },
  errors: {
    conflict:
      "Someone else changed this case. The latest version is now showing, so please check and try again.",
    forbidden: "You do not have permission to do that.",
    ownCase:
      "Another HR admin must decide this case. You cannot act on your own exit.",
    sameNote:
      "Write a new reason. It must differ from the note given when the exit was accepted.",
  },
};
