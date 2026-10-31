"use client";

// Vendored from the Untitled UI starter kit (MIT, see ../../../../LICENSE.md):
// app-navigation/base-components/nav-item.tsx. Changes: relative imports, a
// `className` and `title` pass-through so the Anvi Loom rail can style it, and
// a 44px minimum height instead of the kit's fixed 36px.
import type {
  FC,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
  RefAttributes,
} from "react";
import { ChevronDown } from "@untitledui/icons";
import type { LinkProps as AriaLinkProps } from "react-aria-components";
import { Link as AriaLink } from "react-aria-components";
import { Badge } from "../../../base/badges/badges";
import { cx, sortCx } from "../../../../utils/cx";

const styles = sortCx({
  root: "group relative flex min-h-11 w-full cursor-pointer items-center rounded-md bg-primary outline-focus-ring transition duration-100 ease-linear select-none hover:bg-primary_hover focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2",
  rootSelected: "bg-secondary hover:bg-secondary_hover",
});

interface NavItemCommonProps {
  /** Icon component to display. */
  icon?: FC<HTMLAttributes<HTMLOrSVGElement>>;
  /** Badge to display. */
  badge?: ReactNode;
  /** Whether the nav item is currently active. */
  current?: boolean;
  /** Whether to truncate the label text. */
  truncate?: boolean;
  /** Handler for click events. */
  onClick?: MouseEventHandler;
  /** Extra class names for the root element. */
  className?: string;
  /** Content to display. */
  children?: ReactNode;
}

export interface NavItemCollapsibleProps extends NavItemCommonProps {
  type: "collapsible";
}

export interface NavItemLinkProps
  extends
    NavItemCommonProps,
    Omit<AriaLinkProps, "children" | "className" | "onClick">,
    RefAttributes<HTMLAnchorElement> {
  type: "link" | "collapsible-child";
  href?: AriaLinkProps["href"];
  title?: string;
}

export type NavItemBaseProps = NavItemCollapsibleProps | NavItemLinkProps;

export const NavItemBase = (props: NavItemBaseProps) => {
  const {
    icon: Icon,
    badge,
    current,
    truncate = true,
    onClick,
    className,
    children,
    ...rest
  } = props;

  const iconElement = Icon && (
    <Icon
      aria-hidden="true"
      className={cx(
        "mr-2 size-5 shrink-0 text-fg-quaternary transition-inherit-all group-hover/item:text-fg-quaternary_hover",
        current && "text-fg-quaternary_hover",
      )}
    />
  );

  const badgeElement =
    badge && (typeof badge === "string" || typeof badge === "number") ? (
      <Badge className="ml-3" color="gray" type="pill-color" size="sm">
        {badge}
      </Badge>
    ) : (
      badge
    );

  const labelElement = (
    <span
      className={cx(
        "flex-1 text-sm font-semibold text-secondary transition-inherit-all group-hover/item:text-secondary_hover",
        truncate && "truncate",
        current && "text-secondary_hover",
      )}
    >
      {children}
    </span>
  );

  if (rest.type === "collapsible") {
    return (
      <summary
        className={cx(
          "p-2",
          styles.root,
          current && styles.rootSelected,
          className,
        )}
        onClick={onClick}
      >
        {iconElement}
        {labelElement}
        {badgeElement}
        <ChevronDown
          aria-hidden="true"
          className="ml-3 size-4 shrink-0 stroke-[2.5px] text-fg-quaternary in-open:-scale-y-100"
        />
      </summary>
    );
  }

  const { type, href, isDisabled, ...linkProps } = rest;

  return (
    <AriaLink
      aria-current={current ? "page" : undefined}
      {...linkProps}
      // Dropping `href` when disabled prevents navigation via middle-click or "open in new tab".
      href={isDisabled ? undefined : href}
      isDisabled={isDisabled}
      onClick={onClick}
      className={cx(
        type === "collapsible-child" ? "py-2 pr-3 pl-10" : "group/item p-2",
        styles.root,
        current && styles.rootSelected,
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {type === "link" && iconElement}
      {labelElement}
      {badgeElement}
    </AriaLink>
  );
};
