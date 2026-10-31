"use client";

import {
  type ComponentPropsWithRef,
  type ReactNode,
  type RefAttributes,
} from "react";
import type {
  DialogProps as AriaDialogProps,
  ModalOverlayProps as AriaModalOverlayProps,
  ModalRenderProps as AriaModalRenderProps,
} from "react-aria-components";
import {
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Modal as AriaModal,
  ModalOverlay as AriaModalOverlay,
} from "react-aria-components";
import { Button as AriaButton } from "react-aria-components";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { cx } from "../../../utils/cx";

interface ModalOverlayProps
  extends AriaModalOverlayProps, RefAttributes<HTMLDivElement> {}

export const ModalOverlay = (props: ModalOverlayProps) => {
  return (
    <AriaModalOverlay
      {...props}
      className={(state) =>
        cx(
          "fixed inset-0 flex min-h-dvh w-full items-center justify-end bg-overlay/70 pl-6 outline-hidden ease-linear md:pl-10",

          typeof props.className === "function"
            ? props.className(state)
            : props.className,
        )
      }
    />
  );
};
ModalOverlay.displayName = "ModalOverlay";

interface ModalProps
  extends AriaModalOverlayProps, RefAttributes<HTMLDivElement> {}

export const Modal = (props: ModalProps) => (
  <AriaModal
    {...props}
    className={(state) =>
      cx(
        "inset-y-0 right-0 h-full w-full max-w-100 shadow-xl transition",
        state.isEntering &&
          "duration-300 ease-out animate-in slide-in-from-right",
        state.isExiting &&
          "duration-200 ease-in animate-out slide-out-to-right",
        typeof props.className === "function"
          ? props.className(state)
          : props.className,
      )
    }
  />
);
Modal.displayName = "Modal";

interface DialogProps extends AriaDialogProps, RefAttributes<HTMLElement> {}

export const Dialog = (props: DialogProps) => (
  <AriaDialog
    role="dialog"
    aria-label="Slideout menu"
    {...props}
    className={cx(
      "relative flex size-full flex-col items-start gap-6 overflow-y-auto bg-primary ring-1 ring-secondary_alt outline-hidden",
      props.className,
    )}
  />
);
Dialog.displayName = "Dialog";

interface SlideoutMenuProps
  extends
    Omit<AriaModalOverlayProps, "children">,
    RefAttributes<HTMLDivElement> {
  children:
    | ReactNode
    | ((children: AriaModalRenderProps & { close: () => void }) => ReactNode);
  dialogClassName?: string;
  dialogLabel?: string;
}

const Menu = ({
  children,
  dialogClassName,
  dialogLabel,
  ...props
}: SlideoutMenuProps) => {
  return (
    <ModalOverlay {...props}>
      <Modal
        className={(state) =>
          cx(
            typeof props.className === "function"
              ? props.className(state)
              : props.className,
          )
        }
      >
        {(state) => (
          <Dialog className={dialogClassName} aria-label={dialogLabel}>
            {({ close }) => {
              return typeof children === "function"
                ? children({ ...state, close })
                : children;
            }}
          </Dialog>
        )}
      </Modal>
    </ModalOverlay>
  );
};
Menu.displayName = "SlideoutMenu";

const Content = ({ role = "main", ...props }: ComponentPropsWithRef<"div">) => {
  return (
    <div
      role={role}
      {...props}
      className={cx(
        "flex size-full flex-col gap-6 overflow-y-auto overscroll-auto px-4 md:px-6",
        props.className,
      )}
    />
  );
};
Content.displayName = "SlideoutContent";

interface SlideoutHeaderProps extends ComponentPropsWithRef<"header"> {
  onClose?: () => void;
}

const Header = ({
  className,
  children,
  onClose,
  ...props
}: SlideoutHeaderProps) => {
  return (
    <header
      {...props}
      className={cx("relative z-1 w-full px-4 pt-6 md:px-6", className)}
    >
      {children}
      <AriaButton
        slot="close"
        aria-label="Close details"
        onPress={onClose}
        className="absolute top-2 right-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-quaternary outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <X size={20} aria-hidden="true" />
      </AriaButton>
    </header>
  );
};
Header.displayName = "SlideoutHeader";

const Footer = (props: ComponentPropsWithRef<"footer">) => {
  return (
    <footer
      {...props}
      className={cx(
        "w-full p-4 shadow-[inset_0px_1px_0px_0px] shadow-border-secondary md:px-6",
        props.className,
      )}
    />
  );
};
Footer.displayName = "SlideoutFooter";

const SlideoutMenu = Menu as typeof Menu & {
  Trigger: typeof AriaDialogTrigger;
  Content: typeof Content;
  Header: typeof Header;
  Footer: typeof Footer;
};
SlideoutMenu.displayName = "SlideoutMenu";

SlideoutMenu.Trigger = AriaDialogTrigger;
SlideoutMenu.Content = Content;
SlideoutMenu.Header = Header;
SlideoutMenu.Footer = Footer;

export { SlideoutMenu };
