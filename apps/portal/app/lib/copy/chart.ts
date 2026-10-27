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
};
