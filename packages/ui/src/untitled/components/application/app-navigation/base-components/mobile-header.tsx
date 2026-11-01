"use client";

// Vendored and adapted from the Untitled UI starter kit (MIT, see
// ../../../../LICENSE.md): app-navigation/base-components/mobile-header.tsx.
// The kit pairs a 56px header with a slide-in modal. The portal already has a
// top bar with its own menu button, so only the slide-in drawer is kept here,
// controlled by the caller. The logo is dropped (it was a kit asset), labels are
// props (copy lives in the app catalog) and the close target is 44px.
import type { PropsWithChildren } from "react";
import { X as CloseIcon } from "@untitledui/icons";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  Modal as AriaModal,
  ModalOverlay as AriaModalOverlay,
} from "react-aria-components";
import { cx } from "../../../../utils/cx";

export const MobileNavigationDrawer = ({
  isOpen,
  onOpenChange,
  label,
  closeLabel,
  children,
}: PropsWithChildren<{
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the dialog. */
  label: string;
  closeLabel: string;
}>) => (
  <AriaModalOverlay
    isOpen={isOpen}
    onOpenChange={onOpenChange}
    isDismissable
    className={({ isEntering, isExiting }) =>
      cx(
        "fixed inset-0 z-50 cursor-pointer bg-overlay/70 pr-16 backdrop-blur-md",
        isEntering && "duration-300 ease-in-out animate-in fade-in",
        isExiting && "duration-200 ease-in-out animate-out fade-out",
      )
    }
  >
    <AriaButton
      aria-label={closeLabel}
      onPress={() => onOpenChange(false)}
      className="fixed top-2 right-2 flex size-11 cursor-pointer items-center justify-center rounded-lg text-fg-white/70 outline-focus-ring hover:bg-white/10 hover:text-fg-white focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <CloseIcon aria-hidden="true" className="size-6" />
    </AriaButton>
    <AriaModal className="w-full max-w-74 cursor-auto will-change-transform">
      <AriaDialog
        aria-label={label}
        className="h-dvh overflow-y-auto outline-hidden focus:outline-hidden"
      >
        {children}
      </AriaDialog>
    </AriaModal>
  </AriaModalOverlay>
);
