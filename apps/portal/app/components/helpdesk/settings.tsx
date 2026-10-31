import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import {
  Button,
  Checkbox,
  CollectionView,
  ErrorState,
  Input,
  RangeInput,
  Select,
  TextArea,
  type Column,
} from "@anvi/ui";
import type { HdArticle, HdCategory } from "@anvi/contracts";
import { useHdArticles, useHdCategories, useHdSla } from "../../lib/api";
import { helpdeskCopy as text } from "../../lib/copy/helpdesk";
import {
  FilterSelect,
  FormActions,
  FormError,
  Modal,
  SearchBox,
  StatusPill,
  articleColor,
  dateOnly,
  useDebounced,
  useHdSend,
} from "./shared";

const copy = text.settings;
type Sla = NonNullable<ReturnType<typeof useHdSla>["data"]>["items"][number];
const articleStatuses = Object.keys(text.articleStatus);

export function SettingsTab() {
  return (
    <div className="hd-settings">
      <CategoriesSection />
      <SlaSection />
      <ArticlesSection />
    </div>
  );
}

// ---- Categories ----

function CategoriesSection() {
  const categories = useHdCategories(true);
  const [editing, setEditing] = useState<HdCategory | "new" | null>(null);
  const c = copy.categories;
  const columns: Column<HdCategory>[] = [
    {
      id: "name",
      label: c.fields.name,
      isRowHeader: true,
      sortValue: (item) => item.name,
      render: (item) => <strong className="text-sm">{item.name}</strong>,
    },
    {
      id: "flags",
      label: text.common.status,
      render: (item) => (
        <span className="flex flex-wrap gap-2">
          <StatusPill
            label={item.active ? c.active : c.inactive}
            color={item.active ? "success" : "gray"}
          />
          {item.confidential && (
            <StatusPill label={c.confidential} color="warning" />
          )}
        </span>
      ),
    },
    {
      id: "edit",
      label: c.edit,
      render: (item) => (
        <Button
          variant="secondary"
          aria-label={`${c.edit}: ${item.name}`}
          onPress={() => setEditing(item)}
        >
          {c.edit}
        </Button>
      ),
    },
  ];
  if (categories.error)
    return (
      <ErrorState
        message={categories.error.message}
        onRetry={() => void categories.refetch()}
      />
    );
  return (
    <section className="hd-section" aria-label={c.title}>
      <div className="recruit-toolbar">
        <div>
          <h2 className="hd-h2">{c.title}</h2>
          <p className="recruit-muted">{c.intro}</p>
        </div>
        <Button onPress={() => setEditing("new")}>
          <Plus size={18} />
          {c.add}
        </Button>
      </div>
      <CollectionView
        id="hd-categories"
        label={c.title}
        noun="categories"
        items={categories.data?.items ?? []}
        loading={!categories.data}
        getKey={(item) => item.id}
        columns={columns}
        emptyIcon={Gear}
        emptyTitle={c.empty}
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <strong className="break-words text-primary">{item.name}</strong>
            <span className="flex flex-wrap gap-2">
              <StatusPill
                label={item.active ? c.active : c.inactive}
                color={item.active ? "success" : "gray"}
              />
              {item.confidential && (
                <StatusPill label={c.confidential} color="warning" />
              )}
            </span>
            <Button
              variant="secondary"
              className="self-start"
              aria-label={`${c.edit}: ${item.name}`}
              onPress={() => setEditing(item)}
            >
              {c.edit}
            </Button>
          </div>
        )}
      />
      <Modal
        open={editing !== null}
        title={editing === "new" ? c.addTitle : c.editTitle}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <CategoryFields
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function CategoryFields({
  item,
  onClose,
}: {
  item: HdCategory | null;
  onClose: () => void;
}) {
  const c = copy.categories;
  const { send, busy, error } = useHdSend();
  const [name, setName] = useState(item?.name ?? "");
  const [confidential, setConfidential] = useState(item?.confidential ?? false);
  const [active, setActive] = useState(item?.active ?? true);
  const [sort, setSort] = useState(String(item?.sort ?? 100));
  const order = Number(sort);
  const ready =
    name.trim().length >= 2 &&
    Number.isInteger(order) &&
    order >= 0 &&
    order <= 1000;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = item
      ? await send(
          `categories/${item.id}`,
          {
            name: name.trim(),
            confidential,
            active,
            sort: order,
            version: item.version,
          },
          "PUT",
        )
      : await send("categories", {
          name: name.trim(),
          confidential,
          sort: order,
        });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={c.fields.name}
        value={name}
        onChange={setName}
        maxLength={60}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <Checkbox
        isSelected={confidential}
        onChange={setConfidential}
        label={c.fields.confidential}
      />
      {item && (
        <Checkbox
          isSelected={active}
          onChange={setActive}
          label={c.fields.active}
        />
      )}
      <RangeInput
        type="number"
        label={c.fields.sort}
        value={sort}
        onChange={setSort}
        min={0}
        max={1000}
        isRequired
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.common.save}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}

// ---- Service targets ----

function SlaSection() {
  const sla = useHdSla(true);
  const [editing, setEditing] = useState<Sla | null>(null);
  const c = copy.sla;
  const hours = (item: Sla) =>
    `${c.hours(item.responseHours)} · ${c.hours(item.resolveHours)}`;
  const columns: Column<Sla>[] = [
    {
      id: "priority",
      label: c.columns.priority,
      isRowHeader: true,
      render: (item) => (
        <strong className="text-sm">{text.priority[item.priority]}</strong>
      ),
    },
    {
      id: "response",
      label: c.columns.response,
      render: (item) => (
        <span className="text-sm">{c.hours(item.responseHours)}</span>
      ),
    },
    {
      id: "resolve",
      label: c.columns.resolve,
      render: (item) => (
        <span className="text-sm">
          {c.hours(item.resolveHours)}
          {item.version === 0 ? ` (${c.builtIn})` : ""}
        </span>
      ),
    },
    {
      id: "edit",
      label: c.edit,
      render: (item) => (
        <Button
          variant="secondary"
          aria-label={`${c.edit}: ${text.priority[item.priority]}`}
          onPress={() => setEditing(item)}
        >
          {c.edit}
        </Button>
      ),
    },
  ];
  if (sla.error)
    return (
      <ErrorState
        message={sla.error.message}
        onRetry={() => void sla.refetch()}
      />
    );
  return (
    <section className="hd-section" aria-label={c.title}>
      <div>
        <h2 className="hd-h2">{c.title}</h2>
        <p className="recruit-muted">{c.intro}</p>
      </div>
      <p role="note" className="recruit-notice hd-wallclock">
        {c.basis}
      </p>
      <CollectionView
        id="hd-sla"
        label={c.title}
        noun="targets"
        items={sla.data?.items ?? []}
        loading={!sla.data}
        getKey={(item) => item.priority}
        columns={columns}
        emptyIcon={Gear}
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <strong className="text-primary">
              {text.priority[item.priority]}
            </strong>
            <span className="text-sm text-tertiary">{hours(item)}</span>
            <Button
              variant="secondary"
              className="self-start"
              aria-label={`${c.edit}: ${text.priority[item.priority]}`}
              onPress={() => setEditing(item)}
            >
              {c.edit}
            </Button>
          </div>
        )}
      />
      <Modal
        open={editing !== null}
        title={editing ? c.editTitle(text.priority[editing.priority]) : ""}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <SlaFields
            key={editing.priority}
            item={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function SlaFields({ item, onClose }: { item: Sla; onClose: () => void }) {
  const c = copy.sla;
  const { send, busy, error } = useHdSend();
  const [response, setResponse] = useState(String(item.responseHours));
  const [resolve, setResolve] = useState(String(item.resolveHours));
  const r = Number(response);
  const s = Number(resolve);
  const whole = Number.isInteger(r) && Number.isInteger(s) && r >= 1 && s >= 1;
  const ordered = whole && s >= r;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ordered) return;
    const done = await send(
      `sla/${item.priority}`,
      { responseHours: r, resolveHours: s, version: item.version },
      "PUT",
    );
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{c.basis}</p>
      <RangeInput
        type="number"
        label={c.fields.response}
        value={response}
        onChange={setResponse}
        min={1}
        max={720}
        isRequired
        autoFocus
      />
      <RangeInput
        type="number"
        label={c.fields.resolve}
        value={resolve}
        onChange={setResolve}
        min={1}
        max={2160}
        isRequired
      />
      {whole && !ordered && (
        <p role="alert" className="inline-error">
          {c.invalid}
        </p>
      )}
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.common.save}
        onCancel={onClose}
        disabled={!ordered}
      />
    </form>
  );
}

// ---- Articles ----

function ArticlesSection() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = useHdArticles(true, query.toString());
  const { send, busy, error } = useHdSend();
  const [editing, setEditing] = useState<HdArticle | "new" | null>(null);
  const c = copy.articles;
  async function step(item: HdArticle, name: "publish" | "archive") {
    await send(`articles/${item.id}/${name}`, { version: item.version });
  }
  const actions = (item: HdArticle) =>
    item.canEdit ? (
      <span className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          aria-label={`${c.edit}: ${item.title}`}
          onPress={() => setEditing(item)}
        >
          {c.edit}
        </Button>
        {item.status !== "published" && (
          <Button
            variant="secondary"
            isDisabled={busy}
            aria-label={`${c.publish}: ${item.title}`}
            onPress={() => void step(item, "publish")}
          >
            {c.publish}
          </Button>
        )}
        {item.status !== "archived" && (
          <Button
            variant="secondary"
            isDisabled={busy}
            aria-label={`${c.archive}: ${item.title}`}
            onPress={() => void step(item, "archive")}
          >
            {c.archive}
          </Button>
        )}
      </span>
    ) : null;
  const columns: Column<HdArticle>[] = [
    {
      id: "title",
      label: text.knowledge.columns.title,
      isRowHeader: true,
      sortValue: (item) => item.title,
      render: (item) => <strong className="text-sm">{item.title}</strong>,
    },
    {
      id: "category",
      label: text.knowledge.columns.category,
      render: (item) => (
        <span className="text-sm">
          {item.categoryName ?? text.knowledge.general}
        </span>
      ),
    },
    {
      id: "status",
      label: text.knowledge.columns.status,
      render: (item) => (
        <StatusPill
          label={text.articleStatus[item.status]}
          color={articleColor[item.status] ?? "gray"}
        />
      ),
    },
    { id: "actions", label: c.edit, render: actions },
  ];
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const filtered = Boolean(search) || status !== "all";
  return (
    <section className="hd-section" aria-label={c.title}>
      <div className="recruit-toolbar">
        <div>
          <h2 className="hd-h2">{c.title}</h2>
          <p className="recruit-muted">{c.intro}</p>
        </div>
        <Button onPress={() => setEditing("new")}>
          <Plus size={18} />
          {c.add}
        </Button>
      </div>
      <div className="recruit-filters">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label={text.common.status}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          allLabel={text.common.allStatuses}
          options={articleStatuses.map((id) => ({
            id,
            label: text.articleStatus[id as HdArticle["status"]],
          }))}
        />
      </div>
      <FormError message={error} />
      <CollectionView
        id="hd-articles-manage"
        label={c.title}
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
        emptyTitle={filtered ? c.emptyFiltered : c.empty}
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
              <StatusPill
                label={text.articleStatus[item.status]}
                color={articleColor[item.status] ?? "gray"}
              />
            </div>
            <span className="text-sm text-tertiary">
              {item.categoryName ?? text.knowledge.general} ·{" "}
              {dateOnly(item.updatedAt)}
            </span>
            {actions(item)}
          </div>
        )}
      />
      <Modal
        open={editing !== null}
        title={editing === "new" ? c.addTitle : c.editTitle}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <ArticleFields
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function ArticleFields({
  item,
  onClose,
}: {
  item: HdArticle | null;
  onClose: () => void;
}) {
  const c = copy.articles;
  const { send, busy, error } = useHdSend();
  const categories = useHdCategories(true);
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "none");
  const [keywords, setKeywords] = useState(item?.keywords.join(", ") ?? "");
  const list = keywords
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  const ready =
    title.trim().length >= 3 &&
    body.trim().length >= 10 &&
    list.every((word) => word.length >= 2 && word.length <= 40) &&
    list.length <= 20;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const payload = {
      title: title.trim(),
      body: body.trim(),
      categoryId: categoryId === "none" ? null : categoryId,
      keywords: list,
    };
    const done = item
      ? await send(
          `articles/${item.id}`,
          { ...payload, version: item.version },
          "PUT",
        )
      : await send("articles", payload);
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={c.fields.title}
        value={title}
        onChange={setTitle}
        maxLength={160}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <TextArea
        label={c.fields.body}
        value={body}
        onChange={setBody}
        maxLength={8000}
        isRequired
      />
      <Select
        label={c.fields.category}
        selectedKey={categoryId}
        onSelectionChange={(key) => setCategoryId(String(key))}
      >
        <Select.Item id="none" label={c.anyCategory} />
        {(categories.data?.items ?? []).map((k) => (
          <Select.Item key={k.id} id={k.id} label={k.name} />
        ))}
      </Select>
      <Input
        label={c.fields.keywords}
        value={keywords}
        onChange={setKeywords}
        hint={c.keywordsHint}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.common.save}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}
