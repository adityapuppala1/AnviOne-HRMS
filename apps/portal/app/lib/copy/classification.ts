export const classificationCopy = {
  fields: {
    designation: "Job designation",
    grade: "Grade",
    costCenter: "Cost centre",
  },
  notSet: "Not set",
  restricted: "Grade and cost centre are visible to HR and the employee.",
  edit: "Edit classification",
  title: (name: string) => `Edit classification for ${name}`,
  intro:
    "Choose the designation, grade and cost centre for this person. Only records in effect today can be picked.",
  none: "None",
  placeholder: "Choose one",
  loadFailed: "The list of records could not be loaded. Try again.",
  moreUnits:
    "More records exist than are listed here. Add or rename records in Organization to reach them.",
  reason: "Reason for change",
  reasonHint: "Explain the change in 10–300 characters.",
  reasonInvalid: "Enter a reason of 10 to 300 characters.",
  cancel: "Cancel",
  saving: "Saving…",
  save: "Save classification",
  saved: "Classification saved.",
  unchanged: "Nothing changed",
  errors: {
    forbidden: "Only HR can change a person's classification.",
    notFound: "This person could not be found.",
    stale:
      "Someone else changed this classification. The latest values are shown; review them and try again.",
    failed: "The classification could not be saved. Try again.",
  },
};
