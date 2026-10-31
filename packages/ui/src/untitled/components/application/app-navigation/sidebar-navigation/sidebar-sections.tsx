"use client";

// Vendored and adapted from the Untitled UI starter kit (MIT, see
// ../../../../LICENSE.md): sidebar-navigation/sidebar-sections-subheadings.tsx
// and sidebar-section-dividers.tsx. The kit versions are full page chrome (logo,
// account card, fixed positioning); here only the grouped list is kept, so the
// host shell supplies its own brand, workspace and account blocks. The simple,
// dual-tier and slim kit sidebars are not vendored: the portal keeps its own
// collapse-to-icons rail instead of a slim or dual-tier layout.
import { cx } from "../../../../utils/cx";
import type {
  NavItemDividerType,
  NavItemType,
  NavSectionType,
} from "../config";
import { NavItemBase } from "../base-components/nav-item";
import { NavList } from "../base-components/nav-list";

interface SidebarSectionsProps {
  /** URL of the currently active item. */
  activeUrl?: string;
  /** Groups, each with a sub-heading. */
  sections: NavSectionType[];
  /** Class added to every link, for host styling. */
  linkClassName?: string;
  /** Class for the sub-heading text. */
  headingClassName?: string;
  className?: string;
  /** Test for the active item; defaults to an exact match on `href`. */
  isCurrent?: (href: string | undefined) => boolean;
  /** Prefix that keeps heading ids unique when two lists are on one page. */
  idPrefix?: string;
}

/** Sidebar navigation with a sub-heading above each group of links. */
export const SidebarNavSections = ({
  activeUrl,
  sections,
  linkClassName,
  headingClassName,
  className,
  isCurrent,
  idPrefix = "nav-section",
}: SidebarSectionsProps) => (
  <ul className={cx("flex flex-col", className)}>
    {sections.map((group, index) => (
      <li key={group.label}>
        <div className="px-3 pb-1">
          <h3
            id={`${idPrefix}-${index}`}
            className={cx(
              "text-xs font-bold text-quaternary uppercase",
              headingClassName,
            )}
          >
            {group.label}
          </h3>
        </div>
        <ul aria-labelledby={`${idPrefix}-${index}`} className="pb-4">
          {group.items.map((item: NavItemType) => (
            <li key={item.label} className="py-0.25">
              <NavItemBase
                type="link"
                icon={item.icon}
                href={item.href}
                badge={item.badge}
                title={item.title}
                current={
                  isCurrent ? isCurrent(item.href) : item.href === activeUrl
                }
                className={linkClassName}
              >
                {item.label}
              </NavItemBase>
            </li>
          ))}
        </ul>
      </li>
    ))}
  </ul>
);

interface SidebarDividersProps {
  activeUrl?: string;
  items: (NavItemType | NavItemDividerType)[];
  linkClassName?: string;
}

/** Sidebar navigation with horizontal dividers between groups. */
export const SidebarNavDividers = ({
  activeUrl,
  items,
  linkClassName,
}: SidebarDividersProps) => (
  <NavList
    activeUrl={activeUrl}
    items={items}
    linkClassName={linkClassName}
    className="px-0 pt-0"
  />
);
