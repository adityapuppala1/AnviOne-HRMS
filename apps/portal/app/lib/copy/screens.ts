const person = (count: number) => (count === 1 ? "person" : "people");

export const homeCopy = {
  summaryLabel: "Workspace summary",
  greeting: (firstName: string | undefined) =>
    `Good to see you, ${firstName ?? ""}`,
  summary: (total: number, teams: number) =>
    `${total} ${person(total)} across ${teams} teams, woven into one workspace.`,
  stats: {
    yourProfile: "Your profile",
    peopleInWorkspace: "People in your workspace",
    departments: "Departments",
    departmentsNote: "Find the team behind the work",
    locations: "Work locations",
    locationsNote: "Connected across your locations",
  },
  recent: {
    title: "New faces, shared purpose",
    subtitle: "Recently joined in your current workspace.",
    viewPeople: "View people",
    colleague: "Colleague",
    department: "Department",
    empty: "No people are visible in this workspace.",
    footnote: (total: number) =>
      `Ordered by joining date · ${total} ${person(total)} in scope`,
  },
  composition: {
    title: "The shape of your team",
    subtitle: "Select a department to explore.",
  },
  locations: {
    title: "A shared place to work",
    subtitle: "People by work location.",
    explore: "Explore",
    count: (count: number) => `${count} ${person(count)}`,
  },
  shortcut: {
    eyebrow: "Your place in the picture",
    title: "Your work profile",
    subtitle: "Work details. Your team. All together.",
    badge: "View profile",
  },
  admin: {
    eyebrow: "Your workspace, in focus",
    subtitleAuditor: "A clear record of your workspace's activity.",
    subtitleAdmin: "Shape the everyday experience for your organization.",
    badgeAuditor: "Auditor workspace",
    badgeAdmin: "Platform admin workspace",
    titleAuditor: "Every change has a story.",
    titleAdmin: "Make AnviOne your own.",
    bodyAuditor:
      "Review sign-ins, role changes and published settings. Filter the record and open an event for its details.",
    bodyAdmin:
      "Choose a palette, update your workspace names and preview the result before publishing.",
    actionAuditor: "View activity",
    actionAdmin: "Customize workspace",
    note: (auditor: boolean) =>
      `This role manages ${auditor ? "activity records" : "workspace configuration"}. Switch to an assigned people role to open employee records.`,
  },
};

export const profileCopy = {
  emailCopied: "Email copied",
  copyUnavailable: "Copy unavailable. Select and copy the email below.",
  backToPeople: "Back to people",
  pageLabel: "Employee profile",
  banner: "Every person brings a perspective.",
  status: {
    activeEmployee: "Active employee",
    notice: "Notice period",
    active: "Active",
  },
  copyEmail: "Copy work email",
  sectionsLabel: "Profile sections",
  tabs: {
    overview: "Overview",
    employment: "Employment",
  },
  overview: {
    title: "The essentials",
    description: "Work details to help you connect.",
    fullName: "Full name",
    workEmail: "Work email",
    department: "Department",
    workLocation: "Work location",
  },
  employment: {
    title: "Employment record",
    description: "Current work assignment and joining details.",
    code: "Employee code",
    designation: "Designation",
    joiningDate: "Joining date",
    status: "Employment status",
    milestone: "Joined the organization",
  },
  privacy:
    "This profile contains work details. Personal and confidential records are not part of the directory.",
  aside: {
    eyebrow: "Part of the team",
    description: "Explore colleagues visible in your workspace.",
    viewDepartment: "View department",
    since: "With the organization since",
  },
};

export const teamsCopy = {
  noAccess: "Your current workspace does not include team or people access.",
  eyebrow: "Different talents. Shared direction.",
  title: "Meet the bigger picture.",
  subtitleEmployee: "Your department and location, based on your own profile.",
  subtitleOther: "Explore the departments and locations within your access.",
  inScope: (total: number) => `${total} ${person(total)} in scope`,
  exploreLabel: "Explore your organization",
  tabs: {
    departments: "Departments",
    locations: "Locations",
  },
  card: {
    inWorkspace: (count: number) =>
      `${count} ${person(count)} in your workspace`,
    share: (percent: number) => `${percent}% of scope`,
  },
  empty: {
    title: (kind: string) => `No ${kind} to show`,
    detail: "Visible assignments will appear here.",
  },
  breakdown: {
    title: "Connected by people",
    subtitle: "Your department composition.",
    note: "Counts reflect your current role. They may represent part of a department or location.",
  },
};

export const peopleCopy = {
  noAccess:
    "This workspace does not include access to the people directory. Choose an assigned people workspace to continue.",
  eyebrow: "People directory",
  searchLabel: "Search directory",
  searchPlaceholder: "Search by name, role, or team…",
  department: "Department",
  location: "Location",
  allDepartments: "All departments",
  allLocations: "All locations",
  total: (total: number | undefined) =>
    `${total ?? "…"} ${total === 1 ? "person" : "people"}`,
  workspaceSuffix: " · Your current workspace",
  clearFilters: "Clear filters",
  displayLabel: "Directory display",
  gridView: "Grid view",
  listView: "List view",
  page: (page: number, pages: number) => `Page ${page} of ${pages}`,
  previousLabel: "Previous page",
  previous: "Previous",
  nextLabel: "Next page",
  next: "Next",
};

export const loginCopy = {
  signInFailed: "Unable to sign in.",
  story: {
    title: "Every person, woven into one workspace.",
    body: "Find colleagues, guide new joiners and keep your organization in step, all from one place.",
    footerBrand: "AnviOne / MyAnvi",
    footerTagline: "Made for your people",
  },
  useLightTheme: "Use light theme",
  useDarkTheme: "Use dark theme",
  badge: "Your people workspace",
  welcome: "Welcome to AnviOne.",
  welcomeSubtitle: "Settle in. Your workday starts here.",
  demoNote: {
    title: "A workspace to explore",
    body: "Meet a synthetic team, switch roles and try the experience. No real employee data.",
  },
  verifyFailed:
    "We could not verify your access. Try again or contact your HR team.",
  tooManyRequests: "Too many sign-in requests. Wait a minute, then try again.",
  serviceUnavailable: "The sign-in service is unavailable.",
  retrying: "Trying again…",
  retry: "Try again",
  preparing: "Preparing sign-in…",
  openingDemo: "Opening your workspace…",
  exploreDemo: "Explore demo workspace",
  microsoft: "Sign in with Microsoft",
  helpIdentity: "Use the company identity approved by your HR team.",
  helpInvite: "New here? Your account starts with an invitation.",
  accessNote: "Access is limited to your assigned workspace.",
  footerBrand: "AnviOne · People, connected.",
  signInHelp: "Sign-in help",
  help: {
    title: "Getting into your workspace",
    teamQuestion: "Already part of the team?",
    teamAnswer:
      "Use the company account approved by HR. If sign-in fails, ask HR or your identity administrator to confirm your access.",
    joiningQuestion: "Joining the organization?",
    joiningAnswer:
      "Employee access begins after HR approves your activation and binds your company identity. There is no public signup.",
    previewQuestion: "Exploring the preview?",
    previewAnswer:
      "The demo opens a synthetic HR workspace. Use your avatar to try other assigned roles.",
  },
};

export const notFoundCopy = {
  eyebrow: "404 · PAGE NOT FOUND",
  title: "Let’s get you back to your workspace.",
  body: "This page may have moved, or the address may be incomplete.",
  home: "Return home",
};
