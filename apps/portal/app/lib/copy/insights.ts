// Insights and the Help centre. Plain words, written for the person using them.
const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const insightsCopy = {
  title: "Your workforce, at a glance.",
  scope: {
    entity: "Figures cover everyone in your organization.",
    team: "Figures cover you and your direct reports.",
  },
  statsLabel: "Key figures",
  denied: "Insights are available to managers and HR.",
  unavailable: "Insights could not be loaded.",
  stats: {
    people: { label: "People", hint: "Active or on notice" },
    joiners: { label: "Joined recently", hint: "In the last 90 days" },
    away: { label: "On leave today", hint: "Approved leave covering today" },
    pending: { label: "Leave awaiting a decision", hint: "Open requests" },
  },
  charts: {
    department: {
      title: "People by department",
      description: "Where your people work.",
      label: "Number of people",
    },
    location: {
      title: "People by location",
      description: "Where your people are based.",
      label: "Number of people",
    },
    joiners: {
      title: "Joining over six months",
      description: "New joiners by month.",
      label: "Joiners",
    },
    leaveMonth: (year: number) => ({
      title: `Leave taken in ${year}`,
      description: "Approved leave days by month.",
      label: "Days",
    }),
    attendance: {
      title: "Check-ins, last 14 days",
      description: "People who checked in each day.",
      label: "Checked in",
    },
    leaveType: {
      title: "Leave by type",
      description: "Approved days this year.",
      none: "No approved leave yet this year.",
    },
  },
  empty: {
    title: "Nothing to chart yet",
    description: "Figures appear as people join, take leave and check in.",
  },
  dataTable: "Show the figures as a table",
  tableColumns: { label: "Label", value: "Value" },
  days: (value: number) =>
    `${Number.isInteger(value) ? value : value.toFixed(1)} ${value === 1 ? "day" : "days"}`,
  month: (iso: string) => {
    const [year, month] = iso.split("-");
    return `${monthNames[Number(month) - 1] ?? month} ${year?.slice(2)}`;
  },
  day: (iso: string) => {
    const [, month, day] = iso.split("-");
    return `${Number(day)} ${monthNames[Number(month) - 1] ?? month}`;
  },
};

export const helpCopy = {
  title: "Help centre",
  description: "Short answers for everyday tasks. Search, or browse by topic.",
  search: "Search help",
  searchPlaceholder: "Search for leave, check in, documents…",
  results: (count: number) =>
    `${count} ${count === 1 ? "answer" : "answers"} found`,
  noResults: {
    title: "No answers match your search",
    description:
      "Try a shorter word, or clear the search to browse every topic.",
    clear: "Clear search",
  },
  shortcuts: {
    title: "Keyboard shortcuts",
    items: [
      { keys: "Ctrl K  or  ⌘ K", does: "Search people and pages" },
      { keys: "?", does: "Open the workspace guide" },
      { keys: "Esc", does: "Close a dialog or menu" },
      { keys: "Tab", does: "Move to the next control" },
    ],
  },
  topics: [
    {
      id: "start",
      title: "Getting started",
      articles: [
        {
          q: "How do I switch my workspace role?",
          a: "Open your profile button at the top right and choose a role. Each role shows only what it is allowed to see, so the menu and pages change when you switch.",
        },
        {
          q: "How do I find a person or a page quickly?",
          a: "Press Ctrl K (or ⌘ K on a Mac), or use the search button at the top. Type a name, a team or a page such as Leave.",
        },
        {
          q: "Can I change how the workspace looks?",
          a: "Yes. Open Display preferences to switch between light and dark, choose a compact layout, collapse the navigation or reduce motion.",
        },
      ],
    },
    {
      id: "leave",
      title: "Leave",
      articles: [
        {
          q: "How do I request leave?",
          a: "Open Leave, choose Request leave, pick the type and dates and add a short reason. Days are counted using your office's working week and holidays, so a holiday inside your dates is not charged.",
        },
        {
          q: "Who decides my request?",
          a: "Your manager decides when you have one; otherwise HR does. The request shows who decides. Nobody can decide their own request.",
        },
        {
          q: "Where do I see how much leave I have left?",
          a: "Your balance for each leave type is at the top of the Leave page. Days awaiting a decision are held until it is decided.",
        },
      ],
    },
    {
      id: "attendance",
      title: "Attendance",
      articles: [
        {
          q: "How do I check in and out?",
          a: "Open Attendance and choose Check in when you start, then Check out when you finish. The time is recorded by the server, so it cannot be changed by hand.",
        },
        {
          q: "I forgot to check in. What can I do?",
          a: "Select that day in the last 30 days and ask for a correction with a reason. It goes to your manager or HR for a decision.",
        },
      ],
    },
    {
      id: "approvals",
      title: "Approvals",
      articles: [
        {
          q: "Where do decisions wait for me?",
          a: "Open Approvals. Leave, attendance corrections, document checks and onboarding reviews that need you appear in one list, and the number beside Approvals shows how many are waiting.",
        },
        {
          q: "Why can't I decide some items?",
          a: "Some items are routed to HR, and you can never decide something you raised yourself. Those items are shown as routed elsewhere.",
        },
      ],
    },
    {
      id: "documents",
      title: "Documents",
      articles: [
        {
          q: "Which files can I upload?",
          a: "PDF, PNG or JPEG files up to 5 MB. The file type is checked from the file itself, and PDFs with scripts or embedded files are not accepted.",
        },
        {
          q: "What happens after I upload?",
          a: "HR verifies the document. Until then it is pending and you can withdraw it. You can download your own documents at any time.",
        },
      ],
    },
    {
      id: "holidays",
      title: "Holidays",
      articles: [
        {
          q: "Where is the holiday calendar?",
          a: "Open Holidays to see your office's working week and holidays for the year. HR maintains it, and it feeds how leave days are counted.",
        },
      ],
    },
    {
      id: "devices",
      title: "Phones, tablets and accessibility",
      articles: [
        {
          q: "Does it work on my phone?",
          a: "Yes. On a phone a bar at the bottom gives quick access to the main pages, and More opens the full menu. Tablets and desktops keep the side navigation.",
        },
        {
          q: "Can I use it with a keyboard or screen reader?",
          a: "Yes. Every action works from the keyboard, focus is always visible, and decorative effects are hidden from screen readers.",
        },
        {
          q: "Can I turn off the animations?",
          a: "Turn on Reduce motion in Display preferences, or in your device's accessibility settings. The globe and other effects then stay still.",
        },
      ],
    },
    {
      id: "privacy",
      title: "Your information",
      articles: [
        {
          q: "Is the data in this workspace real?",
          a: "The demo workspace contains only synthetic people and records. Nothing in it describes a real person.",
        },
      ],
    },
  ],
};
