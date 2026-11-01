import { useState } from "react";
import { Books } from "@phosphor-icons/react/dist/csr/Books";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { LrnCourse } from "@anvi/contracts";
import { useLrnCourses } from "../../lib/learning-api";
import { learningCopy as text } from "../../lib/copy/learning";
import {
  CourseLink,
  FilterSelect,
  FormError,
  SearchBox,
  StatusPill,
  courseColor,
  dateOnly,
  useDebounced,
  useLrnSend,
} from "./shared";

const copy = text.catalogue;
const courseStatuses = Object.keys(text.courseStatus) as LrnCourse["status"][];

export function TypeLabel({ course }: { course: LrnCourse }) {
  return (
    <span className="text-sm">
      {course.mandatory ? text.course.mandatory : text.course.optional}
    </span>
  );
}

export function CourseFields({ course }: { course: LrnCourse }) {
  const d = text.detail;
  return (
    <div className="flex flex-col gap-5">
      <DetailFields
        title={d.course}
        fields={[
          { label: d.code, value: course.code },
          { label: d.category, value: course.category },
          { label: d.delivery, value: text.delivery[course.deliveryMode] },
          { label: d.duration, value: text.duration(course.durationMinutes) },
          {
            label: d.type,
            value: course.mandatory
              ? text.course.mandatory
              : text.course.optional,
          },
          {
            label: text.course.validity,
            value: course.validityMonths
              ? text.course.validityMonths(course.validityMonths)
              : text.course.noValidity,
          },
          { label: d.status, value: text.courseStatus[course.status] },
          {
            label: text.course.published,
            value: course.publishedAt && dateOnly(course.publishedAt),
          },
          { label: text.course.updated, value: dateOnly(course.updatedAt) },
        ]}
      />
      <DetailFields
        title={text.course.description}
        fields={[
          {
            label: text.course.description,
            value: course.description || text.course.noDescription,
          },
        ]}
      />
      {course.externalUrl && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-secondary">{d.link}</h3>
          <CourseLink url={course.externalUrl} />
        </div>
      )}
    </div>
  );
}

export function CatalogueTab({ manage }: { manage: boolean }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = useLrnCourses(true, query.toString());
  const { send, busy, error } = useLrnSend();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  async function enrol(course: LrnCourse) {
    setNotice("");
    const done = await send(`courses/${course.id}/enrol`, {});
    if (done !== null) {
      setOpenKey(null);
      setNotice(copy.enrolled(course.title));
    }
  }
  const columns: Column<LrnCourse>[] = [
    {
      id: "course",
      label: copy.columns.course,
      isRowHeader: true,
      sortValue: (item) => item.title,
      render: (item) => (
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm text-primary">{item.title}</strong>
          <span className="text-sm text-tertiary">{item.code}</span>
        </span>
      ),
    },
    {
      id: "category",
      label: copy.columns.category,
      sortValue: (item) => item.category,
      render: (item) => <span className="text-sm">{item.category}</span>,
    },
    {
      id: "delivery",
      label: copy.columns.delivery,
      render: (item) => (
        <span className="text-sm">
          {text.delivery[item.deliveryMode]} ·{" "}
          {text.duration(item.durationMinutes)}
        </span>
      ),
    },
    {
      id: "type",
      label: copy.columns.type,
      render: (item) => <TypeLabel course={item} />,
    },
    ...(manage
      ? [
          {
            id: "status",
            label: copy.columns.status,
            render: (item: LrnCourse) => (
              <StatusPill
                label={text.courseStatus[item.status]}
                color={courseColor[item.status]}
              />
            ),
          },
        ]
      : []),
  ];
  const detail: CollectionDetail<LrnCourse> = {
    title: (item) => item.title,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {item.code}
        <StatusPill
          label={text.courseStatus[item.status]}
          color={courseColor[item.status]}
        />
      </span>
    ),
    body: (item) => (
      <div className="flex flex-col gap-4">
        {item.myOpenAssignmentId && (
          <p role="note" className="recruit-muted">
            {copy.alreadyAssigned}
          </p>
        )}
        {item.mandatory && !item.myOpenAssignmentId && (
          <p role="note" className="recruit-muted">
            {copy.mandatoryNote}
          </p>
        )}
        <CourseFields course={item} />
        <FormError message={error} />
      </div>
    ),
    footer: (item) =>
      item.canEnrol ? (
        <Button isDisabled={busy} onPress={() => void enrol(item)}>
          {copy.enrol}
        </Button>
      ) : null,
  };
  const filtered = Boolean(search) || status !== "all";
  return (
    <div className="perf-tab lrn-tab">
      <p className="recruit-muted">{manage ? copy.introManage : copy.intro}</p>
      <div className="recruit-filters">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        {manage && (
          <FilterSelect
            label={text.common.status}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            allLabel={text.common.allStatuses}
            options={courseStatuses.map((id) => ({
              id,
              label: text.courseStatus[id],
            }))}
          />
        )}
      </div>
      {notice && (
        <p role="status" className="recruit-notice">
          {notice}
        </p>
      )}
      <CollectionView
        id="lrn-catalogue"
        label={copy.label}
        noun="courses"
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
        emptyIcon={Books}
        emptyTitle={filtered ? copy.emptyFiltered : copy.empty}
        emptyDescription={copy.emptyBody}
        onClearFilters={
          filtered
            ? () => {
                setSearch("");
                setStatus("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="min-w-0 break-words text-primary">
                {item.title}
              </strong>
              {manage && (
                <StatusPill
                  label={text.courseStatus[item.status]}
                  color={courseColor[item.status]}
                />
              )}
            </div>
            <span className="text-sm text-tertiary">
              {item.code} · {item.category}
            </span>
            <span className="text-sm text-secondary">
              {text.delivery[item.deliveryMode]} ·{" "}
              {text.duration(item.durationMinutes)} ·{" "}
              {item.mandatory ? text.course.mandatory : text.course.optional}
            </span>
          </div>
        )}
        detail={detail}
      />
    </div>
  );
}
