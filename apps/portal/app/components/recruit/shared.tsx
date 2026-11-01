import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Button,
  Checkbox,
  DialogPanel,
  Input,
  Select,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import { api, usePeopleSearch } from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import { useWorkspace } from "../../routes/workspace";

type Color = "gray" | "brand" | "error" | "warning" | "success";

export function StatusPill({ label, color }: { label: string; color: Color }) {
  return (
    <StatusBadge color={color} size="sm" type="pill-color">
      {label}
    </StatusBadge>
  );
}

export const requisitionColor: Record<string, Color> = {
  draft: "gray",
  pending_approval: "warning",
  approved: "brand",
  open: "success",
  on_hold: "warning",
  closed: "gray",
  rejected: "error",
  cancelled: "gray",
};
export const offerColor: Record<string, Color> = {
  draft: "gray",
  pending_approval: "warning",
  approved: "brand",
  sent: "brand",
  accepted: "success",
  declined: "error",
  expired: "gray",
  withdrawn: "gray",
};
export const interviewColor: Record<string, Color> = {
  scheduled: "brand",
  completed: "success",
  cancelled: "gray",
  no_show: "error",
};

const zone = "Asia/Kolkata";
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  });
export const dateOnly = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: iso.length === 10 ? "UTC" : zone,
    },
  );
export const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// One write path for the whole screen: sends the CSRF token and refreshes every recruitment query.
export function useRecruitSend() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send<T = unknown>(
    path: string,
    body: unknown,
    schema: z.ZodType<T> = z.unknown() as z.ZodType<T>,
    method: "POST" | "PUT" = "POST",
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/recruit/${path}`, schema, {
        method,
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(body),
      });
      await client.invalidateQueries({ queryKey: ["recruit"] });
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.common.saveFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, error, setError };
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
  minLength = 3,
  confirm,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: string;
  label: string;
  submit: string;
  required: boolean;
  minLength?: number;
  // An extra "I understand" checkbox for irreversible actions.
  confirm?: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setNote("");
      setSure(false);
      setError("");
    }
  }, [open]);
  const long = note.trim().length >= minLength;
  const ready =
    (required ? long : note.trim() === "" || long) && (!confirm || sure);
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
          maxLength={500}
          autoFocus
        />
        {confirm && (
          <Checkbox isSelected={sure} onChange={setSure} label={confirm} />
        )}
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

export type Person = { id: string; name: string; title: string };

// Search the directory and pick one or several people. Keyboard friendly: results are buttons.
export function PersonPicker({
  label,
  selected,
  onChange,
  max = 1,
}: {
  label: string;
  selected: Person[];
  onChange: (next: Person[]) => void;
  max?: number;
}) {
  const [term, setTerm] = useState("");
  const search = useDebounced(term.trim(), 250);
  const people = usePeopleSearch(search);
  const full = selected.length >= max;
  return (
    <div className="recruit-people">
      {selected.length > 0 && (
        <ul
          className="recruit-chosen"
          aria-label={`${label}: ${text.people.selected}`}
        >
          {selected.map((person) => (
            <li key={person.id}>
              <span>
                <strong>{person.name}</strong>
                <small>{person.title}</small>
              </span>
              <Button
                variant="icon"
                aria-label={text.people.remove(person.name)}
                onPress={() =>
                  onChange(selected.filter((p) => p.id !== person.id))
                }
              >
                <X size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!full ? (
        <>
          <Input
            label={label}
            hint={max > 1 ? text.people.max(max) : text.people.findHint}
            icon={MagnifyingGlass}
            autoComplete="off"
            maxLength={80}
            value={term}
            onChange={setTerm}
          />
          {search && people.data && (
            <ul className="recruit-results" aria-label={text.people.results}>
              {people.data.items.filter(
                (p) => !selected.some((s) => s.id === p.id),
              ).length === 0 ? (
                <li className="recruit-muted">{text.people.none}</li>
              ) : (
                people.data.items
                  .filter((p) => !selected.some((s) => s.id === p.id))
                  .map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange([
                            ...selected,
                            {
                              id: person.id,
                              name: person.name,
                              title: person.title,
                            },
                          ]);
                          setTerm("");
                        }}
                      >
                        <strong>{person.name}</strong>
                        <small>{person.title}</small>
                      </button>
                    </li>
                  ))
              )}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

// Search box plus a status filter, shared by the list tabs.
export function ListFilters({
  search,
  onSearch,
  status,
  onStatus,
  statuses,
  labels,
}: {
  search: string;
  onSearch: (value: string) => void;
  status: string;
  onStatus: (value: string) => void;
  statuses?: string[];
  labels?: Record<string, string>;
}) {
  return (
    <div className="recruit-filters">
      <Input
        aria-label={text.common.search}
        placeholder={text.common.search}
        icon={MagnifyingGlass}
        value={search}
        onChange={onSearch}
        className="kit-search"
        maxLength={80}
      />
      {statuses && labels && (
        <Select
          aria-label={text.common.status}
          selectedKey={status}
          onSelectionChange={(key) => onStatus(String(key))}
          className="kit-filter"
        >
          <Select.Item id="all" label={text.common.allStatuses} />
          {statuses.map((key) => (
            <Select.Item key={key} id={key} label={labels[key] ?? key} />
          ))}
        </Select>
      )}
    </div>
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
