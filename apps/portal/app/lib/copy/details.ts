import type { ProfileChangeStatus, ProfileField } from "@anvi/contracts";

type FieldCopy = {
  label: string;
  hint: string;
  type: "text" | "tel" | "email";
  autoComplete: string;
  maxLength: number;
};

export const detailsCopy = {
  denied:
    "My details is available to employees and to HR. Switch role to continue.",
  tabs: { label: "Views", mine: "My details", review: "Change requests" },
  statusNames: {
    submitted: "Awaiting HR",
    approved: "Approved",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    applied: "Applied",
  } satisfies Record<ProfileChangeStatus, string>,
  fields: {
    personalPhone: {
      label: "Personal phone",
      hint: "Digits, spaces or dashes. A leading + is fine.",
      type: "tel",
      autoComplete: "tel",
      maxLength: 24,
    },
    personalEmail: {
      label: "Personal email",
      hint: "An address outside your work account.",
      type: "email",
      autoComplete: "email",
      maxLength: 254,
    },
    emergencyName: {
      label: "Emergency contact name",
      hint: "2 to 80 characters.",
      type: "text",
      autoComplete: "off",
      maxLength: 80,
    },
    emergencyPhone: {
      label: "Emergency contact phone",
      hint: "Digits, spaces or dashes.",
      type: "tel",
      autoComplete: "off",
      maxLength: 24,
    },
    emergencyRelationship: {
      label: "Relationship",
      hint: "For example Spouse or Parent. 2 to 40 characters.",
      type: "text",
      autoComplete: "off",
      maxLength: 40,
    },
    addressLine1: {
      label: "Address line 1",
      hint: "3 to 120 characters.",
      type: "text",
      autoComplete: "address-line1",
      maxLength: 120,
    },
    addressLine2: {
      label: "Address line 2",
      hint: "Optional. Up to 120 characters.",
      type: "text",
      autoComplete: "address-line2",
      maxLength: 120,
    },
    city: {
      label: "City",
      hint: "2 to 60 characters.",
      type: "text",
      autoComplete: "address-level2",
      maxLength: 60,
    },
    postalCode: {
      label: "Postal code",
      hint: "3 to 10 letters or digits.",
      type: "text",
      autoComplete: "postal-code",
      maxLength: 10,
    },
  } satisfies Record<ProfileField, FieldCopy>,
  groups: [
    {
      key: "contact",
      title: "Phone & email",
      fields: ["personalPhone", "personalEmail"],
    },
    {
      key: "emergency",
      title: "Emergency contact",
      fields: ["emergencyName", "emergencyPhone", "emergencyRelationship"],
    },
    {
      key: "address",
      title: "Address",
      fields: ["addressLine1", "addressLine2", "city", "postalCode"],
    },
  ] satisfies { key: string; title: string; fields: ProfileField[] }[],
  mine: {
    title: "My details",
    subtitle:
      "Your contact details as HR holds them. To change one, send a request and HR will review it.",
    loadFailed: "We couldn't load your details.",
    currentHeading: "Current details",
    request: "Request a change",
    notProvided: "Not provided",
    unavailable: "We couldn't read this value. Ask HR.",
    updated: (when: string, by: string | null) =>
      by ? `Last updated ${when} by ${by}.` : `Last updated ${when}.`,
    neverUpdated: "HR has not recorded any of these details yet.",
    privacy:
      "Only you and the HR people who review change requests can see these values. Opening them is recorded in an audit log.",
  },
  open: {
    heading: "Your open request",
    fields: "Fields",
    effective: "Effective on",
    reason: "Reason",
    submitted: "Sent on",
    willChange: "What you asked for",
    cleared: "Clear this field",
    steps: {
      heading: "Progress",
      submitted: "Submitted",
      approved: "Approved",
      applied: "Applied",
      done: "Done",
      current: "Current step",
      next: "Still to come",
    },
    waitingHr: "HR has not decided yet. You can withdraw until they do.",
    approvedWaiting: (date: string, by: string | null) =>
      `${by ? `${by} approved this change.` : "HR approved this change."} It takes effect on ${date}.`,
    applyHow:
      "An approved change applies on its effective date, when you open your details on or after that day or when HR runs the due-change check. Until then your current details stay as they are. You can still withdraw it.",
    withdraw: "Withdraw request",
    note: "HR note",
  },
  recent: {
    heading: "Recent requests",
    empty: "You have not sent any change requests.",
    effective: (date: string) => `Effective ${date}`,
    sent: (date: string) => `Sent ${date}`,
  },
  history: {
    heading: "Change history",
    intro: "Changes that have been applied to your details.",
    empty: "No change has been applied yet.",
    changed: (from: string, to: string) => `${from} to ${to}`,
    effective: (date: string) => `Effective ${date}`,
    applied: (date: string, by: string) => `Applied ${date}, approved by ${by}`,
    unavailable: "A value in this entry can't be read.",
    empty_value: "Not provided",
  },
  form: {
    cancel: "Cancel",
    back: "Go back",
    count: (n: number) => `${n} of 500 characters.`,
  },
  requestDialog: {
    title: "Request a change",
    intro:
      "Change only what needs updating. Fields you leave as they are won't be sent. Empty a field to ask HR to clear it.",
    currentUnknown:
      "We can't read the current value, so this starts empty. Leave it empty to keep it unchanged.",
    reason: "Reason for the change",
    reasonHint: "Say briefly why. 3 to 500 characters.",
    effective: "Effective date",
    effectiveHint: "Today up to 90 days ahead.",
    submit: "Send request",
    saving: "Sending…",
    nothing: "Change at least one field before sending.",
    fieldsInvalid: "Please fix the highlighted fields.",
    reasonShort: "Enter a reason of at least 3 characters.",
    dateRange: "Choose a date from today to 90 days ahead.",
    failed: "We couldn't send your request. Try again.",
    clearing: "Will be cleared",
    invalidField: (label: string) => `${label} is not in a valid format.`,
    emptyNotAllowed: (label: string) =>
      `${label} can't be cleared because it is not set.`,
  },
  withdrawDialog: {
    title: "Withdraw request",
    intro:
      "Your details stay as they are, and HR will no longer see this request as open. You can send a new one any time.",
    submit: "Withdraw request",
    saving: "Withdrawing…",
    failed: "We couldn't withdraw this request. Try again.",
  },
  review: {
    title: "Change requests",
    subtitle:
      "Contact-detail changes sent by employees. The list shows what is changing, never the values.",
    loadFailed: "We couldn't load the change requests.",
    applyDue: "Apply due changes",
    applying: "Applying…",
    applyFailed: "We couldn't run the due-change check. Try again.",
    applyNone: "Nothing was due. No details changed.",
    applyDone: (n: number) =>
      n === 1 ? "Applied 1 due change." : `Applied ${n} due changes.`,
    applyHint:
      "Approved changes also apply on their own when the employee opens their details.",
    stats: {
      waiting: "Awaiting decision",
      waitingHint: "Need an HR decision",
      approved: "Approved, not yet applied",
      approvedHint: "Waiting for their date",
      applied: "Applied",
      appliedHint: "Details updated",
      closed: "Rejected or withdrawn",
      closedHint: "No change made",
    },
    list: {
      heading: "Requests",
      total: (n: number) => (n === 1 ? "1 request" : `${n} requests`),
      searchLabel: "Search requests",
      searchPlaceholder: "Search by name or employee code",
      statusLabel: "Filter by status",
      all: "All",
      emptyTitle: "No change requests",
      emptyBody: "When someone asks to change their details it appears here.",
      noMatchTitle: "No requests match",
      noMatchBody: "Try a different name or status.",
      clearFilters: "Clear filters",
      open: "Open",
      openLabel: (name: string) => `Open ${name}`,
      changing: (labels: string) => `Changing ${labels}`,
      effective: (date: string) => `Effective ${date}`,
      submitted: (date: string) => `Submitted ${date}`,
    },
  },
  detail: {
    title: "Request details",
    loadFailed: "We couldn't load this request.",
    auditNote:
      "Opening this request shows personal values and is recorded in the audit log. Only the new values are shown.",
    changes: "Requested changes",
    newValue: "New value",
    cleared: "Will be cleared",
    unavailable: "Can't be read",
    reason: "Reason",
    effective: "Effective on",
    submittedBy: "Sent by",
    decision: "Decision",
    decidedBy: (name: string, date: string) => `${name} on ${date}`,
    decisionNote: "HR note",
    note: "Note",
    noteHint: "Optional for approval. 3 to 500 characters when given.",
    approve: "Approve",
    approving: "Approving…",
    reject: "Reject",
    cancel: "Cancel approved change",
    notDecidable: "This request has already been decided.",
    ownRequest: "Another HR admin must decide your own request.",
    approvedWaiting:
      "Approved. It applies on the effective date, or when you run Apply due changes.",
    failed: "We couldn't save that decision. Try again.",
  },
  rejectDialog: {
    title: "Reject request",
    intro: (name: string) =>
      `${name} will see your note. Their details stay unchanged.`,
    note: "Note",
    noteHint: "Say why. 3 to 500 characters.",
    submit: "Reject request",
    saving: "Rejecting…",
    failed: "We couldn't reject this request. Try again.",
  },
  cancelDialog: {
    title: "Cancel approved change",
    intro: (name: string) =>
      `This stops ${name}'s approved change before it applies. Their details stay as they are.`,
    note: "Note",
    noteHint: "Say why. 3 to 500 characters.",
    submit: "Cancel this change",
    saving: "Cancelling…",
    failed: "We couldn't cancel this change. Try again.",
  },
  errors: {
    forbidden: "You can't do that.",
    ownRequest: "Another HR admin must decide your own request.",
    stale: "Someone changed this. The latest version is showing.",
  },
};
