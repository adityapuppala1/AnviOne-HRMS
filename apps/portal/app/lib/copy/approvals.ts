// User-visible text for the approvals screen.
export const approvalsCopy = {
  days: (n: number) => `${n} ${n === 1 ? "day" : "days"}`,
  subject: {
    leave: "leave",
    attendance_correction: "attendance correction",
    readiness_review: "readiness review",
    document_review: "document",
  },
  fileSummary: (fileName: string, size: string) => `${fileName}, ${size}`,
  sizeKb: (kb: number) => `${kb} KB`,
  sizeMb: (mb: string) => `${mb} MB`,
  errors: {
    notAllowed: "Approvals are for managers and HR. Switch role to continue.",
    decision: "Could not save the decision.",
  },
  hero: {
    none: "Nothing waiting",
    waiting: (n: number) => `${n} waiting for you`,
    title: "Decisions, in one place.",
    body: "Leave, attendance corrections, documents to verify and onboarding readiness reviews routed to you, oldest first. Each decision is recorded with your name.",
  },
  sections: {
    yours: "Needs your decision",
    others: "Routed to someone else",
  },
  empty: {
    title: "You're all caught up",
    body: "New requests routed to you will appear here.",
  },
  dialog: {
    approveTitle: "Approve this readiness review?",
    declineTitle: "Decline this request?",
    approveNote: (person: string) =>
      `Record why ${person}'s local readiness evidence is sufficient. This is a local review, not employee activation.`,
    declineNote: (person: string, subject: string) =>
      `${person}'s ${subject} will show your note.`,
    approveLabel: "Reason for approving",
    declineLabel: "Why are you declining?",
    back: "Go back",
  },
  actions: {
    saving: "Saving…",
    approve: "Approve",
    decline: "Decline",
    approveLabel: (subject: string, name: string) =>
      `Approve ${subject} for ${name}`,
    declineLabel: (subject: string, name: string) =>
      `Decline ${subject} for ${name}`,
    viewFile: "View file",
  },
  kind: {
    attendance: "Attendance correction",
    document: "Document to verify",
    readiness: "Onboarding readiness review",
  },
  when: {
    range: (from: string, to: string) => `${from} – ${to}`,
    away: (days: string) => `${days} away`,
    times: (checkIn: string, checkOut: string) => `${checkIn} to ${checkOut}`,
    proposedTimes: (day: string) => `Proposed times for ${day}`,
    documentCategory: (category: string) =>
      `${category[0]!.toUpperCase() + category.slice(1)} document`,
    proposedBy: (label: string) => `Proposed by ${label}`,
    evidenceReady: "Form approved and required tasks complete",
    evidenceIncomplete:
      "Evidence incomplete: approve the form and finish required tasks first",
  },
  card: {
    candidate: (title: string, department: string) => `${title}, ${department}`,
    proposedByYou: "You proposed this; another HR colleague checks it",
    managerDecides: "Their manager decides",
    hrDecides: "Another HR colleague decides",
  },
};
