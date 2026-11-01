import type { EngReactionCode } from "@anvi/contracts";

// User-visible text for the Recognition and engagement (ENG-01) screen.
export const engageCopy = {
  title: "Recognition",
  subtitleSelf:
    "Thank a colleague for living a company value, see what others are celebrating, and answer short pulse surveys.",
  subtitleManage:
    "Run recognition for the company: keep the values, moderate posts, and run anonymous pulse surveys.",
  denied: "Recognition is available to employees, managers and HR.",
  limits:
    "Limits: recognition is a thank-you, with no points, cash value, rewards or leaderboard. There is no sentiment analysis and no AI, no comparison with other companies, and no trend charts across surveys. Nothing sends email, chat or push notifications, so check back here for new posts and surveys. Anonymity depends on group size: with only a few answers, people who know the team may still guess who said what, and free text can identify its author by what it says.",
  tabs: {
    label: "Recognition views",
    feed: "Feed",
    mine: "Mine",
    surveys: "Surveys",
    manage: "Manage",
  },
  common: {
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    saving: "Saving…",
    saveFailed: "Could not save the change. Try again.",
    previous: "Previous page",
    next: "Next page",
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    loading: "Loading…",
    you: "You",
    reason: "Reason",
    reasonHint: "3 to 500 characters.",
    allValues: "All values",
    value: "Value",
  },
  feed: {
    intro:
      "Recognition from across your company, newest first. Everyone in your company can see these posts.",
    give: "Give recognition",
    givenToday: (given: number, limit: number) =>
      `${given} of ${limit} given today`,
    capReached: (limit: number) =>
      `You have given your ${limit} for today. You can give more tomorrow (days count in UTC).`,
    emptyTitle: "No recognition yet",
    emptyBody:
      "Be the first to thank a colleague. A short, specific message goes a long way.",
    emptyFiltered: "Nothing for this value",
    emptyFilteredBody: "Try another value or show all values.",
    valueFilter: "Filter by company value",
    posted: "Recognition posted.",
    showing: (from: number, to: number, total: number) =>
      `Showing ${from}-${to} of ${total}`,
    from: "From",
    to: "To",
    yourPost: "You gave this",
    forYou: "For you",
    reactionsLabel: "Reactions",
    moderate: "Hide post",
    postLabel: (giver: string, recipient: string) =>
      `Recognition from ${giver} to ${recipient}`,
  },
  reactions: {
    thanks: "Thanks",
    applause: "Applause",
    inspiring: "Inspiring",
    helpful: "Helpful",
    celebrate: "Celebrate",
  } satisfies Record<EngReactionCode, string>,
  reactionFailed: "Could not update your reaction. Try again.",
  give: {
    title: "Give recognition",
    intro:
      "Thank a colleague in your company for living one of the values. Your name is shown on the post and everyone in your company can read it.",
    colleague: "Colleague",
    colleaguePlaceholder: "Search by name",
    colleagueHint: "Type at least two letters, then pick a name.",
    noColleagues: "No colleague matches that search.",
    value: "Company value",
    message: "Message",
    messageHint: "What did they do, and why did it matter?",
    counter: (used: number) => `${used}/280`,
    submit: "Post recognition",
    posting: "Posting…",
    chosen: (name: string) => `Recognising ${name}`,
    change: "Change colleague",
    noValues:
      "HR has not set up any company values yet, so recognition cannot be given.",
    needColleague: "Pick a colleague from the list.",
  },
  mine: {
    received: "Received",
    given: "Given",
    viewLabel: "Show",
    emptyReceived: "Nothing received yet",
    emptyReceivedBody:
      "When a colleague recognises you, it shows up here and in the feed.",
    emptyGiven: "You have not given recognition yet",
    emptyGivenBody:
      "Pick a colleague and a value and say thanks. It takes a minute.",
  },
  surveys: {
    intro:
      "Short, anonymous pulse surveys from HR. Each one can be answered once.",
    emptyTitle: "No surveys right now",
    emptyBody: "When HR publishes a survey for you, it appears here.",
    emptyHr: "No surveys yet",
    emptyHrBody: "Create a draft survey, then publish it to your colleagues.",
    columns: {
      title: "Survey",
      status: "Status",
      closes: "Closes",
      you: "You",
      answers: "Answers",
    },
    status: {
      draft: "Draft",
      published: "Open",
      closed: "Closed",
    },
    ended: "Window ended",
    notYetOpen: "Not open yet",
    closes: (when: string) => `Closes ${when}`,
    opens: (when: string) => `Opens ${when}`,
    responded: "You responded",
    respond: "Respond",
    notEligible: "Not for you",
    questions: (n: number) => `${n} ${n === 1 ? "question" : "questions"}`,
    responses: (responded: number, eligible: number) =>
      `${responded} of ${eligible} answered`,
    filterLabel: "Survey status",
    all: "All surveys",
    new: "New survey",
    edit: "Edit",
    publish: "Publish",
    close: "Close survey",
    results: "Results",
    rowLabel: (title: string) => `Survey: ${title}`,
    action: (verb: string, title: string) => `${verb}: ${title}`,
  },
  anonymity: {
    heading: "How anonymity works",
    body: "Your answers are stored without your name; results show only when at least 5 people answered and the survey has closed.",
    limits:
      "Anonymity depends on group size. With only a few answers, people who know the team may still guess how someone answered, and a free-text answer can give its author away by what it says. Do not write anything you would not want traced back to you.",
    seen: "HR sees only how many people answered, never who.",
  },
  respond: {
    title: (name: string) => name,
    submit: "Send my answers",
    sending: "Sending…",
    ratingLabel: "Rating from 1 (low) to 5 (high)",
    rating: (n: number) => `${n}`,
    textLabel: "Your answer (optional)",
    textCounter: (used: number) => `${used}/500`,
    required: "Required",
    optional: "Optional",
    needAll: "Answer every required question to send.",
    confirmTitle: "Answers received",
    confirmBody:
      "Thank you. Your answers are stored without your name. You cannot answer this survey again.",
    closed: "This survey is not accepting answers.",
    chooseOne: "Choose one",
    scaleLow: "1 is low",
    scaleHigh: "5 is high",
  },
  manage: {
    valuesHeading: "Company values",
    valuesIntro:
      "People choose one of the active values when they give recognition. Values are retired, never deleted, so old posts keep their value.",
    valueName: "Value name",
    valueSort: "Sort order",
    valueActive: "Active",
    addValue: "Add a value",
    editValue: "Edit value",
    newValue: "New value",
    active: "Active",
    retired: "Retired",
    nameHint: "2 to 40 characters.",
    hiddenHeading: "Hidden posts",
    hiddenIntro:
      "Posts HR has hidden. Nobody else sees them in the feed or in given and received lists. The reason is kept in the moderation history.",
    hiddenEmpty: "No hidden posts",
    hiddenEmptyBody: "Posts you hide appear here so you can restore them.",
    restore: "Restore post",
    restoreTitle: "Restore this post",
    restoreBody:
      "The post will return to the feed. Say why it is being restored.",
    hideTitle: "Hide this post",
    hideBody:
      "The post disappears from the feed for everyone except HR. The reason is kept in the moderation history, which only HR can read.",
    hideSubmit: "Hide post",
    restoreSubmit: "Restore post",
    history: "Moderation history",
    historyEmpty: "No moderation steps yet.",
    historyHide: "Hidden",
    historyRestore: "Restored",
    historyLine: (action: string, by: string, when: string) =>
      `${action} by ${by}, ${when}`,
    selfModeration:
      "You cannot hide or restore a post you gave or received. Ask another HR colleague to do it.",
    hiddenOn: (when: string) => `Hidden ${when}`,
  },
  editor: {
    newTitle: "New survey",
    editTitle: "Edit draft survey",
    surveyTitle: "Survey title",
    titleHint: "3 to 120 characters.",
    opens: "Opens",
    closes: "Closes",
    windowHint:
      "The window can be up to 92 days. A published survey cannot be edited or extended.",
    questions: "Questions",
    questionsHint:
      "1 to 12 questions. Rating and choice are required; text is optional.",
    addQuestion: "Add a question",
    removeQuestion: "Remove question",
    moveUp: "Move up",
    moveDown: "Move down",
    questionN: (n: number) => `Question ${n}`,
    prompt: "Question text",
    promptHint: "3 to 200 characters.",
    kind: "Type",
    kinds: {
      rating: "Rating 1 to 5",
      choice: "Single choice",
      text: "Short text",
    },
    options: "Options, one per line",
    optionsHint: "2 to 8 different options, up to 80 characters each.",
    save: "Save draft",
    saved: "Draft saved.",
    closeAfterOpen: "Close the survey after it opens and within 92 days.",
    needQuestions: "Add at least one question.",
    fixQuestion: (n: number) =>
      `Question ${n} needs text of 3 or more characters.`,
    fixOptions: (n: number) => `Question ${n} needs 2 to 8 different options.`,
  },
  confirm: {
    publishTitle: "Publish this survey",
    publishBody:
      "Everyone who is a current employee right now becomes eligible. People who join later cannot answer it. Questions are frozen once published.",
    publishSubmit: "Publish survey",
    closeTitle: "Close this survey",
    closeBody:
      "No more answers are accepted. If at least 5 people answered, the results are released to HR.",
    closeSubmit: "Close survey",
  },
  results: {
    title: (name: string) => `Results: ${name}`,
    responses: (n: number, eligible: number) =>
      `${n} of ${eligible} eligible people answered`,
    withheld: {
      draft: "Results are withheld: this survey is still a draft.",
      open: "Results are withheld: the survey is still open. They are released after it closes (a survey that closed by its end time releases results 2 minutes later), so results cannot be compared before and after one more person answers.",
      too_few_responses: (threshold: number) =>
        `Results are withheld: fewer than ${threshold} people answered, so any breakdown could point to individuals.`,
    },
    released: "Results are released. They cover the whole company only.",
    average: (value: number) => `Average ${value.toFixed(1)} out of 5`,
    noAverage: "No average",
    answered: (n: number) => `${n} answered`,
    score: (n: number) => `Score ${n}`,
    barLine: (label: string, count: number, total: number) =>
      `${label}: ${count} of ${total}`,
    texts: "Written answers, in random order",
    noTexts: "No written answers.",
    textNote:
      "Answers are shuffled and not tied to anyone, but what someone writes may still identify them.",
    openResults: "Open results",
  },
};
