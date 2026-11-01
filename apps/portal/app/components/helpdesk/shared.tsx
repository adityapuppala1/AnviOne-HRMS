import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import type { HdCase } from "@anvi/contracts";
import {
  Button,
  DialogPanel,
  Input,
  Select,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import { ApiError, api } from "../../lib/api";
import { helpdeskCopy as text } from "../../lib/copy/helpdesk";
import { useWorkspace } from "../../routes/workspace";

type Color = "gray" | "brand" | "error" | "warning" | "success";

export function StatusPill({ label, color }: { label: string; color: Color }) {
  return (
    <StatusBadge color={color} size="sm" type="pill-color">
      {label}
    </StatusBadge>
  );
}

export const statusColor: Record<HdCase["status"], Color> = {
  open: "brand",
  in_progress: "brand",
  waiting_on_employee: "warning",
  resolved: "success",
  closed: "gray",
  cancelled: "gray",
};
export const priorityColor: Record<HdCase["priority"], Color> = {
  low: "gray",
  normal: "gray",
  high: "warning",
  urgent: "error",
};
export const articleColor: Record<string, Color> = {
  draft: "gray",
  published: "success",
  archived: "gray",
};

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

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// One write path for the whole screen: sends the CSRF token and refreshes every helpdesk query.
export function useHdSend() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
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
      const result = await api(`/helpdesk/${path}`, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body),
      });
      await client.invalidateQueries({ queryKey: ["hd"] });
      return result;
    } catch (cause) {
      if (cause instanceof ApiError) setStatus(cause.status);
      setError(cause instanceof Error ? cause.message : text.common.saveFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, error, setError, status };
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
  cancel = text.common.cancel,
}: {
  busy: boolean;
  submit: string;
  onCancel: () => void;
  disabled?: boolean;
  cancel?: string;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" isDisabled={busy || disabled}>
        {busy ? text.common.saving : submit}
      </Button>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      className="recruit-modal"
    >
      {children}
    </DialogPanel>
  );
}

// A dialog that asks for one note (or reason) and then runs an action.
export function NoteDialog({
  open,
  title,
  body,
  label,
  submit,
  required,
  children,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: string;
  label: string;
  submit: string;
  required: boolean;
  // Extra fields (for example a rating) shown under the note.
  children?: ReactNode;
  onClose: () => void;
  onSubmit: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setNote("");
      setError("");
    }
  }, [open]);
  const ready = required ? note.trim().length >= 3 : true;
  async function go(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const ok = await onSubmit(note.trim());
      if (ok) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.common.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} title={title} onClose={() => !busy && onClose()}>
      <form className="leave-form" onSubmit={(event) => void go(event)}>
        <p>{body}</p>
        <TextArea
          label={label}
          value={note}
          onChange={setNote}
          maxLength={4000}
          autoFocus
        />
        {children}
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

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  labels,
  placeholder,
}: {
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: T[];
  labels: Record<string, string>;
  placeholder?: string;
}) {
  return (
    <Select
      label={label}
      placeholder={placeholder}
      selectedKey={value || null}
      onSelectionChange={(key) => key && onChange(String(key) as T)}
    >
      {options.map((option) => (
        <Select.Item
          key={option}
          id={option}
          label={labels[option] ?? option}
        />
      ))}
    </Select>
  );
}

// A filter select with an "all" entry. `all` is the sentinel key.
export function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: { id: string; label: string }[];
}) {
  return (
    <Select
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
      className="kit-filter"
    >
      <Select.Item id="all" label={allLabel} />
      {options.map((option) => (
        <Select.Item key={option.id} id={option.id} label={option.label} />
      ))}
    </Select>
  );
}

export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      aria-label={text.common.search}
      placeholder={text.common.search}
      icon={MagnifyingGlass}
      value={value}
      onChange={onChange}
      className="kit-search"
      maxLength={80}
    />
  );
}
