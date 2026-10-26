import type { Theme } from "@anvi/contracts";

export const settingsCopy = {
  denied:
    "Workspace settings require the Platform admin role. Switch to an assigned role to continue.",
  saveFailed: "Settings could not be saved.",
  eyebrow: "Organization identity",
  title: "Your workspace. Your signature.",
  subtitle: "Choose the names and colors your people come home to.",
  version: (version: number | string) => `Version ${version}`,
  essentials: "The essentials",
  fields: {
    organizationName: {
      label: "Organization name",
      help: "Shown in your workspace navigation.",
    },
    platformName: {
      label: "Platform name",
      help: "The name for your HR and administration workspace.",
    },
    employeeName: {
      label: "Employee workspace name",
      help: "A familiar name for the employee experience.",
    },
  },
  palette: {
    legend: "Workspace palette",
    hint: "Considered colors, with readable contrast.",
    names: {
      ocean: "Atlas",
      iris: "Iris",
      forest: "Woodland",
    } satisfies Record<Theme, string>,
  },
  published: "Workspace settings published.",
  discard: "Discard changes",
  publishing: "Publishing…",
  publish: "Publish changes",
  preview: {
    eyebrow: "Your workspace, previewed",
    desktop: "Desktop preview",
    mobile: "Mobile preview",
    overview: "Overview",
    people: "People",
    teams: "Teams",
    welcomeTo: "Welcome to",
    connected: "Your people, connected.",
    note: "Your names and palette update throughout the workspace when you publish.",
  },
};

export const preferencesCopy = {
  eyebrow: "Make room for your way of working",
  title: "A space that suits you.",
  subtitle: "Your display preferences apply on this browser.",
  saved: "Saved automatically",
  appearance: {
    legend: "Appearance",
    hint: "Choose your light. Follow your device, or set your own.",
    light: "Light",
    dark: "Dark",
    system: "System",
  },
  density: {
    legend: "Workspace density",
    hint: "Adjust the space between rows and cards.",
    comfortable: { label: "Comfortable", description: "More breathing room" },
    compact: { label: "Compact", description: "More in one view" },
  },
  motion: {
    heading: "Reduce motion",
    body: "Keep transitions and decorative effects still. Your device's reduced-motion setting is always respected.",
  },
  sample: {
    badge: "Live preview",
    titleLine1: "Your workspace,",
    titleLine2: "your rhythm.",
    rows: [
      { label: "People directory", initials: "MI" },
      { label: "Team explorer", initials: "NR" },
      { label: "Work profile", initials: "AS" },
    ],
  },
  aside:
    "Appearance changes are personal. Organization branding is managed separately by your platform admin.",
};
