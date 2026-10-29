import { useEffect, useRef, useState, type FormEvent } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Heart } from "@phosphor-icons/react/dist/csr/Heart";
import { HandsClapping } from "@phosphor-icons/react/dist/csr/HandsClapping";
import { Lightbulb } from "@phosphor-icons/react/dist/csr/Lightbulb";
import { Handshake } from "@phosphor-icons/react/dist/csr/Handshake";
import { Confetti } from "@phosphor-icons/react/dist/csr/Confetti";
import { HandHeart } from "@phosphor-icons/react/dist/csr/HandHeart";
import { EyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import {
  Avatar,
  Button,
  EmptyBlock,
  ErrorState,
  Input,
  PaginationCardMinimal,
  Select,
  StatusBadge,
  TextArea,
} from "@anvi/ui";
import {
  ENG_DAILY_KUDOS_LIMIT,
  engKudosDetailSchema,
  engReactionCodeSchema,
  type EngKudos,
  type EngReactionCode,
} from "@anvi/contracts";
import {
  useEngColleagues,
  useEngKudos,
  useEngKudosDetail,
  useEngValues,
} from "../../lib/api";
import { engageCopy as text } from "../../lib/copy/engage";
import { usePreferences } from "../../lib/preferences";
import {
  FormActions,
  FormError,
  Modal,
  ReasonDialog,
  dateTime,
  initialsOf,
  useDebounced,
  useEngSend,
} from "./shared";

const reactionIcons = {
  thanks: Heart,
  applause: HandsClapping,
  inspiring: Lightbulb,
  helpful: Handshake,
  celebrate: Confetti,
} as const;
const reactionCodes = engReactionCodeSchema.options;
const PAGE_SIZE = 10;

// ---- One recognition card ----

function KudosCard({
  item,
  onModerate,
}: {
  item: EngKudos;
  onModerate: (item: EngKudos) => void;
}) {
  const { send, error, setError } = useEngSend();
  const { reduceMotion } = usePreferences();
  const [pop, setPop] = useState<EngReactionCode | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function react(code: EngReactionCode) {
    setError("");
    const path = `kudos/${item.id}`;
    // One reaction per person: choosing another code swaps it, choosing the same one removes it.
    if (item.myReaction) {
      const removed = await send(`${path}/reactions/remove`, {});
      if (removed === null || item.myReaction === code) return;
    }
    const added = await send(`${path}/reactions`, { code });
    if (added !== null && !reduceMotion) {
      setPop(code);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPop(null), 900);
    }
  }
  return (
    <article
      className="eng-card"
      data-hidden={item.hidden || undefined}
      data-mine={item.givenByMe || item.toMe || undefined}
      aria-label={text.feed.postLabel(item.giverName, item.recipientName)}
    >
      <div className="eng-people">
        <span className="eng-person">
          <Avatar initials={initialsOf(item.giverName)} size="small" />
          <span className="eng-name">
            <span className="eng-role">{text.feed.from}</span>
            <strong>
              <bdi>{item.giverName}</bdi>
            </strong>
          </span>
        </span>
        <HandHeart
          size={22}
          weight="duotone"
          className="eng-arrow"
          aria-hidden
        />
        <span className="eng-person">
          <Avatar initials={initialsOf(item.recipientName)} size="small" />
          <span className="eng-name">
            <span className="eng-role">{text.feed.to}</span>
            <strong>
              <bdi>{item.recipientName}</bdi>
            </strong>
          </span>
        </span>
        <span className="eng-value">
          <StatusBadge color="brand" size="sm" type="pill-color">
            <bdi>{item.valueName}</bdi>
          </StatusBadge>
        </span>
      </div>
      <p className="eng-message" dir="auto">
        {item.message}
      </p>
      <div className="eng-meta">
        <span>{dateTime(item.createdAt)}</span>
        {item.givenByMe && <span>{text.feed.yourPost}</span>}
        {item.toMe && <span>{text.feed.forYou}</span>}
        {item.hidden && item.hiddenAt && (
          <span>{text.manage.hiddenOn(dateTime(item.hiddenAt))}</span>
        )}
      </div>
      <div className="eng-actions">
        <div
          className="eng-reactions"
          role="group"
          aria-label={text.feed.reactionsLabel}
        >
          {reactionCodes.map((code) => {
            const Icon = reactionIcons[code];
            const count = item.reactions[code] ?? 0;
            const mine = item.myReaction === code;
            return (
              <button
                key={code}
                type="button"
                className="eng-react"
                aria-pressed={mine}
                disabled={!item.canReact}
                data-pop={pop === code || undefined}
                onClick={() => void react(code)}
              >
                <Icon
                  size={18}
                  weight={mine ? "fill" : "regular"}
                  aria-hidden
                />
                <span>{text.reactions[code]}</span>
                <span className="eng-count">{count}</span>
                {pop === code && (
                  <span className="eng-confetti" aria-hidden>
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <i key={n} style={{ ["--n" as string]: n }} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {item.canModerate && (
          <Button
            variant="ghost"
            className="eng-moderate"
            onPress={() => onModerate(item)}
          >
            {item.hidden ? (
              <ArrowCounterClockwise size={16} aria-hidden />
            ) : (
              <EyeSlash size={16} aria-hidden />
            )}
            {item.hidden ? text.manage.restore : text.feed.moderate}
          </Button>
        )}
      </div>
      <FormError message={error} />
    </article>
  );
}

// ---- A paged list of cards for one view ----

type View = "feed" | "received" | "given" | "hidden";

export function KudosList({
  view,
  valueId,
  emptyTitle,
  emptyBody,
  onFilterEmpty,
}: {
  view: View;
  valueId?: string;
  emptyTitle: string;
  emptyBody: string;
  onFilterEmpty?: () => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [view, valueId]);
  const query = new URLSearchParams({
    view,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (valueId) query.set("valueId", valueId);
  const list = useEngKudos(true, query.toString());
  const [moderating, setModerating] = useState<EngKudos | null>(null);
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  if (!list.data) return <p className="recruit-muted">{text.common.loading}</p>;
  const { items, total, limit } = list.data;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="eng-list">
      {items.length === 0 ? (
        <EmptyBlock
          icon={HandHeart}
          title={emptyTitle}
          description={emptyBody}
          action={
            onFilterEmpty ? (
              <Button variant="secondary" onPress={onFilterEmpty}>
                {text.common.allValues}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="eng-cards">
          {items.map((item, index) => (
            <li key={item.id} style={{ ["--i" as string]: Math.min(index, 8) }}>
              <KudosCard item={item} onModerate={setModerating} />
            </li>
          ))}
        </ul>
      )}
      <p className="recruit-muted" aria-live="polite">
        {total === 0
          ? ""
          : text.feed.showing(
              (page - 1) * limit + 1,
              Math.min(page * limit, total),
              total,
            )}
      </p>
      {pages > 1 && (
        <PaginationCardMinimal
          page={page}
          total={pages}
          pageSize={limit}
          align="left"
          onPageChange={setPage}
          className="rounded-xl border"
        />
      )}
      <ModerateDialog item={moderating} onClose={() => setModerating(null)} />
    </div>
  );
}

// ---- Hide or restore, with a reason ----

function ModerateDialog({
  item,
  onClose,
}: {
  item: EngKudos | null;
  onClose: () => void;
}) {
  const { send, failure } = useEngSend();
  const restoring = Boolean(item?.hidden);
  // Restoring shows the earlier steps so HR sees why it was hidden.
  const detail = useEngKudosDetail(restoring ? item!.id : null);
  const history = detail.data?.moderation ?? [];
  return (
    <ReasonDialog
      open={Boolean(item)}
      title={restoring ? text.manage.restoreTitle : text.manage.hideTitle}
      body={restoring ? text.manage.restoreBody : text.manage.hideBody}
      submit={restoring ? text.manage.restoreSubmit : text.manage.hideSubmit}
      onClose={onClose}
      onSubmit={async (reason) => {
        if (!item) return text.common.saveFailed;
        const result = await send(
          `kudos/${item.id}/${restoring ? "restore" : "hide"}`,
          { version: item.version, reason },
          "POST",
          engKudosDetailSchema,
        );
        if (result) return null;
        return failure.current.status === 403
          ? text.manage.selfModeration
          : failure.current.message || text.common.saveFailed;
      }}
    >
      {item && (
        <blockquote className="eng-quote">
          <strong>
            {item.giverName} → {item.recipientName}
          </strong>
          <bdi dir="auto">{item.message}</bdi>
        </blockquote>
      )}
      {restoring && (
        <section aria-label={text.manage.history}>
          <h3 className="eng-h3">{text.manage.history}</h3>
          {history.length === 0 ? (
            <p className="recruit-muted">{text.manage.historyEmpty}</p>
          ) : (
            <ul className="eng-history">
              {history.map((step) => (
                <li key={step.id}>
                  <span>
                    {text.manage.historyLine(
                      step.action === "hide"
                        ? text.manage.historyHide
                        : text.manage.historyRestore,
                      step.byLabel,
                      dateTime(step.at),
                    )}
                  </span>
                  <bdi dir="auto">{step.reason}</bdi>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </ReasonDialog>
  );
}

// ---- Give recognition ----

export function GiveDialog({
  open,
  onClose,
  onPosted,
  givenToday,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
  givenToday: number;
}) {
  const { send, busy, error, setError } = useEngSend();
  const values = useEngValues(open);
  const active = (values.data?.items ?? []).filter((v) => v.active);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const colleagues = useEngColleagues(open, q);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [valueId, setValueId] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (open) {
      setSearch("");
      setChosen(null);
      setMessage("");
      setValueId("");
      setError("");
    }
  }, [open, setError]);
  const copy = text.give;
  const ready =
    Boolean(chosen) && Boolean(valueId) && message.trim().length >= 1;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen || !valueId) return;
    const done = await send(
      "kudos",
      {
        recipientEmployeeId: chosen.id,
        valueId,
        message: message.trim(),
      },
      "POST",
      engKudosDetailSchema,
    );
    if (done) {
      onPosted();
      onClose();
    }
  }
  const capped = givenToday >= ENG_DAILY_KUDOS_LIMIT;
  return (
    <Modal open={open} title={copy.title} onClose={() => !busy && onClose()}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.intro}</p>
        <p className="eng-cap" role="status">
          {capped
            ? text.feed.capReached(ENG_DAILY_KUDOS_LIMIT)
            : text.feed.givenToday(givenToday, ENG_DAILY_KUDOS_LIMIT)}
        </p>
        {chosen ? (
          <div className="eng-chosen">
            <span>{copy.chosen(chosen.name)}</span>
            <Button variant="secondary" onPress={() => setChosen(null)}>
              {copy.change}
            </Button>
          </div>
        ) : (
          <div className="eng-picker">
            <Input
              label={copy.colleague}
              placeholder={copy.colleaguePlaceholder}
              hint={copy.colleagueHint}
              icon={MagnifyingGlass}
              value={search}
              onChange={setSearch}
              maxLength={80}
              autoFocus
            />
            {colleagues.data && colleagues.data.items.length === 0 ? (
              <p className="recruit-muted">{copy.noColleagues}</p>
            ) : (
              <ul className="eng-colleagues" aria-label={copy.colleague}>
                {(colleagues.data?.items ?? []).map((person) => (
                  <li key={person.employeeId}>
                    <button
                      type="button"
                      className="eng-colleague"
                      onClick={() =>
                        setChosen({ id: person.employeeId, name: person.name })
                      }
                    >
                      <Avatar initials={initialsOf(person.name)} size="small" />
                      <span>{person.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {values.data && active.length === 0 ? (
          <p className="inline-error" role="alert">
            {copy.noValues}
          </p>
        ) : (
          <Select
            label={copy.value}
            placeholder={text.common.value}
            selectedKey={valueId || null}
            onSelectionChange={(key) => key && setValueId(String(key))}
          >
            {active.map((v) => (
              <Select.Item key={v.id} id={v.id} label={v.name} />
            ))}
          </Select>
        )}
        <TextArea
          label={copy.message}
          hint={`${copy.messageHint} ${copy.counter(message.length)}`}
          value={message}
          onChange={setMessage}
          maxLength={280}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.submit}
          busyLabel={copy.posting}
          onCancel={onClose}
          disabled={!ready || capped}
        />
      </form>
    </Modal>
  );
}

// ---- Tabs ----

export function FeedTab({ canGive }: { canGive: boolean }) {
  const [valueId, setValueId] = useState("all");
  const [giving, setGiving] = useState(false);
  const [posted, setPosted] = useState(false);
  const values = useEngValues(true);
  // The same query as the first feed page, only to show the daily count beside the button.
  const head = useEngKudos(true, "view=feed&page=1&limit=1");
  const given = head.data?.givenToday ?? 0;
  const limit = head.data?.dailyLimit ?? ENG_DAILY_KUDOS_LIMIT;
  const active = (values.data?.items ?? []).filter((v) => v.active);
  const filtered = valueId !== "all";
  return (
    <div className="eng-tab perf-tab">
      <p className="recruit-muted">{text.feed.intro}</p>
      <div className="recruit-filters eng-bar-row">
        {canGive && (
          <Button onPress={() => setGiving(true)}>
            <Plus size={18} aria-hidden />
            {text.feed.give}
          </Button>
        )}
        {canGive && (
          <span className="eng-given" data-testid="eng-given-today">
            {text.feed.givenToday(given, limit)}
          </span>
        )}
        <Select
          aria-label={text.feed.valueFilter}
          selectedKey={valueId}
          onSelectionChange={(key) => setValueId(String(key))}
          className="kit-filter"
        >
          <Select.Item id="all" label={text.common.allValues} />
          {active.map((v) => (
            <Select.Item key={v.id} id={v.id} label={v.name} />
          ))}
        </Select>
      </div>
      {posted && (
        <p className="recruit-notice" role="status">
          {text.feed.posted}
        </p>
      )}
      <KudosList
        view="feed"
        valueId={filtered ? valueId : undefined}
        emptyTitle={filtered ? text.feed.emptyFiltered : text.feed.emptyTitle}
        emptyBody={filtered ? text.feed.emptyFilteredBody : text.feed.emptyBody}
        onFilterEmpty={filtered ? () => setValueId("all") : undefined}
      />
      <GiveDialog
        open={giving}
        onClose={() => setGiving(false)}
        onPosted={() => setPosted(true)}
        givenToday={given}
      />
    </div>
  );
}

export function MineTab() {
  const [view, setView] = useState<"received" | "given">("received");
  return (
    <div className="eng-tab perf-tab">
      <div className="eng-switch" role="group" aria-label={text.mine.viewLabel}>
        {(["received", "given"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="eng-pill"
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {text.mine[key]}
          </button>
        ))}
      </div>
      <KudosList
        view={view}
        emptyTitle={
          view === "received" ? text.mine.emptyReceived : text.mine.emptyGiven
        }
        emptyBody={
          view === "received"
            ? text.mine.emptyReceivedBody
            : text.mine.emptyGivenBody
        }
      />
    </div>
  );
}
