import type { LrnAssignment, LrnCourse } from "@anvi/contracts";

type AssignmentStatus = LrnAssignment["status"];
type CourseStatus = LrnCourse["status"];
type Delivery = LrnCourse["deliveryMode"];
type Renewal = NonNullable<LrnAssignment["renewal"]>;

// User-visible text for the Learning (LRN-01) screen.
export const learningCopy = {
  title: "Learning",
  subtitleSelf:
    "See the courses assigned to you, mark your progress, and enrol in optional courses.",
  subtitleTeam:
    "Follow your own learning and see where your direct reports stand (read only).",
  subtitleManage:
    "Run the course catalogue, assign courses to people or whole departments and locations, and see who is overdue or due for renewal.",
  denied: "Learning is available to employees, managers and HR.",
  limits:
    "Limits: courses are not hosted here, so there is no content player, quiz, attendance capture or certificate file. An external link is only a link; the system cannot tell whether anyone opened it. Completion is self-declared by the learner or recorded by HR, and nothing verifies the learning itself. There are no emails, chat or push reminders for assignments, due dates or renewals, so check back here. Assigning to a department or location is a one-time snapshot: people who join later are not assigned automatically, and an expired certification is not re-assigned automatically. Managers read their team's assignments but cannot assign or record completions. Nothing here is recommended by AI.",
  tabs: {
    label: "Learning views",
    mine: "My learning",
    catalogue: "Catalogue",
    team: "Team",
    manage: "Manage",
    compliance: "Compliance",
  },
  stats: {
    overdue: "Overdue",
    overdueHint: "Past the due date",
    inProgress: "In progress",
    inProgressHint: "Started, not finished",
    completed: "Completed",
    completedHint: "Finished or recorded by HR",
    renewal: "Renewal due",
    renewalHint: "Certification expires within 30 days",
  },
  common: {
    search: "Search",
    status: "Status",
    allStatuses: "All statuses",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    close: "Close",
    saveFailed: "Could not save the change. Try again.",
    loading: "Loading…",
    you: "You",
    none: "None",
    yes: "Yes",
    no: "No",
  },
  status: {
    assigned: "Not started",
    in_progress: "In progress",
    completed: "Completed",
    waived: "Waived",
  } satisfies Record<AssignmentStatus, string>,
  badge: {
    overdue: "Overdue",
    mandatory: "Mandatory",
    optional: "Optional",
    selfEnrolled: "Self-enrolled",
    due: (date: string) => `Due ${date}`,
    noDue: "No due date",
  },
  renewal: {
    current: "Certification current",
    due: "Renewal due",
    expired: "Expired",
  } satisfies Record<Renewal, string>,
  audience: {
    employee: "Assigned to you directly",
    employeeOther: "Assigned directly",
    department: "Assigned with a department",
    location: "Assigned with a location",
    self: "Self-enrolled",
  },
  courseStatus: {
    draft: "Draft",
    published: "Published",
    archived: "Archived",
  } satisfies Record<CourseStatus, string>,
  delivery: {
    online: "Online",
    classroom: "Classroom",
    self_study: "Self-study",
  } satisfies Record<Delivery, string>,
  duration: (minutes: number) =>
    minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`,
  assignments: {
    columns: {
      course: "Course",
      person: "Person",
      due: "Due",
      status: "Status",
      mandatory: "Type",
    },
    mineEmpty: "Nothing assigned to you yet",
    mineEmptyBody:
      "When HR assigns you a course it shows up here. You can also enrol in optional courses from the Catalogue.",
    teamEmpty: "No assignments for your team",
    teamEmptyBody:
      "Your direct reports have no course assignments that match these filters.",
    allEmpty: "No assignments yet",
    allEmptyBody:
      "Assign a course from the courses list above and it appears here.",
    emptyFiltered: "No assignments match these filters",
    filters: {
      overdue: "Overdue",
      anyDue: "Any due date",
      overdueOnly: "Overdue only",
      renewal: "Renewal",
      anyRenewal: "Any renewal state",
      course: "Course",
      allCourses: "All courses",
    },
    mineLabel: "My assignments",
    teamLabel: "Team assignments",
    allLabel: "All assignments",
    teamNote:
      "Read only. Direct reports' assignments and completion notes are visible to you; you cannot start, complete or record anything for them.",
  },
  actions: {
    start: "Start course",
    complete: "Mark complete",
    record: "Record completion",
    waive: "Waive",
  },
  detail: {
    course: "Course",
    code: "Course code",
    person: "Person",
    category: "Category",
    delivery: "Delivery",
    duration: "Duration",
    due: "Due on",
    type: "Type",
    status: "Status",
    assignedBy: "Assigned by",
    assignedOn: "Assigned on",
    started: "Started",
    completed: "Completed",
    waived: "Waived",
    expires: "Certification expires",
    renewal: "Certification",
    audience: "How it was assigned",
    link: "Course link",
    openLink: (host: string) => `Open ${host}`,
    linkNote:
      "Opens another site in a new tab. The system cannot tell whether you opened it.",
    history: "Completion history",
    noHistory: "No completion recorded yet.",
    historyLine: {
      completed: "Completed",
      waived: "Waived",
      self: "by the learner",
      hr: "recorded by HR",
    },
    noteLabel: "Note",
    reasonLabel: "Reason",
    expiresOn: (date: string) => `expires ${date}`,
    fourEyes:
      "This is your own assignment. For four-eyes control HR cannot record a completion for, or waive, their own assignment: complete it yourself from My learning, or ask another HR user.",
    archivedOpen:
      "This course has since been archived. Open assignments can still be started and completed, but the course can no longer be assigned or enrolled in.",
    readOnly: "Read only: you can see this assignment but not change it.",
    conflict:
      "Someone else changed this at the same time. Close the panel and open it again.",
  },
  dialogs: {
    complete: {
      title: "Mark this course complete?",
      body: "This records that you finished the course. It is self-declared and cannot be undone.",
      label: "Note (optional, up to 280 characters)",
      submit: "Mark complete",
    },
    record: {
      title: "Record a completion on their behalf?",
      body: "Use this when you know the person finished the course outside the system. The reason is kept in their history and cannot be edited.",
      label: "Reason (required, 3 to 500 characters)",
      submit: "Record completion",
    },
    waive: {
      title: "Waive this assignment?",
      body: "The person no longer has to complete this course. The reason is kept in their history and cannot be edited. You can assign the course again later.",
      label: "Reason (required, 3 to 500 characters)",
      submit: "Waive assignment",
    },
  },
  catalogue: {
    intro:
      "Published courses. Enrol in optional ones; mandatory courses reach you only when HR assigns them.",
    introManage:
      "HR sees courses in every status. Others see published courses and any course they are assigned.",
    columns: {
      course: "Course",
      category: "Category",
      delivery: "Delivery",
      status: "Status",
      type: "Type",
    },
    empty: "No courses yet",
    emptyBody: "Published courses appear here.",
    emptyFiltered: "No courses match these filters",
    label: "Courses",
    enrol: "Enrol",
    enrolled: (title: string) =>
      `You are enrolled in ${title}. Find it under My learning.`,
    alreadyAssigned: "You already have this course. Find it under My learning.",
    mandatoryNote:
      "Mandatory course: HR assigns it, you cannot enrol yourself.",
    statusOnlyHr: "Only HR sees draft and archived courses.",
  },
  course: {
    description: "About this course",
    noDescription: "No description.",
    validity: "Certification valid for",
    validityMonths: (months: number) =>
      `${months} month${months === 1 ? "" : "s"}`,
    noValidity: "Does not expire",
    mandatory: "Mandatory",
    optional: "Optional",
    updated: "Last updated",
    published: "Published",
  },
  manage: {
    coursesTitle: "Courses",
    coursesIntro:
      "Draft a course, publish it, then assign it. Archived courses are frozen and can never be assigned again. Courses are never deleted.",
    assignmentsTitle: "All assignments",
    assignmentsIntro:
      "Every assignment in the organisation. Open one to record a completion on someone's behalf or waive it, with a reason.",
    add: "New course",
    addTitle: "New course",
    editTitle: "Edit course",
    edit: "Edit",
    publish: "Publish",
    archive: "Archive",
    assign: "Assign",
    empty: "No courses yet",
    emptyBody: "Create the first course to start the catalogue.",
    emptyFiltered: "No courses match these filters",
    fields: {
      title: "Title",
      category: "Category",
      description: "Description",
      delivery: "Delivery mode",
      duration: "Duration in minutes",
      link: "External link (optional)",
      linkHint: "Must start with https://. The system only links to it.",
      mandatory: "Mandatory course",
      mandatoryHint:
        "Mandatory courses can only be assigned by HR; learners cannot enrol themselves.",
      validity: "Certification valid for (months, optional)",
      validityHint:
        "Leave empty if the course never expires. Otherwise completion sets an expiry date.",
    },
    archiveConfirm: "Archive this course?",
    publishedNote:
      "Published courses can still be edited. Archived courses cannot.",
  },
  assign: {
    title: "Assign this course",
    intro:
      "Choose who should take it. A department or location is a one-time snapshot of the people there today. Anyone who already has this course open is skipped.",
    target: "Assign to",
    targets: {
      employee: "One person",
      department: "A department",
      location: "A location",
    },
    searchPerson: "Find a person",
    searchPersonHint: "Type at least 2 letters of a name.",
    person: "Person",
    personNone: "Choose a person",
    noMatches: "No one matches that search.",
    unit: {
      department: "Department",
      location: "Location",
    },
    unitNone: "Choose one",
    unitEmpty: "No units are available.",
    unitPeople: (name: string, count: number) =>
      `${name} (${count} ${count === 1 ? "person" : "people"})`,
    unitLimit: "Showing the first 50 units; search is not available here.",
    due: "Due date",
    mandatory: "Mandatory for these people",
    submit: "Assign course",
    done: "Done",
    result: (assigned: number, skipped: number) =>
      `Assigned to ${assigned} ${assigned === 1 ? "person" : "people"}. Skipped ${skipped} who already had this course open.`,
    batch: "These assignments share one batch.",
    resultAgain: "Assign to someone else",
  },
  compliance: {
    title: "Compliance by course",
    intro:
      "Counts per course. The bar shows open work that is not yet due, overdue work, completions and waivers; the numbers are always in text. No names or notes appear in this report.",
    label: "Compliance report",
    asOf: (date: string) => `As of ${date}`,
    columns: {
      course: "Course",
      notStarted: "Not started",
      inProgress: "In progress",
      overdue: "Overdue",
      completed: "Completed",
      waived: "Waived",
      dueForRenewal: "Renewal due",
      expired: "Expired",
    },
    barLabel: (code: string) => `${code} progress`,
    empty: "No courses to report on",
    emptyBody: "Create and assign a course to see compliance counts.",
    emptyFiltered: "No courses match this filter",
    filter: "Course status",
    allStatuses: "All course statuses",
    total: (n: number) => `${n} assignment${n === 1 ? "" : "s"}`,
    noAssignments: "No assignments yet",
    mandatory: "Mandatory",
  },
};
