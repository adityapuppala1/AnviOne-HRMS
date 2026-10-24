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
export { Tabs, TabList, Tab, TabPanel, Switch } from "react-aria-components";
