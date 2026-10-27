import type { DocumentCategory, EmployeeDocument } from "@anvi/contracts";

export const documentsCopy = {
  denied:
    "Documents are available in employee, manager and HR workspaces. Switch role to continue.",
  title: "Your papers, kept private.",
  subtitleOwner:
    "Upload the documents HR asks for. Only you and HR can open them; your manager cannot.",
  subtitleReviewer:
    "Verify the documents people upload. Only the owner and HR can open them.",
  uploadButton: "Upload a document",
  tabs: {
    label: "Document views",
    mine: "Your documents",
    review: "Review",
  },
  categories: {
    identity: "Identity",
    education: "Education",
    employment: "Previous employment",
    other: "Other",
  } satisfies Record<DocumentCategory, string>,
  status: {
    pending: "Awaiting HR",
    verified: "Verified",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
  } satisfies Record<EmployeeDocument["status"], string>,
  row: {
    detail: (
      category: string,
      fileName: string,
      size: string,
      uploaded: string,
    ) => `${category}. ${fileName}, ${size}. Uploaded ${uploaded}.`,
    titleWithComma: (title: string) => `${title}, `,
    reviewNote: (status: string, by: string, note: string) =>
      `${status} by ${by}: ${note}`,
    download: "Download",
    downloadLabel: (title: string) => `Download ${title}`,
  },
  stats: {
    pending: "Pending",
    pendingHint: "With HR now",
    verified: "Verified",
    verifiedHint: "Checked and filed",
    rejected: "Rejected",
    rejectedHint: "Needs a replacement",
    waiting: "Waiting to verify",
    waitingHint: "Open and decide",
    recent: "Recently reviewed",
    recentHint: "Latest decisions",
  },
  mine: {
    heading: "Your documents",
    hint: "Newest first. Withdraw a file while HR has not reviewed it.",
    withdraw: "Withdraw",
    withdrawLabel: (title: string) => `Withdraw ${title}`,
    withdrawFailed: "Could not withdraw.",
    emptyTitle: "No documents yet",
    emptyBody: "Upload a PDF, PNG or JPEG of up to 5 MB.",
  },
  review: {
    pendingHeading: "Waiting for verification",
    pendingHint: "Open the file, check it, then verify or reject with a note.",
    emptyTitle: "Nothing to verify",
    emptyBody: "New uploads appear here and in Approvals.",
    verify: "Verify",
    verifyLabel: (title: string, employee: string) =>
      `Verify ${title} for ${employee}`,
    reject: "Reject",
    rejectLabel: (title: string, employee: string) =>
      `Reject ${title} for ${employee}`,
    recentHeading: "Recently reviewed",
    recentHint: "The latest 20 decisions and withdrawals.",
    saveFailed: "Could not save.",
    dialogTitle: "Reject this document?",
    dialogIntro: (employee: string) =>
      `${employee} will see your note and can upload a replacement.`,
    noteLabel: "What needs to change?",
    goBack: "Go back",
    saving: "Saving…",
    rejectSubmit: "Reject document",
  },
  upload: {
    chooseFile: "Choose a file to upload.",
    tooLarge: "Files can be up to 5 MB.",
    incomplete: "The upload did not complete. Try again.",
    failed: "Could not upload.",
    dialogTitle: "Upload a document",
    categoryLabel: "What is it?",
    titleLabel: "Title",
    titlePlaceholder: "For example, Passport",
    fileLabel: "File",
    hint: "PDF, PNG or JPEG, up to 5 MB. Use synthetic files in this preview.",
    cancel: "Cancel",
    uploading: "Uploading…",
    submit: "Upload",
  },
};
