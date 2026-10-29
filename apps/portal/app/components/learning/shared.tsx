import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import {
  Button,
  DialogPanel,
  Input,
  Select,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import {
  lrnCourseCreateSchema,
  type LrnAssignment,
  type LrnCourse,
} from "@anvi/contracts";
import { ApiError, api } from "../../lib/api";
import { learningCopy as text } from "../../lib/copy/learning";
import { useWorkspace } from "../../routes/workspace";

export type Color = "gray" | "brand" | "error" | "warning" | "success";

export function StatusPill({ label, color }: { label: string; color: Color }) {
  return (
    <StatusBadge color={color} size="sm" type="pill-color">
      {label}
    </StatusBadge>
  );
}

export const assignmentColor: Record<LrnAssignment["status"], Color> = {
  assigned: "gray",
  in_progress: "brand",
  completed: "success",
  waived: "gray",
};
export const renewalColor: Record<
  NonNullable<LrnAssignment["renewal"]>,
  Color
> = {
  current: "success",
  due: "warning",
  expired: "error",
};
export const courseColor: Record<LrnCourse["status"], Color> = {
  draft: "gray",
  published: "success",
  archived: "gray",
};

const zone = "Asia/Kolkata";
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  });
// Plain dates (YYYY-MM-DD) and timestamps both read as a calendar day in India.
export const dateOnly = (iso: string) =>
  new Date(
    iso.length === 10 ? `${iso}T00:00:00+05:30` : iso,
  ).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: zone,
  });
export const todayIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: zone });

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// One write path for the whole screen: sends the CSRF token and refreshes every learning query.
export function useLrnSend() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
  const last = useRef("");
  async function send<T = unknown>(
    path: string,
    body: unknown,
    method: "POST" | "PUT" = "POST",
    schema: z.ZodType<T> = z.unknown() as z.ZodType<T>,
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    setStatus(0);
    last.current = "";
    try {
      const result = await api(`/learning/${path}`, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body),
      });
      await client.invalidateQueries({ queryKey: ["lrn"] });
      return result;
    } catch (cause) {
      if (cause instanceof ApiError) setStatus(cause.status);
      last.current =
        cause instanceof Error ? cause.message : text.common.saveFailed;
      setError(last.current);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return {
    send,
    busy,
    error,
    setError,
    status,
    latestError: () => last.current,
  };
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
  maxLength,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: string;
  label: string;
  submit: string;
  required: boolean;
  maxLength: number;
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
          maxLength={maxLength}
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

// An external course link: always https, opens in a new tab with no opener, and shows the host
// so people see where they are going. Anything that is not a plain https URL is shown as text.
export function CourseLink({ url }: { url: string | null }) {
  if (!url) return null;
  let host = "";
  // Same rule as the API contract: https, plain dotted host, no userinfo or odd characters.
  if (lrnCourseCreateSchema.shape.externalUrl.safeParse(url).success) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") host = parsed.host;
    } catch {
      host = "";
    }
  }
  if (!host) return <span className="lrn-link-text">{url}</span>;
  return (
    <span className="lrn-link">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {text.detail.openLink(host)}
        <ArrowSquareOut size={16} aria-hidden="true" />
      </a>
      <span className="recruit-muted">{text.detail.linkNote}</span>
    </span>
  );
}

export function dueLabel(a: LrnAssignment) {
  return a.dueOn ? text.badge.due(dateOnly(a.dueOn)) : text.badge.noDue;
}
