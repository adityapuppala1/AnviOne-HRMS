import {
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Coins } from "@phosphor-icons/react/dist/csr/Coins";
import { HandCoins } from "@phosphor-icons/react/dist/csr/HandCoins";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt";
import { Tag } from "@phosphor-icons/react/dist/csr/Tag";
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { X } from "@phosphor-icons/react/dist/csr/X";
import {
  Button,
  CollectionView,
  type Column,
  DialogPanel,
  EmptyBlock,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  RangeInput,
  Select,
  StatCard,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  Toggle,
} from "@anvi/ui";
import {
  expenseCategorySchema,
  expenseClaimSchema,
  myExpensesSchema,
  type ExpenseCategory,
  type ExpenseClaim,
  type ExpenseKind,
  type ExpenseStatus,
  type MyExpenses,
} from "@anvi/contracts";
import {
  ApiError,
  mutate,
  useExpense,
  useExpenseCategories,
  useExpenses,
  useMyExpenses,
} from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { expensesCopy as text } from "../lib/copy/expenses";
import { useWorkspace } from "./workspace";
// Shared dialog form styles come from the leave screen.
import "./leave.css";
import "./expenses.css";

/* Dates ------------------------------------------------------------------ */

const dateFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
const utcDate = dateFormat("UTC");
const istDate = dateFormat("Asia/Kolkata");
/** Plain YYYY-MM-DD dates are shown as written; ISO timestamps in India time. */
const day = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? utcDate.format(new Date(`${value}T00:00:00Z`))
    : istDate.format(new Date(value));
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
const addDays = (value: string, days: number) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const shortMonth = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  timeZone: "UTC",
});
const longMonth = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

/* Money: integer paise, INR only ----------------------------------------- */

const MAX_MINOR = 1_000_000_000;
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
const money = (minor: number) => inr.format(minor / 100);
/** "1250.5" -> 125050. Integer maths only, so no float rounding creeps in. */
function toMinor(value: string): number | null {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(
    value.trim().replace(/,/g, ""),
  );
  if (!match) return null;
  const minor =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor <= MAX_MINOR ? minor : null;
}
/** 125050 -> "1250.50"; 125000 -> "1250". */
function toRupees(minor: number): string {
  const whole = Math.floor(minor / 100);
  const part = minor % 100;
  return part === 0
    ? String(whole)
    : `${whole}.${String(part).padStart(2, "0")}`;
}

/* Shared bits ------------------------------------------------------------ */

const statusColor: Record<
  ExpenseStatus,
  "gray" | "brand" | "error" | "warning" | "success"
> = {
  submitted: "warning",
  approved: "brand",
  paid: "success",
  rejected: "error",
  cancelled: "gray",
};
const statusKeys = Object.keys(text.statusNames) as ExpenseStatus[];
const kindKeys = Object.keys(text.kinds) as ExpenseKind[];

function StatusPill({ status }: { status: ExpenseStatus }) {
  return (
    <StatusBadge color={statusColor[status]} size="sm" type="pill-color">
      {text.statusNames[status]}
    </StatusBadge>
  );
}

function useRequest() {
  const { me } = useWorkspace();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(
    path: string,
    schema: z.ZodType<T>,
    body: unknown,
    fallback: string,
    options: {
      method?: "POST" | "PUT";
      /** The claim belongs to the signed-in person. */
      own?: boolean;
      category?: boolean;
    } = {},
  ): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return schema.parse(
        await mutate(path, me.csrfToken, body, options.method ?? "POST"),
      );
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 409) {
          // Someone else changed it: show the latest and ask them to check.
          setError(
            options.category
              ? text.errors.categoryChanged
              : text.errors.changed,
          );
          void client.invalidateQueries({ queryKey: ["expenses"] });
        } else if (cause.status === 403) {
          setError(
            options.own
              ? text.errors.ownClaim
              : cause.message || text.errors.forbidden,
          );
        } else setError(cause.message || fallback);
      } else setError(fallback);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError, client };
}
type Request = ReturnType<typeof useRequest>;

/** After a single claim changes: refresh its detail and every list. */
function savedClaim(client: QueryClient, next: ExpenseClaim) {
  client.setQueryData(["expenses", "detail", next.id], next);
  void client.invalidateQueries({ queryKey: ["expenses", "list"] });
  void client.invalidateQueries({ queryKey: ["expenses", "mine"] });
  void client.invalidateQueries({ queryKey: ["approvals"] });
}
function savedMine(client: QueryClient, next: MyExpenses) {
  client.setQueryData(["expenses", "mine"], next);
  void client.invalidateQueries({ queryKey: ["expenses", "list"] });
  void client.invalidateQueries({ queryKey: ["expenses", "detail"] });
  void client.invalidateQueries({ queryKey: ["approvals"] });
}

function FormActions({
  busy,
  submit,
  saving,
  cancel = text.form.cancel,
  onCancel,
  disabled = false,
}: {
  busy: boolean;
  submit: string;
  saving: string;
  cancel?: string;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="leave-actions">
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" isDisabled={busy || disabled}>
        {busy ? saving : submit}
      </Button>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="inline-error">
      {message}
    </p>
  ) : null;
}

function HelpNote() {
  return (
    <aside className="expenses-help" aria-labelledby="expenses-help-heading">
      <h2 id="expenses-help-heading">{text.help.title}</h2>
      <p>{text.help.body}</p>
    </aside>
  );
}

/* Page ------------------------------------------------------------------- */

type View = "mine" | "approvals" | "pay" | "categories";

export default function Expenses() {
  const { me } = useWorkspace();
  const { reduceMotion } = usePreferences();
  const canSelf = me.permissions.includes("expense.self");
  const canApprove = me.permissions.includes("expense.approve");
  const canManage = me.permissions.includes("expense.manage");
  const mine = useMyExpenses(canSelf);
  const list = useExpenses(canApprove || canManage);
  const categories = useExpenseCategories(canSelf || canApprove || canManage);
  const [claiming, setClaiming] = useState(false);
  const views: View[] = [
    ...(canSelf ? (["mine"] as const) : []),
    ...(canApprove ? (["approvals"] as const) : []),
    ...(canManage ? (["pay", "categories"] as const) : []),
  ];
  if (views.length === 0) return <ErrorState message={text.denied} />;
  const panels: Record<View, ReactNode> = {
    mine: <MineView query={mine} reduceMotion={reduceMotion} />,
    approvals: <ApprovalsView query={list} reduceMotion={reduceMotion} />,
    pay: <PayView query={list} />,
    categories: <CategoriesView query={categories} />,
  };
  return (
    <div className="page-enter expenses-page">
      <PageHeader
        title={text.title}
        description={canSelf ? text.subtitleMine : text.subtitleReview}
        actions={
          canSelf && (
            <Button onPress={() => setClaiming(true)}>
              <Plus size={18} weight="bold" />
              {text.mine.newClaim}
            </Button>
          )
        }
      />
      {views.length > 1 ? (
        <Tabs className="leave-tabs">
          <TabList aria-label={text.tabs.label} className="tabs-list">
            {views.map((view) => (
              <Tab key={view} id={view} className="tab">
                {text.tabs[view]}
              </Tab>
            ))}
          </TabList>
          {views.map((view) => (
            <TabPanel key={view} id={view} className="tab-panel">
              {panels[view]}
            </TabPanel>
          ))}
        </Tabs>
      ) : (
        panels[views[0]!]
      )}
      <HelpNote />
      {canSelf && (
        <ClaimDialog
          open={claiming}
          categories={categories.data?.items ?? []}
          categoriesFailed={Boolean(categories.error)}
          onClose={() => setClaiming(false)}
        />
      )}
    </div>
  );
}

/* My claims -------------------------------------------------------------- */

function MineView({
  query,
  reduceMotion,
}: {
  query: ReturnType<typeof useMyExpenses>;
  reduceMotion: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (query.error)
    return (
      <ErrorState
        message={query.error.message || text.mine.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <LoadingState />;
  const { items, summary, months } = query.data;
  const current = months.at(-1);
  return (
    <>
      <div className="expenses-stats">
        <StatCard
          label={text.stats.awaiting}
          value={summary.submitted.count}
          hint={text.stats.awaitingHint(money(summary.submitted.amountMinor))}
          icon={Hourglass}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.approved}
          value={summary.approved.count}
          hint={text.stats.approvedHint(money(summary.approved.amountMinor))}
          icon={ListChecks}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.paid}
          value={summary.paid.count}
          hint={text.stats.paidHint(money(summary.paid.amountMinor))}
          icon={Wallet}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.month}
          value={current?.count ?? 0}
          hint={text.stats.monthHint(money(current?.amountMinor ?? 0))}
          icon={Coins}
          animate={!reduceMotion}
        />
      </div>
      <MonthChart months={months} />
      <section
        className="panel expenses-panel"
        aria-labelledby="expenses-mine-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="expenses-mine-heading">{text.mine.heading}</h2>
            <p aria-live="polite">{text.mine.total(items.length)}</p>
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyBlock
            icon={Receipt}
            title={text.mine.emptyTitle}
            description={text.mine.emptyBody}
          />
        ) : (
          <ClaimCollection
            id="expenses-mine"
            label={text.mine.heading}
            claims={items}
            showPerson={false}
            onOpen={setOpenId}
          />
        )}
      </section>
      <DetailsDialog
        id={openId}
        claims={items}
        remote={false}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}

function MonthChart({ months }: { months: MyExpenses["months"] }) {
  const peak = months.reduce((max, m) => Math.max(max, m.amountMinor), 0);
  const top = months.find((m) => m.amountMinor === peak);
  return (
    <section
      className="panel expenses-panel expenses-chart"
      aria-labelledby="expenses-chart-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="expenses-chart-heading">{text.chart.heading}</h2>
          <p>
            {peak > 0 && top
              ? `${text.chart.intro} ${text.chart.peak(longMonth.format(monthDate(top.month)), money(peak))}`
              : text.chart.empty}
          </p>
        </div>
      </div>
      <div className="expenses-bars" aria-hidden="true">
        {months.map((m) => {
          const pct =
            peak > 0
              ? Math.max(
                  m.amountMinor > 0 ? 4 : 0,
                  Math.round((m.amountMinor / peak) * 100),
                )
              : 0;
          return (
            <div className="expenses-bar-col" key={m.month}>
              <span
                className="expenses-bar"
                style={{ "--h": `${pct}%` } as CSSProperties}
                data-empty={m.amountMinor === 0}
              />
              <small>{shortMonth.format(monthDate(m.month))}</small>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{text.chart.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{text.chart.month}</th>
            <th scope="col">{text.chart.claims}</th>
            <th scope="col">{text.chart.amount}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{longMonth.format(monthDate(m.month))}</th>
              <td>{m.count}</td>
              <td>{money(m.amountMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ClaimCollection({
  id,
  label,
  claims,
  showPerson,
  onOpen,
  extra,
}: {
  id: string;
  label: string;
  claims: ExpenseClaim[];
  showPerson: boolean;
  onOpen: (id: string) => void;
  extra?: (claim: ExpenseClaim) => ReactNode;
}) {
  const columns: Column<ExpenseClaim>[] = [
    {
      id: "title",
      label: "Claim",
      isRowHeader: true,
      sortValue: (c) => c.title,
      render: (c) => (
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm text-primary">{c.title}</strong>
          {showPerson && (
            <small className="text-tertiary">
              {text.list.by(c.employeeName, c.employeeCode)}
              {c.department ? ` · ${c.department}` : ""}
            </small>
          )}
        </span>
      ),
    },
    {
      id: "category",
      label: "Category",
      sortValue: (c) => c.categoryName,
      render: (c) => (
        <span className="text-sm">
          {text.kinds[c.kind]} · {c.categoryName}
        </span>
      ),
    },
    {
      id: "amount",
      label: "Amount",
      sortValue: (c) => c.amountMinor,
      render: (c) => (
        <span className="text-sm font-medium">{money(c.amountMinor)}</span>
      ),
    },
    {
      id: "date",
      label: "Date",
      sortValue: (c) => c.expenseDate,
      render: (c) => <span className="text-sm">{day(c.expenseDate)}</span>,
    },
    {
      id: "status",
      label: "Status",
      sortValue: (c) => c.status,
      render: (c) => <StatusPill status={c.status} />,
    },
    {
      id: "actions",
      label: "",
      render: (c) => (
        <span className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onPress={() => onOpen(c.id)}
            aria-label={text.mine.openLabel(c.title)}
          >
            {text.mine.open}
          </Button>
          {extra?.(c)}
        </span>
      ),
    },
  ];
  return (
    <CollectionView
      id={id}
      label={label}
      noun="claims"
      items={claims}
      getKey={(c) => c.id}
      columns={columns}
      defaultView="table"
      onOpen={(c) => onOpen(c.id)}
      renderCard={(c) => (
        <ClaimRow
          claim={c}
          showPerson={showPerson}
          onOpen={() => onOpen(c.id)}
          extra={extra?.(c)}
        />
      )}
    />
  );
}

function ClaimRow({
  claim,
  showPerson,
  onOpen,
  extra,
}: {
  claim: ExpenseClaim;
  showPerson: boolean;
  onOpen: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="expenses-row">
      <div className="expenses-main">
        <div className="expenses-title">
          <strong>{claim.title}</strong>
          <span className="expenses-amount">{money(claim.amountMinor)}</span>
        </div>
        {showPerson && (
          <small className="expenses-muted">
            {text.list.by(claim.employeeName, claim.employeeCode)}
            {claim.department ? ` · ${claim.department}` : ""}
          </small>
        )}
        <div className="expenses-meta">
          <StatusPill status={claim.status} />
          <small>{text.kinds[claim.kind]}</small>
          <small>{claim.categoryName}</small>
          <small>{text.mine.on(day(claim.expenseDate))}</small>
        </div>
        {claim.decisionNote && (
          <small className="expenses-muted">
            {text.mine.decisionNote(claim.decisionNote)}
          </small>
        )}
      </div>
      <div className="expenses-row-actions">
        <Button
          variant="secondary"
          onPress={onOpen}
          aria-label={text.mine.openLabel(claim.title)}
        >
          {text.mine.open}
        </Button>
        {extra}
      </div>
    </div>
  );
}

/* Approvals -------------------------------------------------------------- */

function ApprovalsView({
  query,
  reduceMotion,
}: {
  query: ReturnType<typeof useExpenses>;
  reduceMotion: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ExpenseStatus | "">("submitted");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, isPending, refetch } = query;
  const term = search.trim().toLowerCase();
  const filtered = Boolean(term || status);
  const items = (data?.items ?? []).filter(
    (claim) =>
      (!status || claim.status === status) &&
      (!term ||
        claim.employeeName.toLowerCase().includes(term) ||
        claim.employeeCode.toLowerCase().includes(term) ||
        claim.title.toLowerCase().includes(term) ||
        claim.categoryName.toLowerCase().includes(term)),
  );
  const counts = data?.counts;
  const total = counts
    ? counts.submitted +
      counts.approved +
      counts.paid +
      counts.rejected +
      counts.cancelled
    : 0;
  return (
    <>
      <div className="expenses-stats expenses-stats-two">
        <StatCard
          label={text.stats.awaiting}
          value={counts?.submitted ?? 0}
          hint={text.stats.awaitingHint(
            money(data?.awaitingDecisionMinor ?? 0),
          )}
          icon={Hourglass}
          animate={!reduceMotion}
        />
        <StatCard
          label={text.stats.approved}
          value={counts?.approved ?? 0}
          hint={text.stats.approvedHint(money(data?.awaitingPaymentMinor ?? 0))}
          icon={ListChecks}
          animate={!reduceMotion}
        />
      </div>
      <section
        className="panel expenses-panel"
        aria-labelledby="expenses-approvals-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="expenses-approvals-heading">{text.approvals.heading}</h2>
            {data && (
              <p aria-live="polite">{text.approvals.total(items.length)}</p>
            )}
          </div>
        </div>
        <div className="directory-toolbar expenses-toolbar">
          <Input
            aria-label={text.approvals.searchLabel}
            placeholder={text.approvals.searchPlaceholder}
            maxLength={80}
            icon={MagnifyingGlass}
            value={search}
            onChange={setSearch}
            className="expenses-search"
          />
          <div
            className="expenses-chips"
            role="group"
            aria-label={text.approvals.statusLabel}
          >
            <button
              type="button"
              className="expenses-chip"
              aria-pressed={status === ""}
              onClick={() => setStatus("")}
            >
              {text.approvals.all} ({total})
            </button>
            {statusKeys.map((key) => (
              <button
                key={key}
                type="button"
                className="expenses-chip"
                aria-pressed={status === key}
                onClick={() => setStatus(status === key ? "" : key)}
              >
                {text.statusNames[key]} ({counts?.[key] ?? 0})
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <ErrorState
            message={error.message || text.list.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyBlock
              icon={Receipt}
              title={text.approvals.noMatchTitle}
              description={text.approvals.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    setSearch("");
                    setStatus("");
                  }}
                >
                  {text.approvals.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              icon={Receipt}
              title={text.approvals.emptyTitle}
              description={text.approvals.emptyBody}
            />
          )
        ) : (
          <ClaimCollection
            id="expenses-approvals"
            label={text.approvals.heading}
            claims={items}
            showPerson={true}
            onOpen={setOpenId}
          />
        )}
      </section>
      <DetailsDialog
        id={openId}
        claims={data?.items ?? []}
        remote
        onClose={() => setOpenId(null)}
      />
    </>
  );
}

/* Pay and settle --------------------------------------------------------- */

function PayView({ query }: { query: ReturnType<typeof useExpenses> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const { data, error, isPending, refetch } = query;
  const queue = (data?.items ?? []).filter((c) => c.status === "approved");
  const paying = queue.find((c) => c.id === payId) ?? null;
  return (
    <>
      <section
        className="panel expenses-panel"
        aria-labelledby="expenses-pay-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="expenses-pay-heading">{text.pay.heading}</h2>
            <p>{text.pay.intro}</p>
            {data && (
              <p aria-live="polite">
                {text.pay.total(queue.length)} ·{" "}
                {money(data.awaitingPaymentMinor)}
              </p>
            )}
          </div>
        </div>
        {error ? (
          <ErrorState
            message={error.message || text.list.loadFailed}
            onRetry={() => void refetch()}
          />
        ) : isPending ? (
          <LoadingState />
        ) : queue.length === 0 ? (
          <EmptyBlock
            icon={HandCoins}
            title={text.pay.emptyTitle}
            description={text.pay.emptyBody}
          />
        ) : (
          <ClaimCollection
            id="expenses-pay"
            label={text.pay.heading}
            claims={queue}
            showPerson={true}
            onOpen={setOpenId}
            extra={(claim) =>
              claim.canPay && (
                <Button onPress={() => setPayId(claim.id)}>
                  {text.pay.markPaid}
                </Button>
              )
            }
          />
        )}
      </section>
      <DetailsDialog
        id={openId}
        claims={data?.items ?? []}
        remote
        onClose={() => setOpenId(null)}
      />
      {paying && (
        <PayDialog
          claim={paying}
          open
          onClose={() => setPayId(null)}
          onSaved={() => setPayId(null)}
        />
      )}
    </>
  );
}

function PayDialog({
  claim,
  open,
  onClose,
  onSaved,
}: {
  claim: ExpenseClaim;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const req = useRequest();
  const { run, busy, error, setError, client } = req;
  const today = todayIso();
  // An advance is paid before its trip, so it is bounded by the request date.
  const min =
    claim.kind === "advance"
      ? addDays(claim.createdAt.slice(0, 10), -1)
      : claim.expenseDate;
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = await run(
      `/expenses/${claim.id}/pay`,
      expenseClaimSchema,
      {
        version: claim.version,
        paidOn: String(form.get("paidOn") ?? ""),
        paymentReference: String(form.get("reference") ?? "").trim(),
      },
      text.pay.failed,
    );
    if (!next) return;
    savedClaim(client, next);
    onSaved();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.pay.dialogTitle}
      className="leave-modal expenses-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>
          {text.pay.dialogIntro(
            claim.title,
            money(claim.amountMinor),
            claim.employeeName,
          )}
        </p>
        <Input
          label={text.pay.reference}
          hint={text.pay.referenceHint}
          name="reference"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={80}
          autoComplete="off"
          autoFocus
        />
        <RangeInput
          label={text.pay.paidOn}
          hint={text.pay.paidOnHint(day(min), day(today))}
          name="paidOn"
          type="date"
          isRequired
          hideRequiredIndicator
          defaultValue={today}
          min={min}
          max={today}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.pay.submit}
          saving={text.pay.saving}
          onCancel={close}
        />
      </form>
    </DialogPanel>
  );
}

/* Categories ------------------------------------------------------------- */

function CategoriesView({
  query,
}: {
  query: ReturnType<typeof useExpenseCategories>;
}) {
  const [editing, setEditing] = useState<ExpenseCategory | "new" | null>(null);
  const items = query.data?.items ?? [];
  return (
    <>
      <section
        className="panel expenses-panel"
        aria-labelledby="expenses-categories-heading"
      >
        <div className="panel-heading expenses-heading">
          <div>
            <h2 id="expenses-categories-heading">{text.categories.heading}</h2>
            <p>{text.categories.intro}</p>
            {query.data && (
              <p aria-live="polite">{text.categories.total(items.length)}</p>
            )}
          </div>
          <Button onPress={() => setEditing("new")}>
            <Plus size={18} weight="bold" />
            {text.categories.add}
          </Button>
        </div>
        {query.error ? (
          <ErrorState
            message={query.error.message || text.categories.loadFailed}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyBlock
            icon={Tag}
            title={text.categories.emptyTitle}
            description={text.categories.emptyBody}
          />
        ) : (
          <div className="expenses-table-box">
            <table className="expenses-table">
              <caption className="sr-only">
                {text.categories.tableCaption}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{text.categories.name}</th>
                  <th scope="col">{text.categories.code}</th>
                  <th scope="col">{text.categories.limit}</th>
                  <th scope="col">{text.categories.receipt}</th>
                  <th scope="col">{text.categories.status}</th>
                  <th scope="col">
                    <span className="sr-only">{text.categories.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((category) => (
                  <tr key={category.id}>
                    <th scope="row" data-label={text.categories.name}>
                      {category.name}
                    </th>
                    <td data-label={text.categories.code}>
                      <code>{category.code}</code>
                    </td>
                    <td data-label={text.categories.limit}>
                      {category.perClaimLimitMinor === null
                        ? text.categories.none
                        : money(category.perClaimLimitMinor)}
                    </td>
                    <td data-label={text.categories.receipt}>
                      {category.requiresReceiptOverMinor === null
                        ? text.categories.none
                        : category.requiresReceiptOverMinor === 0
                          ? text.categories.always
                          : money(category.requiresReceiptOverMinor)}
                    </td>
                    <td data-label={text.categories.status}>
                      <StatusBadge
                        color={category.active ? "success" : "gray"}
                        size="sm"
                        type="pill-color"
                      >
                        {category.active
                          ? text.categories.active
                          : text.categories.retired}
                      </StatusBadge>
                    </td>
                    <td className="expenses-table-actions">
                      <Button
                        variant="secondary"
                        aria-label={text.categories.editLabel(category.name)}
                        onPress={() => setEditing(category)}
                      >
                        {text.categories.edit}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CategoryDialog
        category={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function CategoryDialog({
  category,
  open,
  onClose,
}: {
  category: ExpenseCategory | null;
  open: boolean;
  onClose: () => void;
}) {
  const req = useRequest();
  const { busy, setError } = req;
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.category.title}
      className="leave-modal expenses-modal"
    >
      <CategoryForm
        key={category?.id ?? "new"}
        category={category}
        req={req}
        onCancel={close}
        onSaved={onClose}
      />
    </DialogPanel>
  );
}

function CategoryForm({
  category,
  req,
  onCancel,
  onSaved,
}: {
  category: ExpenseCategory | null;
  req: Request;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { run, busy, error, setError, client } = req;
  const [code, setCode] = useState("");
  const [limit, setLimit] = useState(
    category?.perClaimLimitMinor != null
      ? toRupees(category.perClaimLimitMinor)
      : "",
  );
  const [receipt, setReceipt] = useState(
    category?.requiresReceiptOverMinor != null
      ? toRupees(category.requiresReceiptOverMinor)
      : "",
  );
  const [active, setActive] = useState(category?.active ?? true);
  const limitMinor = limit.trim() === "" ? null : toMinor(limit);
  const receiptMinor = receipt.trim() === "" ? null : toMinor(receipt);
  const limitBad =
    limit.trim() !== "" && (limitMinor === null || limitMinor < 1);
  const receiptBad = receipt.trim() !== "" && receiptMinor === null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (limitBad || receiptBad) {
      setError(text.category.amountBad);
      return;
    }
    const name = String(
      new FormData(event.currentTarget).get("name") ?? "",
    ).trim();
    const fields = {
      name,
      perClaimLimitMinor: limitMinor,
      requiresReceiptOverMinor: receiptMinor,
      active,
    };
    const next = await run(
      category ? `/expenses/categories/${category.id}` : "/expenses/categories",
      expenseCategorySchema,
      category ? { version: category.version, ...fields } : { code, ...fields },
      text.category.failed,
      { method: category ? "PUT" : "POST", category: true },
    );
    if (!next) return;
    void client.invalidateQueries({ queryKey: ["expenses", "categories"] });
    onSaved();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <Input
        label={text.category.code}
        hint={category ? text.category.codeLocked : text.category.codeHint}
        isRequired
        hideRequiredIndicator
        isReadOnly={Boolean(category)}
        value={category ? category.code : code}
        pattern="[A-Z][A-Z0-9_]{1,15}"
        maxLength={16}
        autoComplete="off"
        autoFocus={!category}
        onChange={(value: string) => setCode(value.toUpperCase())}
      />
      <Input
        label={text.category.name}
        hint={text.category.nameHint}
        name="name"
        isRequired
        hideRequiredIndicator
        minLength={2}
        maxLength={60}
        defaultValue={category?.name ?? ""}
        autoComplete="off"
        autoFocus={Boolean(category)}
      />
      <Input
        label={text.category.limit}
        hint={limitBad ? text.category.limitBad : text.category.limitHint}
        inputMode="decimal"
        value={limit}
        isInvalid={limitBad}
        onChange={(value: string) => setLimit(value)}
      />
      <Input
        label={text.category.receipt}
        hint={receiptBad ? text.category.amountBad : text.category.receiptHint}
        inputMode="decimal"
        value={receipt}
        isInvalid={receiptBad}
        onChange={(value: string) => setReceipt(value)}
      />
      <Toggle
        isSelected={active}
        onChange={setActive}
        label={text.category.active}
        hint={text.category.activeHint}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={
          category ? text.category.submitSave : text.category.submitCreate
        }
        saving={text.category.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

/* New claim -------------------------------------------------------------- */

function ClaimDialog({
  open,
  categories,
  categoriesFailed,
  onClose,
}: {
  open: boolean;
  categories: ExpenseCategory[];
  categoriesFailed: boolean;
  onClose: () => void;
}) {
  const req = useRequest();
  const { busy, setError } = req;
  function close() {
    if (busy) return;
    setError("");
    onClose();
  }
  return (
    <DialogPanel
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={text.claim.title}
      className="leave-modal expenses-modal"
    >
      <ClaimForm
        categories={categories}
        categoriesFailed={categoriesFailed}
        req={req}
        onCancel={close}
        onSaved={onClose}
      />
    </DialogPanel>
  );
}

function ClaimForm({
  categories,
  categoriesFailed,
  req,
  onCancel,
  onSaved,
}: {
  categories: ExpenseCategory[];
  categoriesFailed: boolean;
  req: Request;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { run, busy, error, setError, client } = req;
  const today = todayIso();
  const [kind, setKind] = useState<ExpenseKind>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const trip = kind !== "expense";
  const min = addDays(today, -90);
  const max = kind === "advance" ? addDays(today, 90) : today;
  const choices = categories.filter((c) => c.active);
  const category = choices.find((c) => c.id === categoryId) ?? null;
  const minor = amount.trim() === "" ? null : toMinor(amount);
  const amountBad = amount.trim() !== "" && (minor === null || minor < 1);
  const overLimit =
    category?.perClaimLimitMinor != null &&
    minor !== null &&
    minor > category.perClaimLimitMinor;
  const needsReceipt =
    category?.requiresReceiptOverMinor != null &&
    minor !== null &&
    minor > category.requiresReceiptOverMinor;
  function pickKind(next: ExpenseKind) {
    setKind(next);
    // Keep the date inside what the new type allows.
    const upper = next === "advance" ? addDays(today, 90) : today;
    if (date > upper) setDate(upper);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (minor === null || amountBad) {
      setError(text.claim.amountBad);
      return;
    }
    if (overLimit && category?.perClaimLimitMinor != null) {
      setError(
        text.claim.overLimit(money(category.perClaimLimitMinor), category.name),
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const clean = (key: string) => String(form.get(key) ?? "").trim() || null;
    const next = await run(
      "/expenses/mine",
      myExpensesSchema,
      {
        kind,
        title: String(form.get("title") ?? "").trim(),
        categoryId,
        amountMinor: minor,
        expenseDate: date,
        tripDestination: trip ? clean("destination") : null,
        description: clean("description"),
        receiptReference: clean("receipt"),
      },
      text.claim.failed,
    );
    if (!next) return;
    savedMine(client, next);
    onSaved();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{text.claim.intro}</p>
      <Select
        label={text.claim.kind}
        selectedKey={kind}
        onSelectionChange={(key) => pickKind(String(key) as ExpenseKind)}
      >
        {kindKeys.map((key) => (
          <Select.Item key={key} id={key} label={text.kinds[key]} />
        ))}
      </Select>
      <Input
        label={text.claim.titleLabel}
        hint={text.claim.titleHint}
        name="title"
        isRequired
        hideRequiredIndicator
        minLength={3}
        maxLength={120}
        autoComplete="off"
        autoFocus
      />
      <Select
        label={text.claim.category}
        hint={
          categoriesFailed
            ? text.claim.categoriesFailed
            : category
              ? category.perClaimLimitMinor === null
                ? text.claim.categoryNoLimit
                : text.claim.categoryLimit(money(category.perClaimLimitMinor))
              : choices.length === 0
                ? text.claim.noCategories
                : ""
        }
        placeholder={text.claim.categoryPlaceholder}
        isRequired
        hideRequiredIndicator
        selectedKey={categoryId || null}
        onSelectionChange={(key) => setCategoryId(key ? String(key) : "")}
      >
        {choices.map((c) => (
          <Select.Item key={c.id} id={c.id} label={c.name} />
        ))}
      </Select>
      <Input
        label={text.claim.amount}
        hint={amountBad ? text.claim.amountBad : text.claim.amountHint}
        inputMode="decimal"
        isRequired
        hideRequiredIndicator
        autoComplete="off"
        value={amount}
        isInvalid={amountBad || overLimit}
        onChange={(value: string) => setAmount(value)}
      />
      <div id="expenses-amount-warning" aria-live="polite">
        {overLimit && category?.perClaimLimitMinor != null && (
          <p className="expenses-warning">
            {text.claim.overLimit(
              money(category.perClaimLimitMinor),
              category.name,
            )}
          </p>
        )}
      </div>
      <RangeInput
        label={text.claim.date}
        hint={trip ? text.claim.dateHintTrip : text.claim.dateHint}
        type="date"
        isRequired
        hideRequiredIndicator
        value={date}
        min={min}
        max={max}
        onChange={(value: string) => setDate(value)}
      />
      {trip && (
        <Input
          label={text.claim.destination}
          hint={text.claim.destinationHint}
          name="destination"
          isRequired
          hideRequiredIndicator
          minLength={2}
          maxLength={120}
          autoComplete="off"
        />
      )}
      <Input
        label={text.claim.receipt}
        hint={
          needsReceipt && category?.requiresReceiptOverMinor != null
            ? text.claim.receiptNeeded(money(category.requiresReceiptOverMinor))
            : text.claim.receiptHint
        }
        name="receipt"
        isRequired={needsReceipt}
        hideRequiredIndicator
        minLength={2}
        maxLength={80}
        autoComplete="off"
      />
      <TextArea
        label={text.claim.description}
        hint={text.claim.descriptionHint}
        name="description"
        textAreaClassName="expenses-note-input"
        maxLength={1000}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={text.claim.submit}
        saving={text.claim.saving}
        onCancel={onCancel}
      />
    </form>
  );
}

/* Details ---------------------------------------------------------------- */

type Action =
  { kind: "reject"; note: string } | { kind: "cancel" } | { kind: "pay" };

function DetailsDialog({
  id,
  claims,
  remote,
  onClose,
}: {
  id: string | null;
  claims: ExpenseClaim[];
  /** Approvers read the single claim from the server as well. */
  remote: boolean;
  onClose: () => void;
}) {
  const fetched = useExpense(remote ? id : null);
  const [action, setAction] = useState<Action | null>(null);
  const listed = id ? (claims.find((c) => c.id === id) ?? null) : null;
  const claim =
    fetched.data &&
    fetched.data.id === id &&
    (!listed || fetched.data.version >= listed.version)
      ? fetched.data
      : listed;
  function close() {
    setAction(null);
    onClose();
  }
  return (
    <>
      <DialogPanel
        open={Boolean(id) && !action}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={text.details.title}
        className="leave-modal expenses-modal"
      >
        {claim ? (
          <DetailBody key={claim.id} claim={claim} onAction={setAction} />
        ) : fetched.error ? (
          <ErrorState
            message={fetched.error.message || text.details.loadFailed}
            onRetry={() => void fetched.refetch()}
          />
        ) : (
          <LoadingState />
        )}
      </DialogPanel>
      {claim && action?.kind === "reject" && (
        <RejectDialog
          claim={claim}
          note={action.note}
          onCancel={() => setAction(null)}
          onSaved={() => setAction(null)}
        />
      )}
      {claim && action?.kind === "cancel" && (
        <CancelDialog
          claim={claim}
          onCancel={() => setAction(null)}
          onSaved={() => setAction(null)}
        />
      )}
      {claim && action?.kind === "pay" && (
        <PayDialog
          claim={claim}
          open
          onClose={() => setAction(null)}
          onSaved={() => setAction(null)}
        />
      )}
    </>
  );
}

function Timeline({ claim }: { claim: ExpenseClaim }) {
  const { status } = claim;
  type Step = {
    key: string;
    label: string;
    state: "done" | "current" | "next" | "stopped";
  };
  const first: Step = {
    key: "submitted",
    label: text.steps.submitted,
    state: "done",
  };
  const steps: Step[] =
    status === "rejected" || status === "cancelled"
      ? [first, { key: status, label: text.steps[status], state: "stopped" }]
      : [
          first,
          {
            key: "approved",
            label: text.steps.approved,
            state: status === "submitted" ? "current" : "done",
          },
          {
            key: "paid",
            label: text.steps.paid,
            state:
              status === "paid"
                ? "done"
                : status === "approved"
                  ? "current"
                  : "next",
          },
        ];
  const words = {
    done: text.steps.done,
    current: text.steps.current,
    next: text.steps.next,
    stopped: text.steps.stopped,
  };
  return (
    <ol
      className="expenses-steps"
      aria-label={text.details.progress}
      style={{ "--steps": steps.length } as CSSProperties}
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          className="expenses-step"
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="expenses-marker" aria-hidden="true">
            {step.state === "done" ? (
              <Check size={14} weight="bold" />
            ) : step.state === "stopped" ? (
              <X size={14} weight="bold" />
            ) : (
              index + 1
            )}
          </span>
          <span className="expenses-step-text">
            <strong>{step.label}</strong>
            <small>{words[step.state]}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function DetailBody({
  claim,
  onAction,
}: {
  claim: ExpenseClaim;
  onAction: (action: Action) => void;
}) {
  const { me } = useWorkspace();
  const { run, busy, error, client } = useRequest();
  const [note, setNote] = useState("");
  const own = claim.employeeId === me.employeeId;
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    const next = await run(
      `/expenses/${claim.id}/approve`,
      expenseClaimSchema,
      { version: claim.version, ...(trimmed ? { note: trimmed } : {}) },
      text.approve.failed,
      { own },
    );
    if (next) {
      savedClaim(client, next);
      setNote("");
    }
  }
  const people = text.list.by(claim.employeeName, claim.employeeCode);
  return (
    <div className="expenses-detail">
      <header className="expenses-detail-head">
        <div className="expenses-title">
          <strong>{claim.title}</strong>
          <span className="expenses-amount">{money(claim.amountMinor)}</span>
        </div>
        <div className="expenses-meta">
          <StatusPill status={claim.status} />
          <small>{text.kinds[claim.kind]}</small>
          <small>{claim.categoryName}</small>
        </div>
      </header>

      <Timeline claim={claim} />

      <section aria-labelledby="expenses-facts" className="expenses-section">
        <h3 id="expenses-facts">{text.details.facts}</h3>
        <dl className="expenses-facts">
          <div>
            <dt>{text.details.person}</dt>
            <dd>{people}</dd>
          </div>
          <div>
            <dt>
              {claim.kind === "advance"
                ? text.details.tripDate
                : text.details.date}
            </dt>
            <dd>{day(claim.expenseDate)}</dd>
          </div>
          {claim.tripDestination && (
            <div>
              <dt>{text.details.destination}</dt>
              <dd>{claim.tripDestination}</dd>
            </div>
          )}
          <div>
            <dt>{text.details.receipt}</dt>
            <dd>{claim.receiptReference ?? text.details.noReceipt}</dd>
          </div>
          {claim.description && (
            <div className="expenses-wide">
              <dt>{text.details.description}</dt>
              <dd>{claim.description}</dd>
            </div>
          )}
          {claim.decisionNote && (
            <div className="expenses-wide">
              <dt>{text.details.decisionNote}</dt>
              <dd>{claim.decisionNote}</dd>
            </div>
          )}
        </dl>
        <small className="expenses-muted">
          {text.details.submittedOn(day(claim.createdAt))}
          {claim.decidedAt && claim.decidedBy
            ? ` ${text.details.decidedBy(claim.decidedBy, day(claim.decidedAt))}`
            : ""}
          {claim.cancelledAt
            ? ` ${text.details.cancelledOn(day(claim.cancelledAt))}`
            : ""}
        </small>
      </section>

      {claim.status === "paid" && claim.paymentReference && claim.paidOn && (
        <section
          aria-labelledby="expenses-payment"
          className="expenses-section"
        >
          <h3 id="expenses-payment">{text.details.paymentHeading}</h3>
          <dl className="expenses-facts">
            <div>
              <dt>{text.details.paymentReference}</dt>
              <dd>{claim.paymentReference}</dd>
            </div>
            <div>
              <dt>{text.details.paidOn}</dt>
              <dd>{day(claim.paidOn)}</dd>
            </div>
          </dl>
          {claim.paidBy && (
            <small className="expenses-muted">
              {text.details.paidBy(claim.paidBy)}
            </small>
          )}
        </section>
      )}

      {(claim.canDecide || claim.canPay || claim.canCancel) && (
        <section
          aria-labelledby="expenses-actions"
          className="expenses-section"
        >
          <h3 id="expenses-actions">{text.details.actions}</h3>
          {claim.canDecide ? (
            <form
              className="expenses-decide"
              onSubmit={(event) => void approve(event)}
            >
              <TextArea
                label={text.details.decideNote}
                hint={`${text.details.decideNoteHint} ${text.form.count(note.length)}`}
                textAreaClassName="expenses-note-input"
                minLength={3}
                maxLength={500}
                value={note}
                onChange={(value: string) => setNote(value)}
              />
              <FormError message={error} />
              <div className="expenses-actions">
                <Button type="submit" isDisabled={busy}>
                  {busy ? text.details.approving : text.details.approve}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => onAction({ kind: "reject", note })}
                >
                  {text.details.reject}
                </Button>
                {claim.canPay && (
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => onAction({ kind: "pay" })}
                  >
                    {text.details.markPaid}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <>
              <div className="expenses-actions">
                {claim.canPay && (
                  <Button onPress={() => onAction({ kind: "pay" })}>
                    {text.details.markPaid}
                  </Button>
                )}
                {claim.canCancel && (
                  <Button
                    variant="secondary"
                    onPress={() => onAction({ kind: "cancel" })}
                  >
                    {text.details.cancel}
                  </Button>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function RejectDialog({
  claim,
  note: initial,
  onCancel,
  onSaved,
}: {
  claim: ExpenseClaim;
  note: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { me } = useWorkspace();
  const { run, busy, error, client } = useRequest();
  const [note, setNote] = useState(initial);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await run(
      `/expenses/${claim.id}/reject`,
      expenseClaimSchema,
      { version: claim.version, note: note.trim() },
      text.reject.failed,
      { own: claim.employeeId === me.employeeId },
    );
    if (!next) return;
    savedClaim(client, next);
    onSaved();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      title={text.reject.title}
      className="leave-modal expenses-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.reject.intro(claim.title)}</p>
        <TextArea
          label={text.reject.note}
          hint={`${text.reject.noteHint} ${text.form.count(note.length)}`}
          textAreaClassName="expenses-note-input"
          isRequired
          hideRequiredIndicator
          minLength={3}
          maxLength={500}
          value={note}
          autoFocus
          onChange={(value: string) => setNote(value)}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={text.reject.submit}
          saving={text.reject.saving}
          onCancel={onCancel}
        />
      </form>
    </DialogPanel>
  );
}

function CancelDialog({
  claim,
  onCancel,
  onSaved,
}: {
  claim: ExpenseClaim;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { run, busy, error, client } = useRequest();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await run(
      `/expenses/mine/${claim.id}/cancel`,
      myExpensesSchema,
      { version: claim.version },
      text.cancel.failed,
      { own: true },
    );
    if (!next) return;
    savedMine(client, next);
    onSaved();
  }
  return (
    <DialogPanel
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      title={text.cancel.title}
      className="leave-modal expenses-modal"
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{text.cancel.intro(claim.title)}</p>
        <FormError message={error} />
        <FormActions
          busy={busy}
          cancel={text.cancel.keep}
          submit={text.cancel.submit}
          saving={text.cancel.saving}
          onCancel={onCancel}
        />
      </form>
    </DialogPanel>
  );
}
