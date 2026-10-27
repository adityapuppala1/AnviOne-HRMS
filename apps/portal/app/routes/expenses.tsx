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
  DialogPanel,
  EmptyBlock,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
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

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="expenses-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined && (
        <p className="expenses-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
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
          <ul className="expenses-list">
            {items.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                showPerson={false}
                onOpen={() => setOpenId(claim.id)}
              />
            ))}
          </ul>
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
    <li className="expenses-row">
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
    </li>
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
          <label className="search-box">
            <MagnifyingGlass size={18} />
            <input
              aria-label={text.approvals.searchLabel}
              placeholder={text.approvals.searchPlaceholder}
              maxLength={80}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
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
          <ul className="expenses-list">
            {items.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                showPerson
                onOpen={() => setOpenId(claim.id)}
              />
            ))}
          </ul>
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
          <ul className="expenses-list">
            {queue.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                showPerson
                onOpen={() => setOpenId(claim.id)}
                extra={
                  claim.canPay && (
                    <Button onPress={() => setPayId(claim.id)}>
                      {text.pay.markPaid}
                    </Button>
                  )
                }
              />
            ))}
          </ul>
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
        <Field
          id="expenses-pay-reference"
          label={text.pay.reference}
          hint={text.pay.referenceHint}
        >
          <input
            id="expenses-pay-reference"
            name="reference"
            type="text"
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            aria-describedby="expenses-pay-reference-hint"
            autoFocus
          />
        </Field>
        <Field
          id="expenses-pay-date"
          label={text.pay.paidOn}
          hint={text.pay.paidOnHint(day(min), day(today))}
        >
          <input
            id="expenses-pay-date"
            name="paidOn"
            type="date"
            required
            defaultValue={today}
            min={min}
            max={today}
            aria-describedby="expenses-pay-date-hint"
          />
        </Field>
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
      <Field
        id="expenses-cat-code"
        label={text.category.code}
        hint={category ? text.category.codeLocked : text.category.codeHint}
      >
        <input
          id="expenses-cat-code"
          type="text"
          required
          readOnly={Boolean(category)}
          value={category ? category.code : code}
          pattern="[A-Z][A-Z0-9_]{1,15}"
          maxLength={16}
          autoComplete="off"
          aria-describedby="expenses-cat-code-hint"
          autoFocus={!category}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
      </Field>
      <Field
        id="expenses-cat-name"
        label={text.category.name}
        hint={text.category.nameHint}
      >
        <input
          id="expenses-cat-name"
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={60}
          defaultValue={category?.name ?? ""}
          autoComplete="off"
          aria-describedby="expenses-cat-name-hint"
          autoFocus={Boolean(category)}
        />
      </Field>
      <Field
        id="expenses-cat-limit"
        label={text.category.limit}
        hint={limitBad ? text.category.limitBad : text.category.limitHint}
      >
        <input
          id="expenses-cat-limit"
          type="text"
          inputMode="decimal"
          value={limit}
          aria-invalid={limitBad}
          aria-describedby="expenses-cat-limit-hint"
          onChange={(event) => setLimit(event.target.value)}
        />
      </Field>
      <Field
        id="expenses-cat-receipt"
        label={text.category.receipt}
        hint={receiptBad ? text.category.amountBad : text.category.receiptHint}
      >
        <input
          id="expenses-cat-receipt"
          type="text"
          inputMode="decimal"
          value={receipt}
          aria-invalid={receiptBad}
          aria-describedby="expenses-cat-receipt-hint"
          onChange={(event) => setReceipt(event.target.value)}
        />
      </Field>
      <label className="expenses-check">
        <input
          type="checkbox"
          role="switch"
          checked={active}
          aria-describedby="expenses-cat-active-hint"
          onChange={(event) => setActive(event.target.checked)}
        />
        <span>{text.category.active}</span>
      </label>
      <p className="expenses-hint" id="expenses-cat-active-hint">
        {text.category.activeHint}
      </p>
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
      <Field id="expenses-kind" label={text.claim.kind}>
        <select
          id="expenses-kind"
          value={kind}
          onChange={(event) => pickKind(event.target.value as ExpenseKind)}
        >
          {kindKeys.map((key) => (
            <option key={key} value={key}>
              {text.kinds[key]}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="expenses-title"
        label={text.claim.titleLabel}
        hint={text.claim.titleHint}
      >
        <input
          id="expenses-title"
          name="title"
          type="text"
          required
          minLength={3}
          maxLength={120}
          autoComplete="off"
          aria-describedby="expenses-title-hint"
          autoFocus
        />
      </Field>
      <Field
        id="expenses-category"
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
      >
        <select
          id="expenses-category"
          required
          value={categoryId}
          aria-describedby="expenses-category-hint"
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">{text.claim.categoryPlaceholder}</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="expenses-amount"
        label={text.claim.amount}
        hint={amountBad ? text.claim.amountBad : text.claim.amountHint}
      >
        <input
          id="expenses-amount"
          type="text"
          inputMode="decimal"
          required
          autoComplete="off"
          value={amount}
          aria-invalid={amountBad || overLimit}
          aria-describedby="expenses-amount-hint expenses-amount-warning"
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
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
      <Field
        id="expenses-date"
        label={text.claim.date}
        hint={trip ? text.claim.dateHintTrip : text.claim.dateHint}
      >
        <input
          id="expenses-date"
          type="date"
          required
          value={date}
          min={min}
          max={max}
          aria-describedby="expenses-date-hint"
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>
      {trip && (
        <Field
          id="expenses-destination"
          label={text.claim.destination}
          hint={text.claim.destinationHint}
        >
          <input
            id="expenses-destination"
            name="destination"
            type="text"
            required
            minLength={2}
            maxLength={120}
            autoComplete="off"
            aria-describedby="expenses-destination-hint"
          />
        </Field>
      )}
      <Field
        id="expenses-receipt"
        label={text.claim.receipt}
        hint={
          needsReceipt && category?.requiresReceiptOverMinor != null
            ? text.claim.receiptNeeded(money(category.requiresReceiptOverMinor))
            : text.claim.receiptHint
        }
      >
        <input
          id="expenses-receipt"
          name="receipt"
          type="text"
          required={needsReceipt}
          minLength={2}
          maxLength={80}
          autoComplete="off"
          aria-describedby="expenses-receipt-hint"
        />
      </Field>
      <Field
        id="expenses-description"
        label={text.claim.description}
        hint={text.claim.descriptionHint}
      >
        <textarea
          id="expenses-description"
          name="description"
          className="expenses-note-input"
          maxLength={1000}
          aria-describedby="expenses-description-hint"
        />
      </Field>
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
              <Field
                id="expenses-decide-note"
                label={text.details.decideNote}
                hint={`${text.details.decideNoteHint} ${text.form.count(note.length)}`}
              >
                <textarea
                  id="expenses-decide-note"
                  className="expenses-note-input"
                  minLength={3}
                  maxLength={500}
                  value={note}
                  aria-describedby="expenses-decide-note-hint"
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
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
        <Field
          id="expenses-reject-note"
          label={text.reject.note}
          hint={`${text.reject.noteHint} ${text.form.count(note.length)}`}
        >
          <textarea
            id="expenses-reject-note"
            className="expenses-note-input"
            required
            minLength={3}
            maxLength={500}
            value={note}
            aria-describedby="expenses-reject-note-hint"
            autoFocus
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
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
