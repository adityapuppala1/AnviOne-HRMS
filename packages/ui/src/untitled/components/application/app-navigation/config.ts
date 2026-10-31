// Vendored from the Untitled UI starter kit (MIT, see ../../../LICENSE.md):
// src/components/application/app-navigation/config.ts
import type { FC, ReactNode } from "react";

export type NavItemType = {
  /** Label text for the nav item. */
  label: string;
  /** URL to navigate to when the nav item is clicked. */
  href?: string;
  /** Icon component to display. */
  icon?: FC<{ className?: string }>;
  /** Badge to display. */
  badge?: ReactNode;
  /** Title attribute (tooltip) for the link. Added for the collapsed rail. */
  title?: string;
  /** List of sub-items to display. */
  items?: {
    label: string;
    href: string;
    icon?: FC<{ className?: string }>;
    badge?: ReactNode;
  }[];
  /** Whether this nav item is a divider. */
  divider?: boolean;
};

export type NavItemDividerType = Omit<
  NavItemType,
  "icon" | "label" | "divider"
> & {
  /** Label text for the divider. */
  label?: string;
  /** Whether this nav item is a divider. */
  divider: true;
};

export type NavSectionType = {
  /** Sub-heading shown above the group. */
  label: string;
  items: NavItemType[];
};
