import { useState } from "react";
import { BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import {
  CollectionView,
  DetailFields,
  ErrorState,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { HdArticle } from "@anvi/contracts";
import { useHdArticles, useHdCategories } from "../../lib/api";
import { helpdeskCopy as text } from "../../lib/copy/helpdesk";
import { FilterSelect, SearchBox, dateOnly, useDebounced } from "./shared";

const copy = text.knowledge;

const columns: Column<HdArticle>[] = [
  {
    id: "title",
    label: copy.columns.title,
    isRowHeader: true,
    sortValue: (item) => item.title,
    render: (item) => (
      <strong className="text-sm text-primary">{item.title}</strong>
    ),
  },
  {
    id: "category",
    label: copy.columns.category,
    sortValue: (item) => item.categoryName ?? "",
    render: (item) => (
      <span className="text-sm">{item.categoryName ?? copy.general}</span>
    ),
  },
  {
    id: "updated",
    label: copy.columns.updated,
    sortValue: (item) => item.updatedAt,
    render: (item) => (
      <span className="text-sm">{dateOnly(item.updatedAt)}</span>
    ),
  },
];

const detail: CollectionDetail<HdArticle> = {
  title: (item) => item.title,
  subtitle: (item) => item.categoryName ?? copy.general,
  body: (item) => (
    <div className="flex flex-col gap-5">
      <p className="hd-article-body">{item.body}</p>
      <DetailFields
        fields={[
          { label: copy.keywords, value: item.keywords.join(", ") },
          { label: copy.updated, value: dateOnly(item.updatedAt) },
        ]}
      />
    </div>
  ),
};

export function KnowledgeTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({
    page: String(page),
    limit: "10",
    q,
    status: "published",
  });
  if (category !== "all") query.set("categoryId", category);
  const list = useHdArticles(true, query.toString());
  const categories = useHdCategories(true);
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const filtered = Boolean(search) || category !== "all";
  return (
    <div className="perf-tab hd-tab">
      <p className="recruit-muted">{copy.intro}</p>
      <div className="recruit-filters">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
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
      </div>
      <CollectionView
        id="hd-knowledge"
        label={text.tabs.knowledge}
        noun="articles"
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
        emptyIcon={BookOpen}
        emptyTitle={filtered ? copy.emptyFiltered : copy.empty}
        emptyDescription={copy.emptyBody}
        onClearFilters={
          filtered
            ? () => {
                setSearch("");
                setCategory("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <strong className="min-w-0 break-words text-primary">
              {item.title}
            </strong>
            <span className="text-sm text-tertiary">
              {item.categoryName ?? copy.general} · {dateOnly(item.updatedAt)}
            </span>
          </div>
        )}
        detail={detail}
      />
    </div>
  );
}
