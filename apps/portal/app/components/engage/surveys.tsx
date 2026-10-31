import { useState, type FormEvent } from "react";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  RadioButton,
  RadioGroup,
  RangeInput,
  Select,
  TextArea,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import {
  ENG_RESULTS_THRESHOLD,
  engResponseResultSchema,
  engSurveyDetailSchema,
  type EngSurvey,
  type EngSurveyDetail,
} from "@anvi/contracts";
import { useEngSurvey, useEngSurveys, useEngResults } from "../../lib/api";
import { engageCopy as text } from "../../lib/copy/engage";
import {
  FormActions,
  FormError,
  Modal,
  StatusPill,
  dateTime,
  useEngSend,
} from "./shared";

const copy = text.surveys;
type Color = "gray" | "brand" | "error" | "warning" | "success";

function surveyState(item: EngSurvey): { label: string; color: Color } {
  if (item.status === "draft")
    return { label: copy.status.draft, color: "gray" };
  if (item.status === "closed")
    return { label: copy.status.closed, color: "gray" };
  if (item.acceptingAnswers)
    return { label: copy.status.published, color: "success" };
  return Date.parse(item.opensAt) > Date.now()
    ? { label: copy.notYetOpen, color: "warning" }
    : { label: copy.ended, color: "gray" };
}

function Anonymity({ compact }: { compact?: boolean }) {
  return (
    <section className="eng-anon" aria-label={text.anonymity.heading}>
      <LockKey size={20} weight="duotone" aria-hidden />
      <div>
        <h3 className="eng-h3">{text.anonymity.heading}</h3>
        <p>{text.anonymity.body}</p>
        {!compact && <p>{text.anonymity.limits}</p>}
        <p>{text.anonymity.seen}</p>
      </div>
    </section>
  );
}

type Acting =
  | { kind: "respond"; item: EngSurvey }
  | { kind: "edit"; item: EngSurvey | "new" }
  | { kind: "publish"; item: EngSurvey }
  | { kind: "close"; item: EngSurvey }
  | { kind: "results"; item: EngSurvey };

export function SurveysTab({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [acting, setActing] = useState<Acting | null>(null);
  const query = new URLSearchParams({ page: String(page), limit: "10" });
  if (status !== "all") query.set("status", status);
  const list = useEngSurveys(true, query.toString());
  const columns: Column<EngSurvey>[] = [
    {
      id: "title",
      label: copy.columns.title,
      isRowHeader: true,
      sortValue: (item) => item.title,
      render: (item) => (
        <strong className="text-sm text-primary" dir="auto">
          {item.title}
        </strong>
      ),
    },
    {
      id: "status",
      label: copy.columns.status,
      sortValue: (item) => surveyState(item).label,
      render: (item) => {
        const state = surveyState(item);
        return <StatusPill label={state.label} color={state.color} />;
      },
    },
    {
      id: "closes",
      label: copy.columns.closes,
      sortValue: (item) => item.closesAt,
      render: (item) => (
        <span className="text-sm">{dateTime(item.closesAt)}</span>
      ),
    },
    {
      id: "you",
      label: canManage ? copy.columns.answers : copy.columns.you,
      render: (item) => (
        <span className="text-sm">
          {canManage && item.responseCount !== null
            ? copy.responses(item.responseCount, item.eligibleCount ?? 0)
            : item.responded
              ? copy.responded
              : item.canRespond
                ? copy.respond
                : ""}
        </span>
      ),
    },
  ];
  const detail: CollectionDetail<EngSurvey> = {
    title: (item) => item.title,
    subtitle: (item) => {
      const state = surveyState(item);
      return <StatusPill label={state.label} color={state.color} />;
    },
    body: (item) => (
      <div className="flex flex-col gap-5">
        <DetailFields
          fields={[
            { label: text.editor.opens, value: dateTime(item.opensAt) },
            { label: text.editor.closes, value: dateTime(item.closesAt) },
            {
              label: text.editor.questions,
              value: copy.questions(item.questionCount),
            },
            {
              label: copy.columns.answers,
              value:
                item.responseCount !== null
                  ? copy.responses(item.responseCount, item.eligibleCount ?? 0)
                  : "",
            },
            {
              label: copy.columns.you,
              value: item.responded ? copy.responded : "",
            },
          ]}
        />
        {!item.responded && item.canRespond && <Anonymity compact />}
      </div>
    ),
    footer: (item, close) => (
      <div className="leave-actions">
        {item.canRespond && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "respond", item });
            }}
          >
            {copy.respond}
          </Button>
        )}
        {item.canEdit && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "edit", item });
            }}
          >
            {copy.edit}
          </Button>
        )}
        {item.canPublish && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "publish", item });
            }}
          >
            {copy.publish}
          </Button>
        )}
        {item.canClose && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "close", item });
            }}
          >
            {copy.close}
          </Button>
        )}
        {canManage && item.status !== "draft" && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "results", item });
            }}
          >
            {copy.results}
          </Button>
        )}
      </div>
    ),
  };
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const filtered = status !== "all";
  const done = () => setActing(null);
  return (
    <div className="eng-tab perf-tab">
      <p className="recruit-muted">{copy.intro}</p>
      <Anonymity />
      <div className="recruit-filters">
        {canManage && (
          <Button onPress={() => setActing({ kind: "edit", item: "new" })}>
            <Plus size={18} aria-hidden />
            {copy.new}
          </Button>
        )}
        {canManage && (
          <Select
            aria-label={copy.filterLabel}
            selectedKey={status}
            onSelectionChange={(key) => {
              setStatus(String(key));
              setPage(1);
            }}
            className="kit-filter"
          >
            <Select.Item id="all" label={copy.all} />
            <Select.Item id="draft" label={copy.status.draft} />
            <Select.Item id="published" label={copy.status.published} />
            <Select.Item id="closed" label={copy.status.closed} />
          </Select>
        )}
      </div>
      <CollectionView
        id="eng-surveys"
        label={text.tabs.surveys}
        noun="surveys"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(item) => item.id}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={ClipboardText}
        emptyTitle={canManage ? copy.emptyHr : copy.emptyTitle}
        emptyDescription={canManage ? copy.emptyHrBody : copy.emptyBody}
        onClearFilters={filtered ? () => setStatus("all") : undefined}
        renderCard={(item) => {
          const state = surveyState(item);
          return (
            <div className="flex min-w-0 flex-col gap-2">
              <strong className="min-w-0 break-words text-primary">
                <bdi>{item.title}</bdi>
              </strong>
              <span className="flex flex-wrap items-center gap-2">
                <StatusPill label={state.label} color={state.color} />
                {!canManage && item.responded && (
                  <StatusPill label={copy.responded} color="success" />
                )}
                {!canManage && !item.responded && item.canRespond && (
                  <StatusPill label={copy.respond} color="brand" />
                )}
              </span>
              <span className="text-sm text-tertiary">
                {copy.closes(dateTime(item.closesAt))} ·{" "}
                {copy.questions(item.questionCount)}
                {canManage && item.responseCount !== null
                  ? ` · ${copy.responses(item.responseCount, item.eligibleCount ?? 0)}`
                  : ""}
              </span>
            </div>
          );
        }}
        detail={detail}
      />
      {acting?.kind === "respond" && (
        <RespondDialog item={acting.item} onClose={done} />
      )}
      {acting?.kind === "edit" && (
        <EditorDialog item={acting.item} onClose={done} />
      )}
      {(acting?.kind === "publish" || acting?.kind === "close") && (
        <StepDialog item={acting.item} step={acting.kind} onClose={done} />
      )}
      {acting?.kind === "results" && (
        <ResultsDialog item={acting.item} onClose={done} />
      )}
    </div>
  );
}

// ---- Answer a survey ----

type Answer = { rating?: number; choice?: number; text?: string };

function RespondDialog({
  item,
  onClose,
}: {
  item: EngSurvey;
  onClose: () => void;
}) {
  const detail = useEngSurvey(item.id);
  return (
    <Modal open title={item.title} onClose={onClose} wide>
      {detail.error ? (
        <ErrorState
          message={detail.error.message}
          onRetry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <p className="recruit-muted">{text.common.loading}</p>
      ) : (
        <RespondForm detail={detail.data} onClose={onClose} />
      )}
    </Modal>
  );
}

function RespondForm({
  detail,
  onClose,
}: {
  detail: EngSurveyDetail;
  onClose: () => void;
}) {
  const { send, busy, error } = useEngSend();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [sent, setSent] = useState(false);
  const copyR = text.respond;
  const set = (id: string, patch: Answer) =>
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const complete = detail.questions.every((q) => {
    if (!q.required) return true;
    const a = answers[q.id];
    return q.kind === "rating"
      ? a?.rating !== undefined
      : a?.choice !== undefined;
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    const body = {
      answers: detail.questions.flatMap((q): Record<string, unknown>[] => {
        const a = answers[q.id];
        if (!a) return [];
        if (q.kind === "rating" && a.rating !== undefined)
          return [{ questionId: q.id, rating: a.rating }];
        if (q.kind === "choice" && a.choice !== undefined)
          return [{ questionId: q.id, choice: a.choice }];
        if (q.kind === "text" && a.text?.trim())
          return [{ questionId: q.id, text: a.text.trim() }];
        return [];
      }),
    };
    const done = await send(
      `surveys/${detail.survey.id}/responses`,
      body,
      "POST",
      engResponseResultSchema,
    );
    if (done) setSent(true);
  }
  if (sent)
    return (
      <div className="leave-form">
        <h3 className="eng-h3" role="status">
          {copyR.confirmTitle}
        </h3>
        <p>{copyR.confirmBody}</p>
        <div className="leave-actions">
          <Button onPress={onClose}>{text.common.close}</Button>
        </div>
      </div>
    );
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Anonymity />
      {detail.questions.map((q, index) => (
        <fieldset key={q.id} className="eng-question">
          <legend>
            <span className="eng-qn">{text.editor.questionN(index + 1)}</span>
            <span className="eng-prompt" dir="auto">
              {q.prompt}
            </span>
            <span className="eng-req">
              {q.required ? copyR.required : copyR.optional}
            </span>
          </legend>
          {q.kind === "rating" && (
            <>
              <RadioGroup
                aria-label={`${q.prompt}. ${copyR.ratingLabel}`}
                orientation="horizontal"
                value={
                  answers[q.id]?.rating !== undefined
                    ? String(answers[q.id]?.rating)
                    : ""
                }
                onChange={(value) => set(q.id, { rating: Number(value) })}
                isDisabled={busy}
                size="md"
                className="eng-rating"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <RadioButton key={n} value={String(n)} label={String(n)} />
                ))}
              </RadioGroup>
              <p className="recruit-muted">
                {copyR.scaleLow}, {copyR.scaleHigh}
              </p>
            </>
          )}
          {q.kind === "choice" && (
            <RadioGroup
              aria-label={q.prompt}
              value={
                answers[q.id]?.choice !== undefined
                  ? String(answers[q.id]?.choice)
                  : ""
              }
              onChange={(value) => set(q.id, { choice: Number(value) })}
              isDisabled={busy}
              size="md"
              className="gap-2"
            >
              {q.options.map((option, i) => (
                <RadioButton
                  key={i}
                  value={String(i)}
                  label={option}
                  dir="auto"
                />
              ))}
            </RadioGroup>
          )}
          {q.kind === "text" && (
            <TextArea
              aria-label={`${q.prompt}. ${copyR.textLabel}`}
              hint={copyR.textCounter(answers[q.id]?.text?.length ?? 0)}
              value={answers[q.id]?.text ?? ""}
              onChange={(value) => set(q.id, { text: value })}
              maxLength={500}
              isDisabled={busy}
            />
          )}
        </fieldset>
      ))}
      <FormError message={error} />
      {!complete && <p className="recruit-muted">{copyR.needAll}</p>}
      <FormActions
        busy={busy}
        submit={copyR.submit}
        busyLabel={copyR.sending}
        onCancel={onClose}
        disabled={!complete}
      />
    </form>
  );
}

// ---- Publish or close ----

function StepDialog({
  item,
  step,
  onClose,
}: {
  item: EngSurvey;
  step: "publish" | "close";
  onClose: () => void;
}) {
  const { send, busy, error } = useEngSend();
  const c = text.confirm;
  async function go(event: FormEvent) {
    event.preventDefault();
    const done = await send(
      `surveys/${item.id}/${step}`,
      { version: item.version },
      "POST",
      engSurveyDetailSchema,
    );
    if (done) onClose();
  }
  return (
    <Modal
      open
      title={step === "publish" ? c.publishTitle : c.closeTitle}
      onClose={() => !busy && onClose()}
    >
      <form className="leave-form" onSubmit={(event) => void go(event)}>
        <p>
          <strong>
            <bdi>{item.title}</bdi>
          </strong>
        </p>
        <p>{step === "publish" ? c.publishBody : c.closeBody}</p>
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={step === "publish" ? c.publishSubmit : c.closeSubmit}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

// ---- Create or edit a draft ----

type DraftQuestion = {
  key: number;
  kind: "rating" | "choice" | "text";
  prompt: string;
  options: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
// <input type="datetime-local"> works in the browser's own time zone.
const toLocalInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

function EditorDialog({
  item,
  onClose,
}: {
  item: EngSurvey | "new";
  onClose: () => void;
}) {
  const detail = useEngSurvey(item === "new" ? null : item.id);
  return (
    <Modal
      open
      title={item === "new" ? text.editor.newTitle : text.editor.editTitle}
      onClose={onClose}
      wide
    >
      {item !== "new" && detail.error ? (
        <ErrorState
          message={detail.error.message}
          onRetry={() => void detail.refetch()}
        />
      ) : item !== "new" && !detail.data ? (
        <p className="recruit-muted">{text.common.loading}</p>
      ) : (
        <EditorForm
          detail={item === "new" ? null : (detail.data ?? null)}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function EditorForm({
  detail,
  onClose,
}: {
  detail: EngSurveyDetail | null;
  onClose: () => void;
}) {
  const { send, busy, error } = useEngSend();
  const c = text.editor;
  const now = new Date();
  now.setSeconds(0, 0);
  const [title, setTitle] = useState(detail?.survey.title ?? "");
  const [opens, setOpens] = useState(
    toLocalInput(detail ? new Date(detail.survey.opensAt) : now),
  );
  const [closes, setCloses] = useState(
    toLocalInput(
      detail
        ? new Date(detail.survey.closesAt)
        : new Date(now.getTime() + 7 * 24 * 3600 * 1000),
    ),
  );
  const [counter, setCounter] = useState(detail?.questions.length ?? 1);
  const [questions, setQuestions] = useState<DraftQuestion[]>(
    detail
      ? detail.questions.map((q, i) => ({
          key: i,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options.join("\n"),
        }))
      : [{ key: 0, kind: "rating", prompt: "", options: "" }],
  );
  const patch = (key: number, change: Partial<DraftQuestion>) =>
    setQuestions((prev) =>
      prev.map((q) => (q.key === key ? { ...q, ...change } : q)),
    );
  const optionList = (q: DraftQuestion) =>
    q.options
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
  function problem() {
    if (title.trim().length < 3) return c.titleHint;
    const o = Date.parse(opens);
    const cl = Date.parse(closes);
    if (!(cl > o) || cl - o > 92 * 24 * 3600 * 1000) return c.closeAfterOpen;
    if (questions.length < 1) return c.needQuestions;
    for (const [i, q] of questions.entries()) {
      if (q.prompt.trim().length < 3) return c.fixQuestion(i + 1);
      if (q.kind === "choice") {
        const list = optionList(q);
        if (
          list.length < 2 ||
          list.length > 8 ||
          new Set(list.map((x) => x.toLowerCase())).size !== list.length
        )
          return c.fixOptions(i + 1);
      }
    }
    return "";
  }
  const issue = problem();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (issue) return;
    const body = {
      title: title.trim(),
      opensAt: new Date(opens).toISOString(),
      closesAt: new Date(closes).toISOString(),
      questions: questions.map((q) =>
        q.kind === "choice"
          ? { kind: q.kind, prompt: q.prompt.trim(), options: optionList(q) }
          : { kind: q.kind, prompt: q.prompt.trim() },
      ),
    };
    const done = detail
      ? await send(
          `surveys/${detail.survey.id}`,
          { ...body, version: detail.survey.version },
          "PUT",
          engSurveyDetailSchema,
        )
      : await send("surveys", body, "POST", engSurveyDetailSchema);
    if (done) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={c.surveyTitle}
        hint={c.titleHint}
        value={title}
        onChange={setTitle}
        maxLength={120}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <div className="leave-dates">
        <RangeInput
          type="datetime-local"
          label={c.opens}
          value={opens}
          onChange={setOpens}
          isRequired
        />
        <RangeInput
          type="datetime-local"
          label={c.closes}
          value={closes}
          onChange={setCloses}
          isRequired
        />
      </div>
      <p className="recruit-muted">{c.windowHint}</p>
      <h3 className="eng-h3">{c.questions}</h3>
      <p className="recruit-muted">{c.questionsHint}</p>
      {questions.map((q, index) => (
        <fieldset key={q.key} className="eng-question">
          <legend>
            <span className="eng-qn">{c.questionN(index + 1)}</span>
          </legend>
          <Select
            label={c.kind}
            selectedKey={q.kind}
            onSelectionChange={(key) =>
              patch(q.key, { kind: String(key) as DraftQuestion["kind"] })
            }
          >
            {(["rating", "choice", "text"] as const).map((kind) => (
              <Select.Item key={kind} id={kind} label={c.kinds[kind]} />
            ))}
          </Select>
          <Input
            label={`${c.prompt} (${c.questionN(index + 1)})`}
            hint={c.promptHint}
            value={q.prompt}
            onChange={(value) => patch(q.key, { prompt: value })}
            maxLength={200}
          />
          {q.kind === "choice" && (
            <TextArea
              label={`${c.options} (${c.questionN(index + 1)})`}
              hint={c.optionsHint}
              value={q.options}
              onChange={(value) => patch(q.key, { options: value })}
            />
          )}
          {questions.length > 1 && (
            <Button
              variant="ghost"
              onPress={() =>
                setQuestions((prev) => prev.filter((x) => x.key !== q.key))
              }
            >
              <Trash size={16} aria-hidden />
              {`${c.removeQuestion} ${index + 1}`}
            </Button>
          )}
        </fieldset>
      ))}
      {questions.length < 12 && (
        <Button
          variant="secondary"
          onPress={() => {
            setQuestions((prev) => [
              ...prev,
              { key: counter, kind: "rating", prompt: "", options: "" },
            ]);
            setCounter((n) => n + 1);
          }}
        >
          <Plus size={16} aria-hidden />
          {c.addQuestion}
        </Button>
      )}
      {issue && <p className="recruit-muted">{issue}</p>}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={c.save}
        onCancel={onClose}
        disabled={Boolean(issue)}
      />
    </form>
  );
}

// ---- Results (HR) ----

function ResultsDialog({
  item,
  onClose,
}: {
  item: EngSurvey;
  onClose: () => void;
}) {
  const results = useEngResults(item.id);
  const r = text.results;
  const data = results.data;
  return (
    <Modal open title={r.title(item.title)} onClose={onClose} wide>
      {results.error ? (
        <ErrorState
          message={results.error.message}
          onRetry={() => void results.refetch()}
        />
      ) : !data ? (
        <p className="recruit-muted">{text.common.loading}</p>
      ) : (
        <div className="eng-results">
          <p>
            <strong>{r.responses(data.responses, data.eligible)}</strong>
          </p>
          {data.withheld ? (
            <p className="recruit-notice" role="status">
              {data.withheld === "too_few_responses"
                ? r.withheld.too_few_responses(
                    data.threshold || ENG_RESULTS_THRESHOLD,
                  )
                : r.withheld[data.withheld]}
            </p>
          ) : (
            <>
              <p className="recruit-muted">{r.released}</p>
              {data.questions.map((q, index) => (
                <section key={q.questionId} className="eng-result">
                  <h3 className="eng-h3">
                    {text.editor.questionN(index + 1)}: {q.prompt}
                  </h3>
                  <p className="recruit-muted">{r.answered(q.answered)}</p>
                  {q.kind === "rating" && (
                    <p>
                      {q.average === null || q.average === undefined
                        ? r.noAverage
                        : r.average(q.average)}
                    </p>
                  )}
                  {q.kind !== "text" && (
                    <ul className="eng-bars">
                      {(q.counts ?? []).map((count, i) => {
                        const label =
                          q.kind === "rating"
                            ? r.score(i + 1)
                            : (q.options?.[i] ?? String(i + 1));
                        const width = q.answered
                          ? Math.round((count / q.answered) * 100)
                          : 0;
                        return (
                          <li key={i}>
                            <span dir="auto">
                              {r.barLine(label, count, q.answered)}
                            </span>
                            <span className="eng-track" aria-hidden>
                              <span style={{ width: `${width}%` }} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {q.kind === "text" && (
                    <>
                      <p className="recruit-muted">{r.texts}</p>
                      {(q.texts ?? []).length === 0 ? (
                        <p className="recruit-muted">{r.noTexts}</p>
                      ) : (
                        <ul className="eng-texts">
                          {(q.texts ?? []).map((t, i) => (
                            <li key={i} dir="auto">
                              {t}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="recruit-muted">{r.textNote}</p>
                    </>
                  )}
                </section>
              ))}
            </>
          )}
          <div className="leave-actions">
            <Button onPress={onClose}>
              <ChartBar size={16} aria-hidden />
              {text.common.close}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
