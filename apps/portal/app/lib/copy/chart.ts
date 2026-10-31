// English copy for the Org chart screen (ORG-02). Keys are stable for later locale resources.
export const chartCopy = {
  noAccess: "The org chart needs access to the people directory.",
  eyebrow: "Directory",
  heading: "Org chart",
  intro: "Who reports to whom, shown from your current view of the company.",
  scope: {
    entity: "This chart shows everyone in the legal entity.",
    team: "This chart shows you and your direct reports.",
    self: "This chart shows only you.",
  },
  total: (count: number) =>
    `${count} ${count === 1 ? "person" : "people"} in this chart`,
  partialTitle: "Partial chart",
  partial:
    "This chart reached its depth or size limit, or a reporting loop was cut, so some people further down are not drawn.",
  searchLabel: "Search the chart",
  searchPlaceholder: "Name, job title or department",
  clearSearch: "Clear search",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  treeLabel: "Reporting tree",
  matches: (shown: number) =>
    `${shown} ${shown === 1 ? "match" : "matches"}. Matches are highlighted with the people they sit under.`,
  noMatchesTitle: "No one matches that search",
  noMatchesBody: "Try a different name, title or department, or clear it.",
  emptyTitle: "No one to show yet",
  emptyBody: "People appear here once they have an active employment record.",
  directReports: (count: number) =>
    count === 0
      ? "No direct reports"
      : `${count} direct ${count === 1 ? "report" : "reports"}`,
  reportsToggle: (name: string) => `Direct reports of ${name}`,
  onNotice: "On notice",
  noDepartment: "No department",
  noTitle: "No job title",
  loadFailed: "The org chart could not be loaded.",
  intro2:
    "Find anyone, see who they report to and who reports to them, then follow the lines.",
  visibility:
    "Everyone in the organization can see names, titles, departments and reporting lines here; no contact details.",
  find: {
    label: "Find anyone in the organization",
    placeholder: "Search by name, title or department",
    hint: "Type at least 2 letters. Use Up and Down to move, Enter to choose, Escape to close.",
    listLabel: "People found",
    searching: "Searching…",
    results: (count: number) =>
      `${count} ${count === 1 ? "person" : "people"} found. Use Up and Down to review.`,
    none: "No one found for that search. Try part of a name, title or department.",
    tooShort: "Type at least 2 letters to search.",
    rateLimited:
      "Too many searches in a short time. Wait a moment, then try again.",
    forbidden:
      "Your sign-in has no employee record, so the organization search is not available to you.",
    unavailable: "Search is unavailable right now. Try again shortly.",
    failed: "The search could not be completed. Try again.",
    clear: "Clear search",
    shown: (name: string) => `Showing ${name} and their reporting lines.`,
  },
  views: {
    label: "Org chart views",
    network: "Network",
    threeD: "3D",
    list: "List",
    whole: "Whole tree",
  },
  orientation: {
    label: "Chart orientation",
    vertical: "Vertical view",
    horizontal: "Horizontal view",
  },
  focusBar: {
    mine: "Go to my position",
    manager: "Show manager's team",
    managerAbove: "Their manager has a manager above",
    reset: "Back to me",
  },
  neighborhood: (name: string, manager: string | null, reports: number) =>
    `${name}${manager ? ` reports to ${manager}` : " has no manager shown"}, with ${reports} direct ${reports === 1 ? "report" : "reports"}.`,
  loadingNeighborhood: "Loading reporting lines…",
  neighborhoodForbidden:
    "Your sign-in has no employee record, so reporting lines cannot be shown for you. Ask HR to link your account.",
  neighborhoodUnavailable:
    "Reporting lines are unavailable right now. Try again shortly.",
  neighborhoodFailed: "Reporting lines could not be loaded.",
  unknownPerson: "That person could not be found.",
  truncated: (shown: number, total: number) =>
    `Showing ${shown} of ${total} reports. Use search to find someone specific.`,
  roles: {
    manager: "Manager",
    focus: "Selected person",
    reports: "Direct reports",
    you: "You",
  },
  noManager: "No manager shown",
  noReports: "No direct reports",
  list: {
    heading: "Reporting lines",
    reportsTo: "Reports to",
    person: "Selected person",
    reports: (count: number) => `Direct reports (${count})`,
    show: (name: string) => `Show ${name}`,
    intro:
      "The same information as the visual views, as plain text. Choose a person to move the chart to them.",
  },
  node: {
    youBadge: "You",
    reports: (count: number) =>
      count === 0
        ? "No reports"
        : `${count} ${count === 1 ? "report" : "reports"}`,
  },
  zoom: {
    group: "Zoom",
    in: "Zoom in",
    out: "Zoom out",
    fit: "Fit to screen",
    level: (pct: number) => `Zoom ${pct}%`,
    canvasLabel: "Org chart canvas",
    roleDescription: "interactive org chart",
    help: "Plus and minus zoom, zero fits the chart to the screen, arrow keys move it, Home returns to you. Tab moves between people and Enter shows their reporting lines. Scroll or pinch to zoom, drag to move.",
  },
  three: {
    tabHint: "3D view",
    canvasLabel: "3D org chart",
    roleDescription: "3D org chart",
    layerManager: "Manager layer",
    layerFocus: "Focus layer",
    layerYou: "You layer",
    layerReports: "Reports layer",
    reset: "Reset view",
    help: "Drag to turn the scene, scroll or pinch to zoom, right-drag or Shift-drag to move it. With the keyboard: plus and minus zoom, arrow keys turn it, Shift with arrows moves it, zero resets, left and right square brackets choose a person and Enter shows their reporting lines.",
    selected: (name: string, title: string) =>
      `Selected ${name}${title ? `, ${title}` : ""}. Press Enter to show their reporting lines.`,
    more: (count: number) =>
      `+${count} more. Use List or search to see everyone.`,
    capped: (shown: number, total: number) =>
      `The 3D view draws the first ${shown} of ${total} reports. The List view and search show everyone.`,
    noWebgl:
      "3D needs WebGL, which is not available in this browser or device. The Network and List views show the same information.",
    switchNetwork: "Switch to Network view",
    loading: "Preparing the 3D scene…",
  },
};
