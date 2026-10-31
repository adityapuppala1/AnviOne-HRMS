import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  type ButtonProps,
} from "react-aria-components";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { WarningCircle as AlertCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps & {
  variant?: "primary" | "secondary" | "ghost" | "icon";
  className?: string;
}) {
  return (
    <AriaButton
      {...props}
      className={`button button-${variant} ${className}`}
    />
  );
}
export function Avatar({
  initials,
  name,
  size = "normal",
}: {
  initials: string;
  name?: string;
  size?: "normal" | "large" | "small";
}) {
  const color = (initials.charCodeAt(0) + (initials.charCodeAt(1) || 0)) % 5;
  return (
    <span
      className={`avatar avatar-${color} avatar-${size}`}
      aria-hidden={!name}
      aria-label={name}
    >
      {initials}
    </span>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber";
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {tone === "green" && <span className="status-dot" />}
      {children}
    </span>
  );
}
export function DialogPanel({
  open,
  onOpenChange,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="modal-overlay"
    >
      <Modal className={`modal ${className}`}>
        <Dialog className="dialog">
          <div className="dialog-heading">
            <Heading slot="title">{title}</Heading>
            <Button
              variant="icon"
              aria-label="Close dialog"
              onPress={() => onOpenChange(false)}
            >
              <X size={20} />
            </Button>
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-card" role="alert">
      <AlertCircle size={28} />
      <h2>Let’s try that again</h2>
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onPress={onRetry}>
          Try again <ArrowUpRight size={16} />
        </Button>
      )}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="loading" role="status" aria-label="Loading workspace">
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="sr-only">Loading workspace…</span>
    </div>
  );
}

export { MagicCard } from "./magicui/magic-card";
export { NumberTicker } from "./magicui/number-ticker";
export { Tabs, TabList, Tab, TabPanel, Switch } from "react-aria-components";

// Untitled UI (MIT) components, bridged to Loom tokens in ./untitled/untitled.css.
export {
  Table,
  TableCard,
} from "./untitled/components/application/table/table";
export {
  PaginationCardMinimal,
  PaginationButtonGroup,
} from "./untitled/components/application/pagination/pagination";
export { FeaturedIcon } from "./untitled/components/foundations/featured-icon/featured-icon";
export {
  Badge as StatusBadge,
  BadgeWithDot,
  BadgeWithIcon,
} from "./untitled/components/base/badges/badges";
export {
  Tooltip,
  TooltipTrigger,
} from "./untitled/components/base/tooltip/tooltip";
export {
  PageHeader,
  StatCard,
  EmptyBlock,
  DataCard,
  RangeInput,
  useNarrow,
  type Column,
} from "./patterns";

// Untitled UI (MIT, free tier only) form and overlay components.
export {
  Input,
  TextField as UTextField,
} from "./untitled/components/base/input/input";
export { TextArea } from "./untitled/components/base/textarea/textarea";
export { Label } from "./untitled/components/base/input/label";
export { HintText } from "./untitled/components/base/input/hint-text";
export { Select } from "./untitled/components/base/select/select";
export { ComboBox } from "./untitled/components/base/select/combobox";
export type { SelectItemType } from "./untitled/components/base/select/select-shared";
export { Checkbox } from "./untitled/components/base/checkbox/checkbox";
export { Toggle } from "./untitled/components/base/toggle/toggle";
export {
  RadioGroup,
  RadioButton,
} from "./untitled/components/base/radio-buttons/radio-buttons";
export { Avatar as UAvatar } from "./untitled/components/base/avatar/avatar";
export { AvatarOnlineIndicator } from "./untitled/components/base/avatar/base-components/avatar-online-indicator";
export { Dropdown } from "./untitled/components/base/dropdown/dropdown";
export {
  ButtonGroup,
  ButtonGroupItem,
} from "./untitled/components/base/button-group/button-group";
export { EmptyState } from "./untitled/components/application/empty-state/empty-state";
export { Button as UButton } from "./untitled/components/base/buttons/button";
export { Tabs as UTabs } from "./untitled/components/application/tabs/tabs";

// Shared list pattern: cards or table, paging, details panel (ADR 0010).
export {
  CollectionView,
  DetailPanel,
  DetailFields,
  type CollectionDetail,
  type CollectionViewMode,
} from "./collection";
