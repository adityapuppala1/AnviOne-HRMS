import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Avatar } from "@anvi/ui";
import type { OrgChartNodeLite } from "@anvi/contracts";
import { ApiError, useOrgSearch } from "../lib/api";
import { deptLabel } from "../lib/org-chart";
import { chartCopy as text } from "../lib/copy/chart";

// An ARIA 1.2 combobox with a listbox popup. The kit ComboBox filters a fixed
// list on the client; this list is fetched from the server, so the pattern is
// built directly. The typed text is only sent to the search endpoint.
export function OrgSearch({
  onPick,
}: {
  onPick: (person: OrgChartNodeLite) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const search = useOrgSearch(value);
  const items = search.active ? (search.data?.items ?? []) : [];
  const error = search.error;
  const status = error instanceof ApiError ? error.status : 0;

  useEffect(() => {
    function away(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  useEffect(() => setActive(-1), [search.data]);

  let message = "";
  if (error)
    message =
      status === 429
        ? text.find.rateLimited
        : status === 403
          ? text.find.forbidden
          : status === 503
            ? text.find.unavailable
            : text.find.failed;
  else if (value.trim().length > 0 && !search.active)
    message = text.find.tooShort;
  else if (search.active && search.waiting && !items.length)
    message = text.find.searching;
  else if (search.active && !search.waiting && !items.length)
    message = text.find.none;

  // Spoken summary: only once the answer for the current text has arrived.
  const spoken = error
    ? message
    : search.active && !search.waiting
      ? items.length
        ? text.find.results(items.length)
        : text.find.none
      : "";

  function choose(person: OrgChartNodeLite) {
    onPick(person);
    setValue("");
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (items.length) setActive((n) => (n + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (items.length) setActive((n) => (n <= 0 ? items.length - 1 : n - 1));
    } else if (event.key === "Enter") {
      if (open && items.length) {
        event.preventDefault();
        const person = items[active >= 0 ? active : 0];
        if (person) choose(person);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (value) {
        event.preventDefault();
        setValue("");
      }
    }
  }

  const showPopup = open && value.trim().length > 0;
  return (
    <div className="oc-find" ref={box}>
      <label className="oc-find-label" htmlFor={`${id}-input`}>
        {text.find.label}
      </label>
      <div className="oc-find-field">
        <MagnifyingGlass
          size={20}
          aria-hidden="true"
          className="oc-find-icon"
        />
        <input
          ref={input}
          id={`${id}-input`}
          className="oc-find-input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          placeholder={text.find.placeholder}
          aria-expanded={showPopup && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={`${id}-hint`}
          aria-activedescendant={
            showPopup && items.length > 0 && active >= 0
              ? `${id}-opt-${active}`
              : undefined
          }
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => value && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            className="oc-find-clear"
            aria-label={text.find.clear}
            onClick={() => {
              setValue("");
              input.current?.focus();
            }}
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
      <p id={`${id}-hint`} className="oc-find-hint">
        {text.find.hint}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={text.find.listLabel}
        className="oc-find-list"
        hidden={!showPopup || !items.length}
      >
        {showPopup &&
          items.map((person, index) => (
            <li
              key={person.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              className="oc-find-option"
              data-active={index === active ? "true" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(person)}
              onPointerMove={() => active !== index && setActive(index)}
            >
              <Avatar initials={person.initials} />
              <span className="oc-find-text">
                <span className="oc-find-name">{person.name}</span>
                <span className="oc-find-sub">
                  {person.title || text.noTitle}
                  {" · "}
                  {deptLabel(person.department, text.noDepartment)}
                </span>
              </span>
            </li>
          ))}
      </ul>
      {showPopup && message && !items.length && (
        <p className="oc-find-note" data-error={error ? "true" : undefined}>
          {message}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}
