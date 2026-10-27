// English copy for the Organization screen (UX-02). Keys are stable for later locale resources.
export const organizationCopy = {
  kinds: {
    department: { singular: "department", plural: "departments" },
    location: { singular: "location", plural: "locations" },
  },
  denied: "Organization records require an assigned HR admin workspace.",
  eyebrow: "Organization",
  heading: "Organization, kept in order.",
  intro: "Manage the departments and locations your people belong to.",
  add: (singular: string) => `Add ${singular}`,
  currentEntity: "Current legal entity",
  hrWorkspace: "HR workspace",
  saved: (name: string, created: boolean) =>
    `${name} ${created ? "created" : "saved"}.`,
  dismissSaved: "Dismiss saved message",
  recordsLabel: "Organization records",
  recordsTable: "Organization records list",
  typeLabel: "Organization record type",
  departments: "Departments",
  locations: "Locations",
  searchLabel: (plural: string) => `Search ${plural}`,
  searchPlaceholder: (singular: string) =>
    `Find a ${singular} by name or code…`,
  clearSearch: "Clear search",
  count: (total: number | undefined, singular: string, plural: string) =>
    `${total ?? "…"} ${total === 1 ? singular : plural}`,
  countNote: "Active and inactive records",
  noMatches: "No matching records",
  emptyTitle: (plural: string) => `Your ${plural} start here`,
  noMatchesBody: "Try a different name or code, or clear your search.",
  emptyBody: (singular: string) =>
    `Add the first ${singular} for this legal entity.`,
  columns: {
    department: "Department",
    location: "Location",
    assigned: "Assigned people",
    availability: "Availability",
  },
  person: "person",
  people: "people",
  active: "Active",
  inactive: "Inactive",
  edit: (name: string) => `Edit ${name}`,
  page: (page: number, pages: number) => `Page ${page} of ${pages}`,
  previous: "Previous",
  next: "Next",
  guide: {
    eyebrow: "Keep the connections",
    heading1: "Names can change.",
    heading2: "History stays connected.",
    body: "Each record has a permanent code. Rename it as your organization evolves.",
    inactivateTitle: "Inactivate, retain history",
    inactivateBody:
      "Inactive records remain on existing profiles and cannot be used for new assignments.",
    reactivateTitle: "Ready to use again?",
    reactivateBody:
      "Reactivate a record to make it available for future assignments.",
    footnote: "Every change records your reason in the audit history.",
  },
  editor: {
    validation: {
      name: "Enter a name between 2 and 60 characters.",
      code: "Use a code of 2–20 characters, starting with a letter, with uppercase letters, numbers, underscores or hyphens.",
      reason: "Explain the change in 10–300 characters.",
      fallback: "Review the form and try again.",
    },
    saveFailed: "The record could not be saved. Try again.",
    title: (editing: boolean, singular: string) =>
      editing ? `Edit ${singular}` : `Add ${singular}`,
    introEdit: "Update this record for your current legal entity.",
    introCreate: (singular: string, entity: string) =>
      `Create a ${singular} for ${entity}.`,
    name: "Name",
    code: "Permanent code",
    codeHelpEdit: "This code stays the same throughout the record's history.",
    codeHelpCreate:
      "2–20 characters. Start with a letter; use uppercase letters, numbers, underscores or hyphens.",
    availability: "Availability",
    activeNote: "Available for future assignments",
    inactiveNote: "Retain existing assignments and history",
    impact: (count: number, singular: string) =>
      `${count} ${
        count === 1
          ? "person keeps their existing assignment"
          : "people keep their existing assignments"
      }. This ${singular} will be unavailable for new assignments.`,
    reason: "Reason for change",
    reasonHelp:
      "Explain the organization change in 10–300 characters. Avoid confidential employee details.",
    conflict:
      "Another change may have been saved. Reload the list and review the latest record before trying again.",
    reload: "Reload list",
    cancel: "Cancel",
    saving: "Saving…",
    saveChanges: "Save changes",
    create: (singular: string) => `Create ${singular}`,
  },
};
