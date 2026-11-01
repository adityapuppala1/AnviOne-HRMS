// English copy for the Organization screen (UX-02, ORG-02). Keys are stable for later locale resources.
export const organizationCopy = {
  kinds: {
    department: { singular: "department", plural: "departments" },
    location: { singular: "location", plural: "locations" },
    designation: { singular: "designation", plural: "designations" },
    grade: { singular: "grade", plural: "grades" },
    cost_center: { singular: "cost centre", plural: "cost centres" },
  },
  denied: "Organization records require an assigned HR admin workspace.",
  eyebrow: "Organization",
  heading: "Organization, kept in order.",
  intro:
    "Manage the departments, locations, designations, grades and cost centres your organization is built from.",
  add: (singular: string) => `Add ${singular}`,
  currentEntity: "Current legal entity",
  hrWorkspace: "HR workspace",
  saved: (name: string, created: boolean) =>
    `${name} ${created ? "created" : "saved"}.`,
  dismissSaved: "Dismiss saved message",
  recordsLabel: "Organization records",
  recordsTable: "Organization records list",
  typeLabel: "Organization record type",
  tabs: {
    department: "Departments",
    location: "Locations",
    designation: "Designations",
    grade: "Grades",
    cost_center: "Cost centres",
  },
  searchLabel: (plural: string) => `Search ${plural}`,
  searchPlaceholder: (singular: string) =>
    `Find a ${singular} by name or code…`,
  clearSearch: "Clear search",
  count: (total: number | undefined, singular: string, plural: string) =>
    `${total ?? "…"} ${total === 1 ? singular : plural}`,
  countNote: "Every status, including ended and merged",
  noMatches: "No matching records",
  emptyTitle: (plural: string) => `Your ${plural} start here`,
  noMatchesBody: "Try a different name or code, or clear your search.",
  emptyBody: (singular: string) =>
    `Add the first ${singular} for this legal entity.`,
  columns: {
    department: "Department",
    location: "Location",
    designation: "Designation",
    grade: "Grade",
    cost_center: "Cost centre",
    assigned: "Assigned people",
    availability: "Status",
    window: "Effective dates",
  },
  notTracked: "Not assigned yet",
  untrackedNote: (plural: string) =>
    `Employees are not assigned to ${plural} yet, so no one is counted here. You can set them up now; assigning people arrives in a later release.`,
  person: "person",
  people: "people",
  status: {
    scheduled: "Scheduled",
    in_effect: "Active",
    ended: "Ended",
    inactive: "Inactive",
    merged: "Merged",
  },
  window: {
    from: (date: string) => `From ${date}`,
    fromTo: (from: string, to: string) => `${from} to ${to}`,
  },
  edit: (name: string) => `Edit ${name}`,
  rowActions: (name: string) => `More actions for ${name}`,
  viewDetails: "View details",
  mergeInto: "Merge into…",
  mergedInto: (name: string) => `Merged into ${name}`,
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
    datesTitle: "Dates decide when it applies",
    datesBody:
      "A record is in effect from its start date to its end date, both days included. Scheduled and ended records cannot take new assignments.",
    mergeTitle: "Retire by merging",
    mergeBody:
      "A department or location in use cannot be ended by date. Merge it into another and its people move with their history kept.",
    footnote: "Every change records your reason in the audit history.",
  },
  editor: {
    validation: {
      name: "Enter a name between 2 and 60 characters.",
      code: "Use a code of 2–20 characters, starting with a letter, with uppercase letters, numbers, underscores or hyphens.",
      reason: "Explain the change in 10–300 characters.",
      effectiveFrom: "Enter a valid start date.",
      effectiveTo: "Enter a valid end date.",
      fallback: "Review the form and try again.",
    },
    saveFailed: "The record could not be saved. Try again.",
    effectiveFrom: "Effective from",
    effectiveFromHint:
      "First day this record can be used. Leave empty to start today.",
    effectiveTo: "Effective to",
    effectiveToHint:
      "Last day it can be used, inclusive. Leave empty for no end date.",
    dateOrder: "The end date cannot be before the start date.",
    inUse:
      "This record is still in use, so it cannot be ended or postponed by date. Merge it into another record instead.",
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
  detail: {
    title: (name: string) => `Details for ${name}`,
    loading: "Loading details…",
    code: "Permanent code",
    kind: "Type",
    status: "Status",
    window: "Effective dates",
    people: "Assigned people",
    history: "Merge history",
    noHistory: "This record has not been merged with any other.",
    mergedInto: "Merged into",
    mergedFrom: "Merged from",
    mergedOn: (date: string) => `on ${date}`,
    closedNote:
      "This record was merged and is closed. It is read-only; its people and open offers moved to the record it was merged into.",
  },
  merge: {
    title: (name: string) => `Merge ${name}`,
    intro: (singular: string, name: string) =>
      `Move everyone and every open offer from ${name} into another ${singular}. ${name} is then closed and read-only. This cannot be undone.`,
    target: (singular: string) => `Merge into this ${singular}`,
    targetHint:
      "Only units of the same type that are in effect today can receive a merge.",
    placeholder: "Choose a unit",
    noTargets: (singular: string) =>
      `There is no other ${singular} in effect today to merge into. Add one first.`,
    searchTargets: "Find a target by name or code",
    moreTargets: "Showing the first 50 matches. Search to narrow the list.",
    loadFailed: "The units to merge into could not be loaded.",
    countsTitle: "What will move",
    sourceCount: (name: string, count: number) =>
      `${name} (merging): ${count} ${count === 1 ? "person" : "people"}`,
    targetCount: (name: string, count: number) =>
      `${name} now: ${count} ${count === 1 ? "person" : "people"}`,
    afterCount: (name: string, count: number) =>
      `${name} after: ${count} ${count === 1 ? "person" : "people"}`,
    countsNote:
      "Counts cover active and notice-period employees. Former employees and unfinished candidate offers also move, so nothing points at the closed record.",
    reason: "Reason for merge",
    reasonHint:
      "Explain why in 10–300 characters. Avoid confidential employee details.",
    cancel: "Cancel",
    submit: "Merge units",
    merging: "Merging…",
    needTarget: "Choose the unit to merge into.",
    reasonInvalid: "Explain the merge in 10–300 characters.",
    inUse:
      "Policies or holidays still use this record. HR must move them to another unit first (draft or published policy versions for a department, active holidays for a location), then merge again.",
    stale:
      "One of these records changed, or someone else was merging at the same time. The list has been refreshed with the latest versions. Review it and merge again.",
    closed: "This record is already merged and closed.",
    failed: "The merge could not be completed. Try again.",
    doneTitle: "Merge complete",
    done: (source: string, target: string) =>
      `${source} was merged into ${target} and is now closed.`,
    movedActive: (count: number) =>
      `${count} active ${count === 1 ? "person" : "people"} moved`,
    movedInactive: (count: number) =>
      `${count} former ${count === 1 ? "employee" : "employees"} moved`,
    movedCandidates: (count: number) =>
      `${count} candidate ${count === 1 ? "offer" : "offers"} moved`,
    finish: "Done",
    banner: (source: string, target: string) =>
      `${source} merged into ${target}.`,
  },
};
