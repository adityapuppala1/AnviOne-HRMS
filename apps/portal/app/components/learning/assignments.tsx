import { useState } from "react";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { LrnAssignment } from "@anvi/contracts";
import {
  useLrnAssignment,
  useLrnAssignments,
  useLrnCourse,
  useLrnCourses,
} from "../../lib/learning-api";
import { learningCopy as text } from "../../lib/copy/learning";
import { useWorkspace } from "../../routes/workspace";
import {
  CourseLink,
  FilterSelect,
  FormError,
  NoteDialog,
  StatusPill,
  assignmentColor,
  dateOnly,
  dateTime,
  dueLabel,
  renewalColor,
  useLrnSend,
} from "./shared";

const copy = text.assignments;
const statuses = Object.keys(text.status) as LrnAssignment["status"][];
const renewals = Object.keys(text.renewal) as NonNullable<
  LrnAssignment["renewal"]
>[];

type Acting = {
  kind: "complete" | "record" | "waive";
  item: LrnAssignment;
};

// Status, overdue and renewal always appear in words, so nothing depends on colour alone.
export function Badges({ item }: { item: LrnAssignment }) {
  return (
    <span className="lrn-badges">
      <StatusPill
        label={text.status[item.status]}
        color={assignmentColor[item.status]}
      />
      {item.overdue && <StatusPill label={text.badge.overdue} color="error" />}
      {item.renewal && (
        <StatusPill
          label={text.renewal[item.renewal]}
          color={renewalColor[item.renewal]}
        />
      )}
    </span>
  );
}

function audienceLabel(item: LrnAssignment) {
  if (item.audience === "employee")
    return item.mine ? text.audience.employee : text.audience.employeeOther;
  return text.audience[item.audience];
}

export function AssignmentsTab({ mode }: { mode: "mine" | "team" | "all" }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [overdue, setOverdue] = useState("all");
  const [renewal, setRenewal] = useState("all");
  const [course, setCourse] = useState("all");
  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
    view: mode,
  });
  if (status !== "all") query.set("status", status);
  if (overdue !== "all") query.set("overdue", "true");
  if (renewal !== "all") query.set("renewal", renewal);
  if (course !== "all") query.set("courseId", course);
  const list = useLrnAssignments(true, query.toString());
  const courses = useLrnCourses(mode === "all", "limit=100");
  const { send, busy, error, setError, latestError } = useLrnSend();
  const [acting, setActing] = useState<Acting | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = useLrnAssignment(openKey);
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  const people = mode !== "mine";
  const label =
    mode === "mine"
      ? copy.mineLabel
      : mode === "team"
        ? copy.teamLabel
        : copy.allLabel;

  async function start(item: LrnAssignment) {
    await send(`assignments/${item.id}/start`, { version: item.version });
  }
  function ask(kind: Acting["kind"], item: LrnAssignment) {
    setOpenKey(null);
    setError("");
    setActing({ kind, item });
  }
  async function finish(note: string) {
    if (!acting) return false;
    const { kind, item } = acting;
    const done =
      kind === "complete"
        ? await send(`assignments/${item.id}/complete`, {
            version: item.version,
            ...(note ? { note } : {}),
          })
        : await send(
            `assignments/${item.id}/hr/${kind === "record" ? "complete" : "waive"}`,
            { version: item.version, reason: note },
          );
    if (done === null) throw new Error(latestError() || text.common.saveFailed);
    return true;
  }

  const columns: Column<LrnAssignment>[] = [
    {
      id: "course",
      label: copy.columns.course,
      isRowHeader: true,
      sortValue: (item) => item.courseTitle,
      render: (item) => (
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm text-primary">{item.courseTitle}</strong>
          <span className="text-sm text-tertiary">{item.courseCode}</span>
        </span>
      ),
    },
    ...(people
      ? [
          {
            id: "person",
            label: copy.columns.person,
            sortValue: (item: LrnAssignment) => item.employeeName,
            render: (item: LrnAssignment) => (
              <span className="text-sm">
                {item.mine ? text.common.you : item.employeeName}
              </span>
            ),
          },
        ]
      : []),
    {
      id: "due",
      label: copy.columns.due,
      sortValue: (item) => item.dueOn ?? "9999",
      render: (item) => <span className="text-sm">{dueLabel(item)}</span>,
    },
    {
      id: "status",
      label: copy.columns.status,
      sortValue: (item) => item.status,
      render: (item) => <Badges item={item} />,
    },
    {
      id: "type",
      label: copy.columns.mandatory,
      render: (item) => (
        <span className="text-sm">
          {item.source === "self_enrolled"
            ? text.badge.selfEnrolled
            : item.mandatory
              ? text.badge.mandatory
              : text.badge.optional}
        </span>
      ),
    },
  ];

  const detail: CollectionDetail<LrnAssignment> = {
    title: (item) => item.courseTitle,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {item.courseCode}
        <Badges item={item} />
      </span>
    ),
    body: (item) => (
      <AssignmentBody item={item} error={error} readOnly={mode === "team"} />
    ),
    // The footer follows the freshly loaded assignment, not the list row, which may be a few seconds old.
    footer: (row) => {
      const item =
        opened.data && opened.data.assignment.id === row.id
          ? opened.data.assignment
          : row;
      return (
        <>
          {item.canStart && (
            <Button isDisabled={busy} onPress={() => void start(item)}>
              {text.actions.start}
            </Button>
          )}
          {item.canComplete && (
            <Button onPress={() => ask("complete", item)}>
              {text.actions.complete}
            </Button>
          )}
          {item.canRecord && (
            <Button variant="secondary" onPress={() => ask("record", item)}>
              {text.actions.record}
            </Button>
          )}
          {item.canWaive && (
            <Button variant="secondary" onPress={() => ask("waive", item)}>
              {text.actions.waive}
            </Button>
          )}
        </>
      );
    },
  };

  const filtered =
    status !== "all" ||
    overdue !== "all" ||
    renewal !== "all" ||
    course !== "all";
  const dialog = acting ? text.dialogs[acting.kind] : null;
  return (
    <div className="perf-tab lrn-tab">
      {mode === "team" && <p className="recruit-muted">{copy.teamNote}</p>}
      <div className="recruit-filters">
        <FilterSelect
          label={text.common.status}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          allLabel={text.common.allStatuses}
          options={statuses.map((id) => ({ id, label: text.status[id] }))}
        />
        <FilterSelect
          label={copy.filters.overdue}
          value={overdue}
          onChange={(value) => {
            setOverdue(value);
            setPage(1);
          }}
          allLabel={copy.filters.anyDue}
          options={[{ id: "true", label: copy.filters.overdueOnly }]}
        />
        <FilterSelect
          label={copy.filters.renewal}
          value={renewal}
          onChange={(value) => {
            setRenewal(value);
            setPage(1);
          }}
          allLabel={copy.filters.anyRenewal}
          options={renewals.map((id) => ({ id, label: text.renewal[id] }))}
        />
        {mode === "all" && (
          <FilterSelect
            label={copy.filters.course}
            value={course}
            onChange={(value) => {
              setCourse(value);
              setPage(1);
            }}
            allLabel={copy.filters.allCourses}
            options={(courses.data?.items ?? []).map((c) => ({
              id: c.id,
              label: c.title,
            }))}
          />
        )}
      </div>
      <CollectionView
        id={`lrn-assignments-${mode}`}
        label={label}
        noun="assignments"
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
        emptyIcon={ClipboardText}
        emptyTitle={
          filtered
            ? copy.emptyFiltered
            : mode === "mine"
              ? copy.mineEmpty
              : mode === "team"
                ? copy.teamEmpty
                : copy.allEmpty
        }
        emptyDescription={
          mode === "mine"
            ? copy.mineEmptyBody
            : mode === "team"
              ? copy.teamEmptyBody
              : copy.allEmptyBody
        }
        onClearFilters={
          filtered
            ? () => {
                setStatus("all");
                setOverdue("all");
                setRenewal("all");
                setCourse("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="min-w-0 break-words text-primary">
                {item.courseTitle}
              </strong>
              <Badges item={item} />
            </div>
            <span className="text-sm text-tertiary">
              {item.courseCode} · {dueLabel(item)}
              {people
                ? ` · ${item.mine ? text.common.you : item.employeeName}`
                : ""}
            </span>
            <span className="text-sm text-secondary">
              {item.source === "self_enrolled"
                ? text.badge.selfEnrolled
                : item.mandatory
                  ? text.badge.mandatory
                  : text.badge.optional}
            </span>
          </div>
        )}
        detail={detail}
      />
      {acting && dialog && (
        <NoteDialog
          open
          title={dialog.title}
          body={dialog.body}
          label={dialog.label}
          submit={dialog.submit}
          required={acting.kind !== "complete"}
          maxLength={acting.kind === "complete" ? 280 : 500}
          onClose={() => setActing(null)}
          onSubmit={finish}
        />
      )}
    </div>
  );
}

// The panel body loads the assignment's completion history on its own.
function AssignmentBody({
  item,
  error,
  readOnly,
}: {
  item: LrnAssignment;
  error: string;
  readOnly: boolean;
}) {
  const { me } = useWorkspace();
  const full = useLrnAssignment(item.id);
  const a = full.data?.assignment ?? item;
  const d = text.detail;
  const canManage = me.permissions.includes("learn.manage");
  return (
    <div className="flex flex-col gap-5">
      {a.mine && canManage && (
        <p role="note" className="recruit-notice lrn-fourEyes">
          {d.fourEyes}
        </p>
      )}
      {a.courseStatus === "archived" &&
        (a.status === "assigned" || a.status === "in_progress") && (
          <p role="note" className="recruit-muted">
            {d.archivedOpen}
          </p>
        )}
      {readOnly && (
        <p role="note" className="recruit-muted">
          {d.readOnly}
        </p>
      )}
      <DetailFields
        title={d.course}
        fields={[
          { label: d.code, value: a.courseCode },
          { label: d.person, value: a.mine ? text.common.you : a.employeeName },
          { label: d.status, value: text.status[a.status] },
          {
            label: d.due,
            value: a.dueOn ? dateOnly(a.dueOn) : text.badge.noDue,
          },
          {
            label: d.type,
            value: a.mandatory ? text.badge.mandatory : text.badge.optional,
          },
          { label: d.audience, value: audienceLabel(a) },
          { label: d.assignedBy, value: a.assignedBy },
          { label: d.assignedOn, value: dateTime(a.createdAt) },
          { label: d.started, value: a.startedAt && dateTime(a.startedAt) },
          {
            label: d.completed,
            value: a.completedAt && dateTime(a.completedAt),
          },
          { label: d.waived, value: a.waivedAt && dateTime(a.waivedAt) },
          {
            label: d.expires,
            value: a.expiresOn && dateOnly(a.expiresOn),
          },
          {
            label: d.renewal,
            value: a.renewal && text.renewal[a.renewal],
          },
        ]}
      />
      <CourseFromAssignment courseId={a.courseId} />
      <section className="flex flex-col gap-2" aria-label={d.history}>
        <h3 className="text-sm font-semibold text-secondary">{d.history}</h3>
        {full.error ? (
          <p role="alert" className="inline-error">
            {full.error.message}
          </p>
        ) : !full.data ? (
          <div className="cv-skeleton h-16 rounded-xl bg-secondary" />
        ) : full.data.history.length === 0 ? (
          <p className="text-sm text-tertiary">{d.noHistory}</p>
        ) : (
          <ol className="perf-history" aria-label={d.history}>
            {full.data.history.map((h) => (
              <li key={h.id}>
                <strong>
                  {h.outcome === "completed"
                    ? d.historyLine.completed
                    : d.historyLine.waived}{" "}
                  {h.recordedBy === "hr"
                    ? d.historyLine.hr
                    : d.historyLine.self}
                  {h.expiresOn
                    ? ` · ${d.expiresOn(dateOnly(h.expiresOn))}`
                    : ""}
                </strong>
                {h.note && (
                  <span className="lrn-note">
                    {h.outcome === "waived" || h.recordedBy === "hr"
                      ? d.reasonLabel
                      : d.noteLabel}
                    : {h.note}
                  </span>
                )}
                <span className="recruit-muted">
                  {h.byLabel} · {dateTime(h.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <FormError message={error} />
    </div>
  );
}

// The course's description and link come from the catalogue list (the person may see it there).
function CourseFromAssignment({ courseId }: { courseId: string }) {
  const { data: course } = useLrnCourse(courseId);
  if (!course) return null;
  const d = text.detail;
  return (
    <section className="flex flex-col gap-3">
      <DetailFields
        title={d.course}
        fields={[
          { label: d.category, value: course.category },
          { label: d.delivery, value: text.delivery[course.deliveryMode] },
          { label: d.duration, value: text.duration(course.durationMinutes) },
          { label: text.course.description, value: course.description },
        ]}
      />
      {course.externalUrl && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-secondary">{d.link}</h3>
          <CourseLink url={course.externalUrl} />
        </div>
      )}
    </section>
  );
}
