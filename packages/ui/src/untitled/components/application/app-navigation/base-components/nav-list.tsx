"use client";

// Vendored from the Untitled UI starter kit (MIT, see ../../../../LICENSE.md):
// app-navigation/base-components/nav-list.tsx (simple list with dividers and
// collapsible groups). Changes: relative imports, `linkClassName`, per-item
// `title`, and the invalid `<dd>` inside `<details>` replaced by a `<div>`.
import { cx } from "../../../../utils/cx";
import type { NavItemDividerType, NavItemType } from "../config";
import { NavItemBase } from "./nav-item";

interface NavListProps {
  /** URL of the currently active item. */
  activeUrl?: string;
  /** Additional CSS classes to apply to the list. */
  className?: string;
  /** Class added to every link, for host styling. */
  linkClassName?: string;
  /** List of items to display. */
  items: (NavItemType | NavItemDividerType)[];
}

export const NavList = ({
  activeUrl,
  items,
  className,
  linkClassName,
}: NavListProps) => {
  const activeItem = items.find(
    (item) =>
      item.href === activeUrl ||
      item.items?.some((subItem) => subItem.href === activeUrl),
  );

  return (
    <ul className={cx("flex flex-col px-4 pt-5", className)}>
      {items.map((item, index) => {
        if (item.divider) {
          return (
            <li key={index} role="presentation" className="w-full px-0.5 py-2">
              <hr className="h-px w-full border-none bg-border-secondary" />
            </li>
          );
        }

        if (item.items?.length) {
          return (
            <li key={item.label}>
              <details
                open={activeItem?.href === item.href}
                className="appearance-none py-0.25"
              >
                <NavItemBase
                  badge={item.badge}
                  icon={item.icon}
                  type="collapsible"
                  className={linkClassName}
                >
                  {item.label}
                </NavItemBase>
                <div>
                  <ul className="pb-1">
                    {item.items.map((childItem) => (
                      <li key={childItem.label} className="py-0.25">
                        <NavItemBase
                          href={childItem.href}
                          badge={childItem.badge}
                          type="collapsible-child"
                          current={activeUrl === childItem.href}
                          className={linkClassName}
                        >
                          {childItem.label}
                        </NavItemBase>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          );
        }

        return (
          <li key={item.label} className="py-px">
            <NavItemBase
              type="link"
              badge={item.badge}
              icon={item.icon}
              href={item.href}
              title={item.title}
              current={activeUrl === item.href}
              className={linkClassName}
            >
              {item.label}
            </NavItemBase>
          </li>
        );
      })}
    </ul>
  );
};
