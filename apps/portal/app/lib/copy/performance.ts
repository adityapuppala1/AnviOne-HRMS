import type {
  PerfObjective,
  PerfCycle,
  PerfReview,
  PerfCompetency,
} from "@anvi/contracts";

type Goal = PerfObjective["status"];
type Cycle = PerfCycle["status"];
type Rev = PerfReview["status"];

// User-visible text for the Performance (PERF-01) screen.
export const performanceCopy = {
  title: "Performance",
  subtitleSelf:
    "Set goals with measurable key results, log progress, and write your self-review when a cycle opens.",
  subtitleReview:
    "Set goals for your team, follow their progress, and write manager reviews when a cycle is open.",
  subtitleManage:
    "See every goal, run review cycles and finalise each review with a reason.",
  denied:
    "Performance is available to employees, managers and HR. Switch role to continue.",
  limits:
    "Limits: no 360 or peer feedback, no calibration grid or forced ranking, no reminders or notifications (due dates are shown, not enforced), and results are not linked to pay. Ratings are typed in by people. Nothing here scores, suggests or summarises, and there is no AI.",
  tabs: {
    label: "Performance views",
    goals: "Goals",
    team: "Team goals",
    all: "All goals",
    myReviews: "My reviews",
    teamReviews: "Team reviews",
    cycles: "Review cycles",
    finalise: "Finalise",
  },
  stats: {
    active: "Active goals",
    activeHint: "Being worked on now",
    draft: "Draft goals",
    draftHint: "Not started yet",
    completed: "Completed goals",
    completedHint: "Finished",
  },
  common: {
    search: "Search",
    status: "Status",
    allStatuses: "All statuses",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    close: "Close",
    none: "None",
    unknown: "Not recorded",
    saveFailed: "Could not save the change. Try again.",
    stale:
      "This record changed since you opened it. Close it and open it again.",
    period: (start: string, end: string) => `${start} to ${end}`,
  },
  units: {
    number: "Number",
    percent: "Percent",
    currency: "Currency",
    hours: "Hours",
  },
  goal: {
    status: {
      draft: "Draft",
      active: "Active",
      completed: "Completed",
      cancelled: "Cancelled",
    } satisfies Record<Goal, string>,
    create: "New goal",
    createTitle: "New goal",
    editTitle: "Edit goal",
    empty: "No goals yet",
    emptyBody: "Goals you can see appear here.",
    emptyFiltered: "No goals match",
    emptyTeam: "No team goals yet",
    emptyTeamBody:
      "Goals set by you or by your direct reports appear here once they exist.",
    fields: {
      title: "Goal",
      description: "Description (optional)",
      periodStart: "Starts",
      periodEnd: "Ends",
      parent: "Aligns to (optional)",
      owner: "Goal for",
    },
    ownerHint:
      "Leave empty to set the goal for yourself. Managers can set goals for direct reports; HR for anyone.",
    periodLocked: "The period can only change while a goal is a draft.",
    parentNone: "Not aligned",
    parentUnavailable: "The list of goals to align to could not be loaded.",
    columns: {
      goal: "Goal",
      owner: "Owner",
      period: "Period",
      progress: "Progress",
      status: "Status",
    },
    cardKeyResults: (n: number) =>
      n === 0
        ? "No key results yet"
        : `${n} key ${n === 1 ? "result" : "results"}`,
    mine: "You",
    detail: {
      goal: "Goal",
      owner: "Owner",
      period: "Period",
      description: "Description",
      alignedTo: "Aligns to",
      alignedHidden: "A goal that is not visible to you",
      statusNote: "Status note",
      keyResults: "Key results",
      noKeyResults: "No key results yet. Add at least one before activating.",
      aligned: "Aligned goals",
      noAligned: "No visible goals are aligned to this one.",
      overall: "Overall progress",
      updated: "Updated",
    },
    actions: {
      edit: "Edit",
      activate: "Activate",
      complete: "Complete",
      cancel: "Cancel goal",
      addKeyResult: "Add key result",
      logProgress: "Log progress",
      showHistory: "Show history",
      hideHistory: "Hide history",
    },
    needsKeyResult: "Add a key result before activating this goal.",
    dialogs: {
      complete: {
        title: "Complete this goal?",
        body: "A completed goal is final: it can no longer be edited or receive progress.",
        label: "Note (optional)",
        submit: "Complete goal",
      },
      cancel: {
        title: "Cancel this goal?",
        body: "A cancelled goal is final. Say why, so the history stays clear.",
        label: "Reason",
        submit: "Cancel goal",
      },
    },
  },
  keyResult: {
    title: "Add a key result",
    note: "A key result is a measurable outcome. Targets can only be changed while the goal is a draft; progress is recorded as dated updates that are never edited.",
    fields: {
      title: "Key result",
      unit: "Unit",
      start: "Starting value",
      target: "Target value",
    },
    differ: "The target must differ from the starting value.",
    limit: "A goal can have up to 10 key results.",
    summary: (current: string, target: string) => `${current} of ${target}`,
    started: (start: string) => `Started at ${start}`,
    updates: (n: number) =>
      n === 0 ? "No updates yet" : `${n} ${n === 1 ? "update" : "updates"}`,
  },
  progress: {
    title: "Log progress",
    note: "This adds a dated update. Earlier updates are kept and cannot be changed.",
    value: "New value",
    comment: "Note (optional)",
    submit: "Log progress",
    history: "Progress history",
    historyEmpty: "No updates yet.",
    change: (from: string, to: string) => `${from} to ${to}`,
  },
  cycle: {
    status: {
      draft: "Draft",
      active: "Open",
      closed: "Closed",
      cancelled: "Cancelled",
    } satisfies Record<Cycle, string>,
    create: "New review cycle",
    createTitle: "New review cycle",
    editTitle: "Edit review cycle",
    empty: "No review cycles yet",
    emptyBody: "Create a cycle to start reviews.",
    emptyFiltered: "No cycles match",
    scopeAll: "Everyone in the entity with a manager",
    fields: {
      name: "Cycle name",
      periodStart: "Review period starts",
      periodEnd: "Review period ends",
      selfDue: "Self-reviews due",
      managerDue: "Manager reviews due",
      department: "Department",
    },
    wholeEntity: "Whole entity",
    lookupUnavailable:
      "The department list could not be loaded, so this cycle will cover the whole entity.",
    columns: {
      cycle: "Cycle",
      period: "Period",
      scope: "Scope",
      reviews: "Reviews",
      status: "Status",
    },
    cardReviews: (n: number) => `${n} ${n === 1 ? "review" : "reviews"}`,
    detail: {
      cycle: "Cycle",
      period: "Review period",
      selfDue: "Self-reviews due",
      managerDue: "Manager reviews due",
      scope: "Scope",
      reviews: "Reviews by stage",
      statusNote: "Status note",
      openedAt: "Opened",
      closedAt: "Closed",
      dueNote:
        "Due dates are shown but not enforced: late reviews are accepted while the cycle is open.",
    },
    actions: {
      edit: "Edit",
      open: "Open cycle",
      close: "Close cycle",
      cancel: "Cancel cycle",
    },
    dialogs: {
      open: {
        title: "Open this cycle?",
        body: "Opening creates one review for each active person in scope who has a manager. People without a manager are skipped and counted. Anyone who joins later is not added.",
        label: "Note (optional)",
        submit: "Open cycle",
      },
      close: {
        title: "Close this cycle?",
        body: "A cycle closes only when every review in it is finalised.",
        label: "Note (optional)",
        submit: "Close cycle",
      },
      cancel: {
        title: "Cancel this cycle?",
        body: "Only a draft cycle can be cancelled. Say why.",
        label: "Reason",
        submit: "Cancel cycle",
      },
    },
    opened: (name: string, generated: number, skipped: number) =>
      `${name} is open. ${generated} ${generated === 1 ? "review was" : "reviews were"} generated${
        skipped > 0
          ? ` and ${skipped} ${skipped === 1 ? "person was" : "people were"} skipped because they have no manager`
          : ""
      }.`,
    stage: {
      self_pending: "Waiting for self-review",
      manager_pending: "Waiting for manager",
      calibration: "Ready to finalise",
      finalised: "Finalised",
    } satisfies Record<Rev, string>,
  },
  review: {
    status: {
      self_pending: "Self-review due",
      manager_pending: "Manager review due",
      calibration: "Ready to finalise",
      finalised: "Finalised",
    } satisfies Record<Rev, string>,
    // What the employee is told, from their own point of view.
    mineStatus: {
      self_pending: "Your self-review is waiting for you",
      manager_pending: "Waiting for your manager's review",
      calibration: "With HR for the final rating",
      finalised: "Your result is ready",
    } satisfies Record<Rev, string>,
    empty: "No reviews yet",
    emptyMine:
      "You have no review. A review appears when HR opens a cycle that includes you, and only if you have a manager.",
    emptyTeam:
      "No manager reviews are waiting. They appear when HR opens a cycle that includes your direct reports.",
    emptyFinalise: "Nothing to finalise",
    emptyFiltered: "No reviews match",
    columns: {
      person: "Person",
      cycle: "Cycle",
      manager: "Manager",
      due: "Due",
      status: "Status",
    },
    cardManager: (name: string) => `Manager: ${name}`,
    cardDue: (self: string, manager: string) =>
      `Self due ${self} · manager due ${manager}`,
    finalRating: (n: number) => `Final rating ${n} of 5`,
    detail: {
      review: "Review",
      employee: "Employee",
      manager: "Manager",
      cycle: "Cycle",
      selfDue: "Self-review due",
      managerDue: "Manager review due",
      selfSubmitted: "Self-review submitted",
      managerSubmitted: "Manager review submitted",
      result: "Final result",
      finalRating: "Final rating",
      reason: "Reason",
      finalisedBy: "Finalised by",
      finalisedAt: "Finalised",
      entries: "Submitted reviews",
      noEntries: "No review text is visible to you yet.",
      overall: (value: string) => `Average of the five ratings: ${value}`,
      noComment: "No comment.",
      by: (name: string) => `By ${name}`,
      selfBy: (name: string) => `Self-review by ${name}`,
      managerBy: (name: string) => `Manager review by ${name}`,
      ofFive: (n: number) => `${n} of 5`,
    },
    competency: {
      quality: "Quality of work",
      delivery: "Delivery",
      collaboration: "Collaboration",
      ownership: "Ownership",
      growth: "Growth",
    } satisfies Record<PerfCompetency, string>,
    scale: {
      1: "1, needs a lot of improvement",
      2: "2, below expectations",
      3: "3, meets expectations",
      4: "4, above expectations",
      5: "5, outstanding",
    } as Record<number, string>,
    blind: {
      manager:
        "The self-review stays hidden until you submit your own manager review, so neither sways the other.",
      mine: "Your manager's review and the final rating stay hidden until HR finalises. This keeps both reviews independent.",
      mineDone:
        "Your self-review is in. Your manager's review will be visible here once HR finalises.",
    },
    fourEyes:
      "You cannot finalise this review because you are the employee or the reviewing manager. Another HR user must do it.",
    notYourTurn: "Waiting on someone else before this can be finalised.",
    actions: {
      self: "Write self-review",
      manager: "Write manager review",
      finalise: "Finalise review",
    },
    form: {
      selfTitle: "Your self-review",
      managerTitle: (name: string) => `Manager review for ${name}`,
      note: "Rate each area from 1 to 5. Submitted reviews cannot be changed.",
      ratingFor: (area: string) => `${area} rating`,
      comment: "Comment (optional)",
      submit: "Submit review",
      incomplete: "Rate all five areas to submit.",
    },
    finalise: {
      title: (name: string) => `Finalise review for ${name}`,
      note: "The final rating is your own judgement, informed by the two reviews. A finalised review cannot be changed.",
      rating: "Final rating",
      reason: "Reason for the rating",
      reasonHint: "10 to 500 characters.",
      submit: "Finalise",
    },
    ratingGroup: "Rating from 1 to 5",
  },
};
