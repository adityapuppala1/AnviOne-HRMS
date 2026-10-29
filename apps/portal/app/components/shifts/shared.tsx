import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import type { ShfAssignment } from "@anvi/contracts";
import {
  Button,
  DialogPanel,
  Input,
  Select,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import { ApiError, api } from "../../lib/api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import { useWorkspace } from "../../routes/workspace";

type Color = "gray" | "brand" | "error" | "warning" | "success";

export function StatusPill({ label, color }: { label: string; color: Color }) {
  return (
    <StatusBadge color={color} size="sm" type="pill-color">
      {label}
    </StatusBadge>
  );
}

export const swapColor: Record<string, Color> = {
  proposed: "warning",
  accepted: "brand",
  declined: "gray",
  cancelled: "gray",
  approved: "success",
  rejected: "error",
};
export const openColor: Record<string, Color> = {
  open: "brand",
  filled: "success",
  withdrawn: "gray",
};
export const claimColor: Record<string, Color> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  withdrawn: "gray",
  not_selected: "gray",
};

// ---- Dates ----
// Dates arrive as plain YYYY-MM-DD strings and local wall-clock "YYYY-MM-DDTHH:MM" times in the
// entity's time zone, so they are never converted through the browser's zone.
export const ZONE = "Asia/Kolkata";
const DAY_MS = 24 * 3600 * 1000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
export const addDays = (iso: string, days: number) =>
  new Date(ms(iso) + days * DAY_MS).toISOString().slice(0, 10);
export const mondayOf = (iso: string) =>
  addDays(iso, 1 - (new Date(ms(iso)).getUTCDay() || 7));
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(ms(iso)).toLocaleDateString("en-IN", {
    ...options,
    timeZone: "UTC",
  });
export const dayName = (iso: string) => fmt(iso, { weekday: "short" });
export const dayShort = (iso: string) =>
  fmt(iso, { day: "numeric", month: "short" });
export const dayLong = (iso: string) =>
  fmt(iso, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const weekRange = (monday: string) =>
  text.week.range(dayShort(monday), dayLong(addDays(monday, 6)));
export const clock = (local: string) => local.slice(11, 16);
export const timeRange = (start: string, end: string, crosses = false) =>
  `${clock(start)}–${clock(end)}${crosses ? ` ${text.shift.nextDay}` : ""}`;
export const hoursText = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : h === 0 ? `${m} min` : `${h} h ${m} min`;
};
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ZONE,
  });

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// One write path for the whole screen: sends the CSRF token and refreshes every shifts query.
export function useShfSend() {
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
      const result = await api(`/shifts/${path}`, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body ?? {}),
      });
      await client.invalidateQueries({ queryKey: ["shf"] });
      return result;
    } catch (cause) {
      if (cause instanceof ApiError) setStatus(cause.status);
      setError(cause instanceof Error ? cause.message : text.common.saveFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }
  // For dialogs that show the refusal themselves: null on success, otherwise the server's message.
  async function attempt(
    path: string,
    body: unknown,
    method: "POST" | "PUT" = "POST",
  ): Promise<string | null> {
    try {
      await api(`/shifts/${path}`, z.unknown(), {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body ?? {}),
      });
      await client.invalidateQueries({ queryKey: ["shf"] });
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : text.common.saveFailed;
    }
  }
  return { send, attempt, busy, error, setError, status };
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="inline-error" dir="auto">
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

// A dialog that confirms an action and optionally asks for one reason.
export function ConfirmDialog({
  open,
  title,
  body,
  label,
  submit,
  cancel,
  needsReason,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: string;
  label?: string;
  submit: string;
  cancel?: string;
  needsReason: boolean;
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
  const ready = needsReason ? reason.trim().length >= 3 : true;
  async function go(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const problem = await onSubmit(reason.trim());
      if (problem === null) onClose();
      else setError(problem);
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
        {label && (
          <TextArea
            label={label}
            value={reason}
            onChange={setReason}
            maxLength={300}
            autoFocus
          />
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={submit}
          cancel={cancel}
          onCancel={onClose}
          disabled={!ready}
        />
      </form>
    </Modal>
  );
}

export function SearchBox({
  value,
  onChange,
  label = text.common.search,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <Input
      aria-label={label}
      placeholder={label}
      icon={MagnifyingGlass}
      value={value}
      onChange={onChange}
      className="kit-search"
      maxLength={80}
    />
  );
}

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

// ---- Shift card ----

type ShiftLike = Pick<
  ShfAssignment,
  | "templateName"
  | "templateCode"
  | "colour"
  | "startAt"
  | "endAt"
  | "crossesMidnight"
  | "breakMinutes"
>;

// The colour is a stripe and a soft tint; the name, code and time always say the same thing in text.
export function ShiftBlock({
  shift,
  flags,
  who,
}: {
  shift: ShiftLike;
  flags?: Pick<
    ShfAssignment,
    "onLeave" | "afterPublish" | "published" | "status"
  >;
  who?: string;
}) {
  return (
    <span className="shf-shift" data-colour={shift.colour}>
      {who && (
        <span className="shf-shift-who" dir="auto">
          {who}
        </span>
      )}
      <span className="shf-shift-name" dir="auto">
        {shift.templateName}
        <span className="shf-shift-code"> · {shift.templateCode}</span>
      </span>
      <span className="shf-shift-time">
        {timeRange(shift.startAt, shift.endAt, shift.crossesMidnight)}
      </span>
      <span className="shf-shift-meta">
        {shift.breakMinutes > 0
          ? text.shift.break(shift.breakMinutes)
          : text.shift.noBreak}
      </span>
      {flags && (
        <span className="shf-flags">
          {flags.status === "cancelled" && (
            <StatusPill label={text.shift.cancelled} color="gray" />
          )}
          {flags.onLeave && (
            <StatusPill label={text.shift.onLeave} color="warning" />
          )}
          {flags.afterPublish && (
            <StatusPill label={text.shift.afterPublish} color="brand" />
          )}
          {!flags.published && (
            <StatusPill label={text.shift.draftFlag} color="gray" />
          )}
        </span>
      )}
    </span>
  );
}
