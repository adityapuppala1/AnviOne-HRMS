import type { FC } from "react";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "./untitled/components/base/button-group/button-group";

type Icon = FC<{ className?: string }>;

export type SegmentedOption<K extends string> = {
  key: K;
  // Visible text; leave out for an icon-only option (then ariaLabel is required).
  label?: string;
  ariaLabel?: string;
  icon?: Icon;
};

// A single-choice segmented control built on the kit button group. Options are
// exposed as radios in a labelled group, with 44px touch targets.
export function SegmentedControl<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentedOption<K>[];
  value: K;
  onChange: (next: K) => void;
}) {
  return (
    <ButtonGroup
      size="sm"
      aria-label={label}
      selectedKeys={[value]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        const hit = options.find((o) => o.key === next);
        if (hit) onChange(hit.key);
      }}
    >
      {options.map((o) => (
        <ButtonGroupItem
          key={o.key}
          id={o.key}
          aria-label={o.ariaLabel}
          className="min-h-11 min-w-11"
          iconLeading={o.icon}
        >
          {o.label}
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );
}
