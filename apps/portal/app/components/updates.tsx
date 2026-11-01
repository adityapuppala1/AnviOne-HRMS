import { useState } from "react";
import { Link } from "react-router";
import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { Files } from "@phosphor-icons/react/dist/csr/Files";
import { CalendarX } from "@phosphor-icons/react/dist/csr/CalendarX";
import { BellSlash } from "@phosphor-icons/react/dist/csr/BellSlash";
import { Button, DialogPanel } from "@anvi/ui";
import type { UpdateItem } from "@anvi/contracts";
import { useUpdates } from "../lib/api";
import { copy } from "../lib/copy";

const text = copy.updates;
const icons = {
  leave: CalendarCheck,
  attendance: Fingerprint,
  document: Files,
} as const;
const routes = {
  leave: "/leave",
  attendance: "/attendance",
  document: "/documents",
} as const;

// Remembered per person, in this browser only; the feed itself lives on the server.
const key = (employeeId: string) => `anvi-updates-seen:${employeeId}`;
function readSeen(employeeId: string) {
  try {
    return localStorage.getItem(key(employeeId)) ?? "";
  } catch {
    return "";
  }
}

// A bell in the top bar: decisions other people made on your own requests.
export function UpdatesBell({ employeeId }: { employeeId: string }) {
  const { data } = useUpdates();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => readSeen(employeeId));
  const items = data?.items ?? [];
  const unread = items.filter((item) => item.at > seen).length;
  function close() {
    setOpen(false);
    const newest = items[0]?.at;
    if (!newest) return;
    setSeen(newest);
    try {
      localStorage.setItem(key(employeeId), newest);
    } catch {
      /* Remembering what you have read is optional. */
    }
  }
  return (
    <>
      <Button
        variant="icon"
        className="updates-bell"
        aria-label={text.open(unread)}
        onPress={() => setOpen(true)}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="updates-count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      <DialogPanel
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={text.title}
        className="updates-dialog"
      >
        <p className="updates-intro">{text.intro}</p>
        {items.length === 0 ? (
          <div className="updates-empty">
            <BellSlash size={30} aria-hidden="true" />
            <h3>{text.empty.title}</h3>
            <p>{text.empty.body}</p>
          </div>
        ) : (
          <ul className="updates-list">
            {items.map((item) => (
              <UpdateRow
                key={`${item.kind}-${item.id}`}
                item={item}
                fresh={item.at > seen}
                onOpen={close}
              />
            ))}
          </ul>
        )}
      </DialogPanel>
    </>
  );
}

function UpdateRow({
  item,
  fresh,
  onOpen,
}: {
  item: UpdateItem;
  fresh: boolean;
  onOpen: () => void;
}) {
  const bad = item.outcome === "declined" || item.outcome === "rejected";
  // A declined leave request gets its own icon so the outcome reads at a glance.
  const Icon = bad && item.kind === "leave" ? CalendarX : icons[item.kind];
  return (
    <li className={`update-row ${bad ? "update-bad" : "update-good"}`}>
      <span className="update-icon">
        <Icon size={20} weight="duotone" aria-hidden="true" />
      </span>
      <div>
        <strong>
          {text.headline(item.kind, item.outcome)}
          {fresh && <span className="update-new">{text.new}</span>}
        </strong>
        <p>{text.detail(item.title, item.from, item.to)}</p>
        {item.note && (
          <blockquote>
            {text.note(item.decidedBy)} {item.note}
          </blockquote>
        )}
        <small>
          <time dateTime={item.at}>{text.when(item.at)}</time>
          {item.decidedBy && !item.note ? ` · ${text.by(item.decidedBy)}` : ""}
        </small>
      </div>
      <Link
        className="update-link"
        to={routes[item.kind]}
        onClick={onOpen}
        aria-label={text.openPage(item.kind)}
      >
        {text.view}
      </Link>
    </li>
  );
}
