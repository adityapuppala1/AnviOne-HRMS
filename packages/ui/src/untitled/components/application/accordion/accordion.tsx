"use client";

// HAND-BUILT from Untitled UI kit primitives. The free Untitled UI starter kit
// has no accordion component, so this is not vendored code: it reuses the kit's
// tokens (text-primary, text-tertiary, border-secondary, bg-primary_hover,
// outline-focus-ring), its `cx` helper and its icon set. Semantics follow the
// WAI-ARIA disclosure pattern: each header is a button with aria-expanded and
// aria-controls, and each panel is a region labelled by that button.
import { type ReactNode, useId, useState } from "react";
import { ChevronDown } from "@untitledui/icons";
import { cx } from "../../../utils/cx";

export type AccordionItem = {
  id: string;
  title: ReactNode;
  /** Optional line under the title, for example a count. */
  description?: ReactNode;
  content: ReactNode;
};

export function Accordion({
  items,
  allowMultiple = true,
  defaultOpenIds = [],
  headingLevel = 3,
  className,
}: {
  items: AccordionItem[];
  /** When false, opening one section closes the others. */
  allowMultiple?: boolean;
  defaultOpenIds?: string[];
  /** Heading level that wraps each trigger, so the page outline stays valid. */
  headingLevel?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  const base = useId();
  const [open, setOpen] = useState<string[]>(defaultOpenIds);
  const Heading = `h${headingLevel}` as "h3";

  function toggle(id: string) {
    setOpen((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : allowMultiple
          ? [...current, id]
          : [id],
    );
  }

  return (
    <div
      className={cx(
        "divide-y divide-secondary overflow-hidden rounded-xl bg-primary ring-1 ring-secondary",
        className,
      )}
    >
      {items.map((item) => {
        const expanded = open.includes(item.id);
        const buttonId = `${base}-${item.id}-button`;
        const panelId = `${base}-${item.id}-panel`;
        return (
          <div key={item.id}>
            <Heading className="m-0 text-md font-semibold">
              <button
                id={buttonId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-primary outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold text-primary">
                    {item.title}
                  </span>
                  {item.description ? (
                    <span className="text-sm font-normal text-tertiary">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cx(
                    "size-5 shrink-0 text-fg-quaternary transition duration-150 ease-linear",
                    expanded && "-scale-y-100",
                  )}
                />
              </button>
            </Heading>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!expanded}
              className="px-4 pt-1 pb-4 text-sm text-tertiary"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
