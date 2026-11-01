"use client";

// Menu compositions built from the vendored Untitled UI `Dropdown` primitives
// (MIT, see ../../../LICENSE.md). The starter kit ships these as demo files
// (dropdown-icon-simple, dropdown-context-menu-simple, and the sub-menu
// flyout); this file folds them into data-driven components so screens pass
// actions instead of copying markup. Hand-composed from kit parts.
import { type FC, type ReactNode, useRef, useState } from "react";
import {
  Button as AriaButton,
  type Key,
  Popover as AriaPopover,
} from "react-aria-components";
import { DotsVertical } from "@untitledui/icons";
import { cx } from "../../../utils/cx";
import { Dropdown } from "./dropdown";

export type MenuAction = {
  id: string;
  label: string;
  icon?: FC<{ className?: string }>;
  /** Right-aligned hint such as a shortcut. */
  addon?: string;
  isDisabled?: boolean;
  /** Run when chosen. Ignored when `items` is set. */
  onAction?: () => void;
  /** Nested actions open as a flyout sub-menu. */
  items?: MenuAction[];
  /** Draw a separator above this action. */
  separatorBefore?: boolean;
};

function renderActions(actions: MenuAction[]): ReactNode {
  return actions.map((action) => {
    const item = action.items?.length ? (
      <Dropdown.Submenu key={action.id}>
        <Dropdown.Item
          id={action.id}
          label={action.label}
          icon={action.icon}
          isDisabled={action.isDisabled}
        />
        <Dropdown.Popover placement="right top" className="w-56">
          <Dropdown.Menu onAction={(key) => run(action.items!, key)}>
            {renderActions(action.items)}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Submenu>
    ) : (
      <Dropdown.Item
        key={action.id}
        id={action.id}
        label={action.label}
        icon={action.icon}
        addon={action.addon}
        isDisabled={action.isDisabled}
      />
    );
    return action.separatorBefore ? (
      <div key={action.id}>
        <Dropdown.Separator />
        {item}
      </div>
    ) : (
      item
    );
  });
}

function run(actions: MenuAction[], key: Key) {
  actions.find((a) => a.id === key)?.onAction?.();
}

/**
 * Icon-button menu (kit "icon" dropdown) for row actions. `label` is the
 * accessible name of the trigger, for example "Actions for Engineering".
 * Trigger is at least 44px square.
 */
export function RowActionsMenu({
  label,
  actions,
  trigger,
  className,
}: {
  label: string;
  actions: MenuAction[];
  /** Replace the default three-dot trigger content. */
  trigger?: ReactNode;
  className?: string;
}) {
  return (
    <Dropdown.Root>
      <AriaButton
        aria-label={label}
        className={cx(
          "flex size-11 cursor-pointer items-center justify-center rounded-md text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:text-fg-quaternary_hover focus-visible:outline-2 focus-visible:outline-offset-2",
          className,
        )}
      >
        {trigger ?? <DotsVertical aria-hidden="true" className="size-5" />}
      </AriaButton>
      <Dropdown.Popover>
        <Dropdown.Menu aria-label={label} onAction={(k) => run(actions, k)}>
          {renderActions(actions)}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  );
}

/**
 * Context menu (kit "context menu"): opens at the pointer on right-click or
 * the keyboard menu key / Shift+F10. It is an extra route to actions, never the
 * only one, so the same actions must also be reachable another way.
 */
export function ContextMenu({
  label,
  actions,
  children,
  className,
}: {
  label: string;
  actions: MenuAction[];
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <div
      className={className}
      onContextMenu={(event) => {
        event.preventDefault();
        if (anchor.current) {
          anchor.current.style.left = `${event.clientX}px`;
          anchor.current.style.top = `${event.clientY}px`;
        }
        setOpen(true);
      }}
    >
      {children}
      <span
        ref={anchor}
        aria-hidden="true"
        className="pointer-events-none fixed size-px"
      />
      <AriaPopover
        triggerRef={anchor}
        isOpen={open}
        onOpenChange={setOpen}
        placement="bottom start"
        className="w-62 overflow-auto rounded-lg bg-primary shadow-lg ring-1 ring-secondary_alt"
      >
        <Dropdown.Menu
          aria-label={label}
          autoFocus="first"
          onAction={(k) => {
            run(actions, k);
            setOpen(false);
          }}
        >
          {renderActions(actions)}
        </Dropdown.Menu>
      </AriaPopover>
    </div>
  );
}
