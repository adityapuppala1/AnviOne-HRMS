import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Lifebuoy } from "@phosphor-icons/react/dist/csr/Lifebuoy";
import {
  Button,
  Checkbox,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  Select,
  TextArea,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import { hdCaseDetailSchema, type HdCase } from "@anvi/contracts";
import {
  useHdAgents,
  useHdArticles,
  useHdCase,
  useHdCases,
  useHdCategories,
  useHdSuggestions,
} from "../../lib/api";
import { helpdeskCopy as text } from "../../lib/copy/helpdesk";
import { useWorkspace } from "../../routes/workspace";
import {
  FilterSelect,
  FormActions,
  FormError,
  Modal,
  NoteDialog,
  SearchBox,
  SelectField,
  StatusPill,
  dateOnly,
  dateTime,
  priorityColor,
  statusColor,
  useDebounced,
  useHdSend,
} from "./shared";

const copy = text.case;
const statuses = Object.keys(text.status);
const priorities = Object.keys(text.priority) as HdCase["priority"][];

type NoteStep = "wait" | "resume" | "resolve" | "reopen" | "cancel";
type Acting =
  | { kind: "raise" }
  | { kind: "step"; step: NoteStep; item: HdCase }
  | { kind: "close"; item: HdCase }
  | { kind: "assign"; item: HdCase }
  | { kind: "priority"; item: HdCase }
  | { kind: "link"; item: HdCase };

const isLive = (item: HdCase) =>
  item.status === "open" ||
  item.status === "in_progress" ||
  item.status === "waiting_on_employee";

function StatusCell({ item }: { item: HdCase }) {
  return (
    <StatusPill
      label={text.status[item.status]}
      color={statusColor[item.status]}
    />
  );
}
function PriorityCell({ item }: { item: HdCase }) {
  return (
    <StatusPill
      label={text.priority[item.priority]}
      color={priorityColor[item.priority]}
    />
  );
}
// Overdue shows in words as well as colour, so it never depends on colour alone.
function TargetCell({ item }: { item: HdCase }) {
  if (item.breached)
    return (
      <StatusPill
        label={
          item.responseBreached
            ? text.sla.breachedResponse
            : text.sla.breachedResolve
        }
        color="error"
      />
    );
  if (isLive(item))
    return (
      <StatusPill
        label={text.sla.due(dateTime(item.resolveDue))}
        color="gray"
      />
    );
  return <StatusPill label={text.sla.met} color="success" />;
}

export function CasesTab({ mode }: { mode: "mine" | "queue" }) {
  const { me } = useWorkspace();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [breached, setBreached] = useState("all");
  const [queueView, setQueueView] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
    q,
    view: mode === "mine" ? "mine" : queueView,
  });
  if (status !== "all") query.set("status", status);
  if (priority !== "all") query.set("priority", priority);
  if (category !== "all") query.set("categoryId", category);
  if (breached !== "all") query.set("breached", breached);
  const list = useHdCases(true, query.toString());
  const categories = useHdCategories(true);
  const { send, busy, error, setError } = useHdSend();
  const [acting, setActing] = useState<Acting | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = useHdCase(openKey);
  const [notice, setNotice] = useState("");
  const queue = mode === "queue";
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  async function step(item: HdCase, name: string, note?: string) {
    return (
      (await send(`cases/${item.id}/${name}`, {
        version: item.version,
        ...(note ? { note } : {}),
      })) !== null
    );
  }
  async function take(item: HdCase) {
    await send(`cases/${item.id}/assign`, {
      version: item.version,
      assigneeEmployeeId: me.employeeId,
    });
  }
  function ask(next: Acting) {
    setOpenKey(null);
    setError("");
    setActing(next);
  }

  const columns: Column<HdCase>[] = [
    {
      id: "case",
      label: copy.columns.case,
      isRowHeader: true,
      sortValue: (item) => item.subject,
      render: (item) => (
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm text-primary">{item.subject}</strong>
          <span className="text-sm text-tertiary">
            {item.code}
            {item.confidential ? ` · ${text.detail.confidential}` : ""}
          </span>
        </span>
      ),
    },
    ...(queue
      ? [
          {
            id: "requester",
            label: copy.columns.requester,
            sortValue: (item: HdCase) => item.requesterName,
            render: (item: HdCase) => (
              <span className="text-sm">
                {item.mine ? copy.mine : item.requesterName}
              </span>
            ),
          },
        ]
      : []),
    {
      id: "category",
      label: copy.columns.category,
      sortValue: (item) => item.categoryName,
      render: (item) => <span className="text-sm">{item.categoryName}</span>,
    },
    {
      id: "priority",
      label: copy.columns.priority,
      render: (item) => <PriorityCell item={item} />,
    },
    {
      id: "status",
      label: copy.columns.status,
      sortValue: (item) => item.status,
      render: (item) => <StatusCell item={item} />,
    },
    {
      id: "target",
      label: copy.columns.target,
      render: (item) => <TargetCell item={item} />,
    },
    ...(queue
      ? [
          {
            id: "assignee",
            label: copy.columns.assignee,
            sortValue: (item: HdCase) => item.assigneeName ?? "",
            render: (item: HdCase) => (
              <span className="text-sm">
                {item.assignedToMe
                  ? copy.mine
                  : (item.assigneeName ?? copy.unassigned)}
              </span>
            ),
          },
        ]
      : []),
  ];

  const detail: CollectionDetail<HdCase> = {
    title: (item) => item.subject,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {item.code}
        <StatusCell item={item} />
        <PriorityCell item={item} />
      </span>
    ),
    body: (item) => <CaseBody item={item} error={error} ask={ask} />,
    // The footer follows the freshly loaded case, not the list row, which may be a few seconds old.
    footer: (row) => {
      const item =
        opened.data && opened.data.case.id === row.id ? opened.data.case : row;
      return (
        <>
          {item.canTake && (
            <Button isDisabled={busy} onPress={() => void take(item)}>
              {text.actions.take}
            </Button>
          )}
          {item.canStart && (
            <Button isDisabled={busy} onPress={() => void step(item, "start")}>
              {text.actions.start}
            </Button>
          )}
          {item.canWait && (
            <Button
              variant="secondary"
              onPress={() => ask({ kind: "step", step: "wait", item })}
            >
              {text.actions.wait}
            </Button>
          )}
          {item.canResume && (
            <Button
              variant="secondary"
              onPress={() => ask({ kind: "step", step: "resume", item })}
            >
              {text.actions.resume}
            </Button>
          )}
          {item.canResolve && (
            <Button
              variant="secondary"
              onPress={() => ask({ kind: "step", step: "resolve", item })}
            >
              {text.actions.resolve}
            </Button>
          )}
          {item.canReopen && (
            <Button
              variant="secondary"
              onPress={() => ask({ kind: "step", step: "reopen", item })}
            >
              {text.actions.reopen}
            </Button>
          )}
          {item.canClose && (
            <Button onPress={() => ask({ kind: "close", item })}>
              {text.actions.close}
            </Button>
          )}
          {item.canCancel && (
            <Button
              variant="secondary"
              onPress={() => ask({ kind: "step", step: "cancel", item })}
            >
              {text.actions.cancel}
            </Button>
          )}
        </>
      );
    },
  };

  const filtered =
    Boolean(search) ||
    status !== "all" ||
    priority !== "all" ||
    category !== "all" ||
    breached !== "all";
  const dialog =
    acting && acting.kind === "step" ? text.dialogs[acting.step] : null;
  return (
    <div className="perf-tab hd-tab">
      <div className="recruit-toolbar">
        <div className="recruit-filters">
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          {queue && (
            <Select
              aria-label={text.filters.view}
              selectedKey={queueView}
              onSelectionChange={(key) => {
                setQueueView(String(key));
                setPage(1);
              }}
              className="kit-filter"
            >
              <Select.Item id="all" label={text.filters.all} />
              <Select.Item id="assigned" label={text.filters.assigned} />
              <Select.Item id="unassigned" label={text.filters.unassigned} />
            </Select>
          )}
          <FilterSelect
            label={text.common.status}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            allLabel={text.common.allStatuses}
            options={statuses.map((id) => ({
              id,
              label: text.status[id as HdCase["status"]],
            }))}
          />
          <FilterSelect
            label={text.common.priority}
            value={priority}
            onChange={(value) => {
              setPriority(value);
              setPage(1);
            }}
            allLabel={text.common.allPriorities}
            options={priorities.map((id) => ({
              id,
              label: text.priority[id],
            }))}
          />
          {queue && (
            <>
              <FilterSelect
                label={text.common.category}
                value={category}
                onChange={(value) => {
                  setCategory(value);
                  setPage(1);
                }}
                allLabel={text.common.allCategories}
                options={(categories.data?.items ?? []).map((k) => ({
                  id: k.id,
                  label: k.name,
                }))}
              />
              <FilterSelect
                label={text.filters.breached}
                value={breached}
                onChange={(value) => {
                  setBreached(value);
                  setPage(1);
                }}
                allLabel={text.filters.anyTarget}
                options={[{ id: "true", label: text.filters.breached }]}
              />
            </>
          )}
        </div>
        <Button
          onPress={() => {
            setError("");
            setNotice("");
            setActing({ kind: "raise" });
          }}
        >
          <Plus size={18} />
          {copy.raise}
        </Button>
      </div>
      {notice && (
        <p role="status" className="recruit-notice">
          {notice}
        </p>
      )}
      <CollectionView
        id={`hd-cases-${mode}`}
        label={queue ? text.tabs.queue : text.tabs.mine}
        noun="cases"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(item) => item.id}
        columns={columns}
        openKey={openKey}
        onOpenKeyChange={setOpenKey}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={Lifebuoy}
        emptyTitle={
          filtered ? copy.emptyFiltered : queue ? copy.emptyQueue : copy.empty
        }
        emptyDescription={queue ? copy.emptyQueueBody : copy.emptyBody}
        onClearFilters={
          filtered
            ? () => {
                setSearch("");
                setStatus("all");
                setPriority("all");
                setCategory("all");
                setBreached("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="min-w-0 break-words text-primary">
                {item.subject}
              </strong>
              <StatusCell item={item} />
            </div>
            <span className="text-sm text-tertiary">
              {item.code} · {item.categoryName}
              {queue ? ` · ${item.mine ? copy.mine : item.requesterName}` : ""}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <PriorityCell item={item} />
              <TargetCell item={item} />
            </div>
            {queue && (
              <span className="text-sm text-secondary">
                {item.assignedToMe
                  ? copy.mine
                  : (item.assigneeName ?? copy.unassigned)}
              </span>
            )}
          </div>
        )}
        detail={detail}
      />
      <RaiseForm
        open={acting?.kind === "raise"}
        onClose={() => setActing(null)}
        onRaised={(code) => setNotice(copy.raised(code))}
      />
      {acting?.kind === "step" && dialog && (
        <NoteDialog
          open
          title={dialog.title}
          body={dialog.body}
          label={dialog.label}
          submit={dialog.submit}
          required={acting.step === "cancel" || acting.step === "reopen"}
          onClose={() => setActing(null)}
          onSubmit={(note) => step(acting.item, acting.step, note)}
        />
      )}
      <CloseDialog
        item={acting?.kind === "close" ? acting.item : null}
        onClose={() => setActing(null)}
      />
      <AssignDialog
        item={acting?.kind === "assign" ? acting.item : null}
        onClose={() => setActing(null)}
      />
      <PriorityDialog
        item={acting?.kind === "priority" ? acting.item : null}
        onClose={() => setActing(null)}
      />
      <LinkDialog
        item={acting?.kind === "link" ? acting.item : null}
        onClose={() => setActing(null)}
      />
    </div>
  );
}

// The panel body loads the full case (thread, history, linked articles) on its own.
function CaseBody({
  item,
  error,
  ask,
}: {
  item: HdCase;
  error: string;
  ask: (next: Acting) => void;
}) {
  const { me } = useWorkspace();
  const full = useHdCase(item.id);
  const { send, busy, error: sendError, status } = useHdSend();
  const [message, setMessage] = useState("");
  const c = full.data?.case ?? item;
  const d = text.detail;
  const works =
    me.permissions.includes("helpdesk.agent") ||
    me.permissions.includes("helpdesk.manage");
  async function post(kind: "comment" | "internal") {
    const body = message.trim();
    if (!body) return;
    const done = await send(`cases/${c.id}/comments`, { kind, body });
    if (done !== null) setMessage("");
  }
  async function toggleConfidential() {
    await send(`cases/${c.id}/confidential`, {
      version: c.version,
      confidential: !c.confidential,
    });
  }
  return (
    <div className="flex flex-col gap-5">
      {c.mine && works && (
        <p role="note" className="recruit-notice hd-fourEyes">
          {d.fourEyes}
        </p>
      )}
      <DetailFields
        title={d.case}
        fields={[
          { label: d.code, value: c.code },
          { label: d.raisedBy, value: c.mine ? copy.mine : c.requesterName },
          { label: d.category, value: c.categoryName },
          { label: d.priority, value: text.priority[c.priority] },
          { label: d.status, value: text.status[c.status] },
          {
            label: d.assignedTo,
            value: c.assignedToMe
              ? copy.mine
              : (c.assigneeName ?? d.unassigned),
          },
          {
            label: d.confidential,
            value: c.confidential ? d.confidentialYes : null,
          },
          { label: d.raised, value: dateTime(c.createdAt) },
          {
            label: d.firstReplied,
            value: c.firstRespondedAt
              ? dateTime(c.firstRespondedAt)
              : d.noReplyYet,
          },
          {
            label: d.resolvedAt,
            value: c.resolvedAt && dateTime(c.resolvedAt),
          },
          {
            label: d.reopenUntil,
            value:
              c.canReopen && c.reopenUntil ? dateOnly(c.reopenUntil) : null,
          },
          {
            label: d.reopenCount,
            value: c.reopenCount > 0 ? d.reopenTimes(c.reopenCount) : null,
          },
          {
            label: d.rating,
            value:
              c.satisfaction !== null && c.mine
                ? d.ratingValue(c.satisfaction)
                : null,
          },
        ]}
      />
      <section className="flex flex-col gap-2" aria-label={d.sla}>
        <h3 className="text-sm font-semibold text-secondary">{d.sla}</h3>
        <dl className="hd-sla">
          <div>
            <dt>{d.responseDue}</dt>
            <dd>
              {dateTime(c.firstResponseDue)}
              {c.responseBreached && (
                <StatusPill label={text.sla.breachedResponse} color="error" />
              )}
            </dd>
          </div>
          <div>
            <dt>{d.resolveDue}</dt>
            <dd>
              {dateTime(c.resolveDue)}
              {c.resolveBreached && (
                <StatusPill label={text.sla.breachedResolve} color="error" />
              )}
            </dd>
          </div>
        </dl>
        <p className="recruit-muted">{d.slaBasis}</p>
      </section>
      <DetailFields
        title={d.description}
        fields={[{ label: d.description, value: c.description }]}
      />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-secondary">{d.articles}</h3>
        {full.data && full.data.articles.length > 0 ? (
          <ul className="perf-krs" aria-label={d.articles}>
            {full.data.articles.map((a) => (
              <li key={a.articleId} className="perf-kr">
                <strong>{a.title ?? d.articleHidden}</strong>
                <span className="recruit-muted">
                  {a.linkedBy} · {dateOnly(a.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tertiary">{d.noArticles}</p>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-secondary">{d.thread}</h3>
        {full.error ? (
          <p role="alert" className="inline-error">
            {full.error.message}
          </p>
        ) : !full.data ? (
          <div className="cv-skeleton h-16 rounded-xl bg-secondary" />
        ) : full.data.comments.length === 0 ? (
          <p className="text-sm text-tertiary">{d.noThread}</p>
        ) : (
          <ol className="hd-thread" aria-label={d.thread}>
            {full.data.comments.map((m) => (
              <li
                key={m.id}
                className="hd-message"
                data-kind={m.kind}
                data-mine={m.mine ? "" : undefined}
              >
                <div className="hd-message-head">
                  <strong>{m.mine ? text.common.you : m.authorLabel}</strong>
                  <span className="recruit-muted">
                    {m.authorRole === "agent" ? d.agent : d.requester} ·{" "}
                    {dateTime(m.at)}
                  </span>
                </div>
                {m.kind === "internal" && (
                  <StatusPill label={d.internalLabel} color="warning" />
                )}
                <p className="hd-message-body">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
        {c.canComment && (
          <div className="hd-composer">
            <TextArea
              label={text.thread.composer}
              value={message}
              onChange={setMessage}
              maxLength={4000}
              hint={
                c.canAddInternalNote ? text.thread.composerHintAgent : undefined
              }
            />
            <div className="leave-actions">
              {c.canAddInternalNote && (
                <Button
                  variant="secondary"
                  isDisabled={busy || !message.trim()}
                  onPress={() => void post("internal")}
                >
                  {text.thread.addNote}
                </Button>
              )}
              <Button
                isDisabled={busy || !message.trim()}
                onPress={() => void post("comment")}
              >
                {c.canAddInternalNote
                  ? text.thread.sendReply
                  : text.thread.sendComment}
              </Button>
            </div>
          </div>
        )}
      </section>
      {(c.canAssign ||
        c.canChangePriority ||
        c.canChangeConfidential ||
        c.canLinkArticle) && (
        <section
          className="flex flex-col gap-2"
          aria-label={text.actions.manage}
        >
          <h3 className="text-sm font-semibold text-secondary">
            {text.actions.manage}
          </h3>
          <div className="leave-actions">
            {c.canAssign && (
              <Button
                variant="secondary"
                onPress={() => ask({ kind: "assign", item: c })}
              >
                {text.actions.assign}
              </Button>
            )}
            {c.canChangePriority && (
              <Button
                variant="secondary"
                onPress={() => ask({ kind: "priority", item: c })}
              >
                {text.actions.priority}
              </Button>
            )}
            {c.canChangeConfidential && (
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => void toggleConfidential()}
              >
                {c.confidential
                  ? text.actions.confidentialOff
                  : text.actions.confidentialOn}
              </Button>
            )}
            {c.canLinkArticle && (
              <Button
                variant="secondary"
                onPress={() => ask({ kind: "link", item: c })}
              >
                {text.actions.linkArticle}
              </Button>
            )}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-secondary">{d.history}</h3>
        {full.data && full.data.history.length > 0 ? (
          <ol className="perf-history" aria-label={d.history}>
            {full.data.history.map((h) => (
              <li key={h.id}>
                {(h.fromStatus === null || h.fromStatus !== h.toStatus) && (
                  <strong>
                    {d.historyLine.status(
                      h.fromStatus ? text.status[h.fromStatus] : null,
                      text.status[h.toStatus],
                    )}
                  </strong>
                )}
                {h.assigneeChanged && (
                  <span>{d.historyLine.assigned(h.assigneeName)}</span>
                )}
                {h.priorityChanged && (
                  <span>
                    {d.historyLine.priority(text.priority[h.priority])}
                  </span>
                )}
                {h.confidentialChanged && (
                  <span>{d.historyLine.confidential(h.confidential)}</span>
                )}
                <span className="recruit-muted">
                  {h.byLabel} · {dateTime(h.at)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-tertiary">{d.noHistory}</p>
        )}
      </section>
      <FormError
        message={
          status === 409 && sendError ? text.thread.full : error || sendError
        }
      />
    </div>
  );
}

function RaiseForm({
  open,
  onClose,
  onRaised,
}: {
  open: boolean;
  onClose: () => void;
  onRaised: (code: string) => void;
}) {
  return (
    <Modal open={open} title={copy.raiseTitle} onClose={onClose}>
      {open && <RaiseFields onClose={onClose} onRaised={onRaised} />}
    </Modal>
  );
}

function RaiseFields({
  onClose,
  onRaised,
}: {
  onClose: () => void;
  onRaised: (code: string) => void;
}) {
  const { send, busy, error } = useHdSend();
  const categories = useHdCategories(true);
  const [categoryId, setCategoryId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<HdCase["priority"]>("normal");
  const [confidential, setConfidential] = useState(false);
  const typed = useDebounced(subject.trim(), 400);
  const wantsHelp = typed.length >= 3;
  const suggestions = useHdSuggestions(wantsHelp, categoryId, typed);
  const published = useHdArticles(wantsHelp, "status=published&limit=100");
  const active = (categories.data?.items ?? []).filter((k) => k.active);
  const chosen = active.find((k) => k.id === categoryId);
  const ready =
    categoryId !== "" &&
    subject.trim().length >= 3 &&
    description.trim().length >= 10;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send(
      "cases",
      {
        categoryId,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        confidential: confidential || Boolean(chosen?.confidential),
      },
      "POST",
      hdCaseDetailSchema,
    );
    if (done) {
      onRaised(done.case.code);
      onClose();
    }
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.raiseIntro}</p>
      <Select
        label={copy.fields.category}
        placeholder={copy.fields.category}
        selectedKey={categoryId || null}
        onSelectionChange={(key) => key && setCategoryId(String(key))}
        isRequired
      >
        {active.map((k) => (
          <Select.Item key={k.id} id={k.id} label={k.name} />
        ))}
      </Select>
      <Input
        label={copy.fields.subject}
        value={subject}
        onChange={setSubject}
        maxLength={160}
        isRequired
        hideRequiredIndicator
      />
      {wantsHelp && (
        <section className="hd-suggest" aria-label={copy.suggestedTitle}>
          <h3>{copy.suggestedTitle}</h3>
          <p className="recruit-muted">{copy.suggestedLabel}</p>
          {suggestions.data && suggestions.data.items.length > 0 ? (
            <ul>
              {suggestions.data.items.map((s) => {
                const article = published.data?.items.find(
                  (a) => a.id === s.id,
                );
                return (
                  <li key={s.id}>
                    <details>
                      <summary>
                        <strong>{s.title}</strong>
                        <span className="recruit-muted">
                          {copy.suggestedMatched(s.matchedWords)}
                        </span>
                      </summary>
                      <p>{article?.body ?? text.common.loading}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="recruit-muted">{copy.suggestedNone}</p>
          )}
        </section>
      )}
      <TextArea
        label={copy.fields.description}
        value={description}
        onChange={setDescription}
        maxLength={4000}
        isRequired
      />
      <SelectField
        label={copy.fields.priority}
        value={priority}
        onChange={setPriority}
        options={priorities}
        labels={text.priority}
      />
      <Checkbox
        isSelected={confidential || Boolean(chosen?.confidential)}
        isDisabled={Boolean(chosen?.confidential)}
        onChange={setConfidential}
        label={copy.fields.confidential}
        hint={
          chosen?.confidential
            ? copy.confidentialCategory
            : copy.confidentialHint
        }
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={copy.submit}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}

function CloseDialog({
  item,
  onClose,
}: {
  item: HdCase | null;
  onClose: () => void;
}) {
  const d = text.dialogs.close;
  return (
    <Modal open={item !== null} title={d.title} onClose={onClose}>
      {item && <CloseFields key={item.id} item={item} onClose={onClose} />}
    </Modal>
  );
}
function CloseFields({ item, onClose }: { item: HdCase; onClose: () => void }) {
  const d = text.dialogs.close;
  const { send, busy, error } = useHdSend();
  const [rating, setRating] = useState("none");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await send(`cases/${item.id}/close`, {
      version: item.version,
      ...(item.mine && rating !== "none"
        ? { satisfaction: Number(rating) }
        : {}),
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{item.mine ? d.requesterBody : d.agentBody}</p>
      {item.mine && (
        <Select
          label={d.rating}
          selectedKey={rating}
          onSelectionChange={(key) => setRating(String(key))}
        >
          <Select.Item id="none" label={d.ratingNone} />
          {[5, 4, 3, 2, 1].map((n) => (
            <Select.Item key={n} id={String(n)} label={d.ratingOption(n)} />
          ))}
        </Select>
      )}
      <FormError message={error} />
      <FormActions busy={busy} submit={d.submit} onCancel={onClose} />
    </form>
  );
}

function AssignDialog({
  item,
  onClose,
}: {
  item: HdCase | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={item !== null}
      title={text.dialogs.assign.title}
      onClose={onClose}
    >
      {item && <AssignFields key={item.id} item={item} onClose={onClose} />}
    </Modal>
  );
}
function AssignFields({
  item,
  onClose,
}: {
  item: HdCase;
  onClose: () => void;
}) {
  const d = text.dialogs.assign;
  const { send, busy, error } = useHdSend();
  const agents = useHdAgents(true);
  const [assignee, setAssignee] = useState("");
  const options = (agents.data?.items ?? []).filter(
    (a) => a.employeeId !== item.requesterEmployeeId,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!assignee) return;
    const done = await send(`cases/${item.id}/assign`, {
      version: item.version,
      assigneeEmployeeId: assignee,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{d.body}</p>
      {agents.data && options.length === 0 ? (
        <p className="recruit-muted">{d.empty}</p>
      ) : (
        <Select
          label={d.field}
          placeholder={d.none}
          selectedKey={assignee || null}
          onSelectionChange={(key) => key && setAssignee(String(key))}
        >
          {options.map((a) => (
            <Select.Item key={a.employeeId} id={a.employeeId} label={a.name} />
          ))}
        </Select>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={d.submit}
        onCancel={onClose}
        disabled={!assignee}
      />
    </form>
  );
}

function PriorityDialog({
  item,
  onClose,
}: {
  item: HdCase | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={item !== null}
      title={text.dialogs.priority.title}
      onClose={onClose}
    >
      {item && <PriorityFields key={item.id} item={item} onClose={onClose} />}
    </Modal>
  );
}
function PriorityFields({
  item,
  onClose,
}: {
  item: HdCase;
  onClose: () => void;
}) {
  const d = text.dialogs.priority;
  const { send, busy, error } = useHdSend();
  const [priority, setPriority] = useState<HdCase["priority"]>(item.priority);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await send(`cases/${item.id}/priority`, {
      version: item.version,
      priority,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{d.body}</p>
      <SelectField
        label={d.field}
        value={priority}
        onChange={setPriority}
        options={priorities}
        labels={text.priority}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={d.submit}
        onCancel={onClose}
        disabled={priority === item.priority}
      />
    </form>
  );
}

function LinkDialog({
  item,
  onClose,
}: {
  item: HdCase | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={item !== null}
      title={text.dialogs.link.title}
      onClose={onClose}
    >
      {item && <LinkFields key={item.id} item={item} onClose={onClose} />}
    </Modal>
  );
}
function LinkFields({ item, onClose }: { item: HdCase; onClose: () => void }) {
  const d = text.dialogs.link;
  const { send, busy, error } = useHdSend();
  const articles = useHdArticles(true, "status=published&limit=100");
  const [articleId, setArticleId] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!articleId) return;
    const done = await send(`cases/${item.id}/articles`, { articleId });
    if (done !== null) onClose();
  }
  const options = articles.data?.items ?? [];
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{d.body}</p>
      {articles.data && options.length === 0 ? (
        <p className="recruit-muted">{d.empty}</p>
      ) : (
        <Select
          label={d.field}
          placeholder={d.none}
          selectedKey={articleId || null}
          onSelectionChange={(key) => key && setArticleId(String(key))}
        >
          {options.map((a) => (
            <Select.Item key={a.id} id={a.id} label={a.title} />
          ))}
        </Select>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={d.submit}
        onCancel={onClose}
        disabled={!articleId}
      />
    </form>
  );
}
