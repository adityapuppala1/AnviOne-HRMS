import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button, DialogPanel, StatusBadge, TextArea } from "@anvi/ui";
import { ApiError, api } from "../../lib/api";
import { engageCopy as text } from "../../lib/copy/engage";
import { useWorkspace } from "../../routes/workspace";

type Color = "gray" | "brand" | "error" | "warning" | "success";

export function StatusPill({ label, color }: { label: string; color: Color }) {
  return (
    <StatusBadge color={color} size="sm" type="pill-color">
      {label}
    </StatusBadge>
  );
}

const zone = "Asia/Kolkata";
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  });
export const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: zone,
  });

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// One write path for the whole screen: sends the CSRF token and refreshes every recognition query.
export function useEngSend() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
  const failure = useRef({ status: 0, message: "" });
  async function send<T = unknown>(
    path: string,
    body: unknown,
    method: "POST" | "PUT" = "POST",
    schema: z.ZodType<T> = z.unknown() as z.ZodType<T>,
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    setStatus(0);
    try {
      const result = await api(`/engage/${path}`, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body ?? {}),
      });
      await client.invalidateQueries({ queryKey: ["eng"] });
      return result;
    } catch (cause) {
      if (cause instanceof ApiError) setStatus(cause.status);
      const message =
        cause instanceof Error ? cause.message : text.common.saveFailed;
      failure.current = {
        status: cause instanceof ApiError ? cause.status : 0,
        message,
      };
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, error, setError, status, failure };
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="inline-error">
      {message}
    </p>
  ) : null;
}

export function FormActions({
  busy,
  submit,
  onCancel,
  disabled,
  busyLabel = text.common.saving,
}: {
  busy: boolean;
  submit: string;
  onCancel: () => void;
  disabled?: boolean;
  busyLabel?: string;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {text.common.cancel}
      </Button>
      <Button type="submit" isDisabled={busy || disabled}>
        {busy ? busyLabel : submit}
      </Button>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  wide,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      className={wide ? "recruit-modal eng-wide" : "recruit-modal"}
    >
      {children}
    </DialogPanel>
  );
}

// A dialog that asks for a reason (3 to 500 characters) and then runs an action.
export function ReasonDialog({
  open,
  title,
  body,
  submit,
  children,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: string;
  submit: string;
  children?: ReactNode;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);
  const ready = reason.trim().length >= 3;
  async function go(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    const failure = await onSubmit(reason.trim());
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }
  return (
    <Modal open={open} title={title} onClose={() => !busy && onClose()}>
      <form className="leave-form" onSubmit={(event) => void go(event)}>
        <p>{body}</p>
        {children}
        <TextArea
          label={text.common.reason}
          hint={text.common.reasonHint}
          value={reason}
          onChange={setReason}
          maxLength={500}
          autoFocus
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={submit}
          onCancel={onClose}
          disabled={!ready}
        />
      </form>
    </Modal>
  );
}
