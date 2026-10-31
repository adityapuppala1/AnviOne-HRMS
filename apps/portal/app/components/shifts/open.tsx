import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import {
  Button,
  CollectionView,
  DetailFields,
  ErrorState,
  RangeInput,
  Select,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { ShfClaim, ShfOpenShift } from "@anvi/contracts";
import {
  useShfClaims,
  useShfOpen,
  useShfOpenDetail,
  useShfTemplates,
} from "../../lib/shifts-api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import {
  ConfirmDialog,
  FilterSelect,
  FormActions,
  FormError,
  Modal,
  ShiftBlock,
  StatusPill,
  addDays,
  claimColor,
  dateTime,
  dayLong,
  hoursText,
  openColor,
  timeRange,
  todayIso,
  useShfSend,
} from "./shared";

const copy = text.open;

type Acting =
  | { kind: "withdrawOpen"; item: ShfOpenShift }
  | { kind: "withdrawClaim"; claim: ShfClaim }
  | { kind: "approve" | "reject"; claim: ShfClaim };

function StatusCell({ item }: { item: ShfOpenShift }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusPill
        label={copy.status[item.status]}
        color={openColor[item.status] ?? "gray"}
      />
      {item.myClaimStatus && (
        <StatusPill
          label={copy.claimStatus[item.myClaimStatus]}
          color={claimColor[item.myClaimStatus] ?? "gray"}
        />
      )}
    </span>
  );
}

// Approving a claim after the shift's date has passed is refused by the server; say so up front
// and leave Reject available.
const passed = (claim: ShfClaim) => claim.workDate < todayIso();

function ClaimButtons({
  claim,
  ask,
}: {
  claim: ShfClaim;
  ask: (next: Acting) => void;
}) {
  const named = `${claim.employeeName}, ${dayLong(claim.workDate)}`;
  const late = claim.canApprove && passed(claim);
  return (
    <span className="flex min-w-0 flex-col gap-2">
      <span className="flex flex-wrap gap-2">
        {claim.canApprove && !late && (
          <Button
            aria-label={`${copy.approve}: ${named}`}
            onPress={() => ask({ kind: "approve", claim })}
          >
            {copy.approve}
          </Button>
        )}
        {claim.canReject && (
          <Button
            variant="secondary"
            aria-label={`${copy.reject}: ${named}`}
            onPress={() => ask({ kind: "reject", claim })}
          >
            {copy.reject}
          </Button>
        )}
        {claim.canWithdraw && (
          <Button
            variant="secondary"
            aria-label={`${copy.withdrawClaim}: ${dayLong(claim.workDate)}`}
            onPress={() => ask({ kind: "withdrawClaim", claim })}
          >
            {copy.withdrawClaim}
          </Button>
        )}
      </span>
      {late && (
        <span className="recruit-muted" role="note">
          {copy.pastDate}
        </span>
      )}
      {claim.mine && claim.status === "pending" && (
        <span className="recruit-muted" role="note">
          {copy.fourEyes}
        </span>
      )}
      {claim.decisionReason && (
        <span className="recruit-muted" dir="auto">
          {copy.reasonGiven}: {claim.decisionReason}
        </span>
      )}
      {claim.decidedBy && (
        <span className="recruit-muted" dir="auto">
          {copy.decidedBy(claim.decidedBy)}
        </span>
      )}
    </span>
  );
}

export function OpenShiftsTab({ decide }: { decide: boolean }) {
  const { attempt } = useShfSend();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [acting, setActing] = useState<Acting | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const query = new URLSearchParams({ page: String(page), limit: "10" });
  if (status !== "all") query.set("status", status);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) query.set("from", fromDate);
  const list = useShfOpen(true, query.toString());
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  async function claim(item: ShfOpenShift) {
    setNotice("");
    const problem = await attempt(`open/${item.id}/claim`, {});
    setNotice(problem ?? copy.claimed);
    setFailed(problem !== null);
  }
  const ask = (next: Acting) => {
    setOpenKey(null);
    setActing(next);
  };
  const actionsOf = (item: ShfOpenShift) =>
    item.canClaim ? (
      <Button
        aria-label={`${copy.claim}: ${dayLong(item.workDate)}`}
        onPress={() => void claim(item)}
      >
        {copy.claim}
      </Button>
    ) : null;

  const columns: Column<ShfOpenShift>[] = [
    {
      id: "date",
      label: copy.columns.date,
      isRowHeader: true,
      sortValue: (i) => i.workDate,
      render: (i) => <strong className="text-sm">{dayLong(i.workDate)}</strong>,
    },
    {
      id: "shift",
      label: copy.columns.shift,
      render: (i) => (
        <span className="text-sm" dir="auto">
          {i.templateName} · {i.templateCode}
        </span>
      ),
    },
    {
      id: "time",
      label: copy.columns.time,
      render: (i) => (
        <span className="text-sm">{timeRange(i.startAt, i.endAt)}</span>
      ),
    },
    {
      id: "status",
      label: copy.columns.status,
      render: (i) => <StatusCell item={i} />,
    },
    {
      id: "claims",
      label: copy.columns.claims,
      render: (i) => (
        <span className="text-sm">{copy.pendingClaims(i.pendingClaims)}</span>
      ),
    },
    { id: "actions", label: copy.columns.actions, render: actionsOf },
  ];

  const detail: CollectionDetail<ShfOpenShift> = {
    title: (i) => i.templateName,
    subtitle: (i) => (
      <span className="flex flex-wrap items-center gap-2">
        {dayLong(i.workDate)}
        <StatusCell item={i} />
      </span>
    ),
    body: (i) => <OpenBody item={i} ask={ask} />,
    footer: (i) => (
      <>
        {actionsOf(i)}
        {i.canWithdraw && (
          <Button
            variant="secondary"
            onPress={() => ask({ kind: "withdrawOpen", item: i })}
          >
            {copy.withdrawOpen}
          </Button>
        )}
      </>
    ),
  };

  const dialog =
    acting?.kind === "withdrawOpen"
      ? {
          title: copy.withdrawTitle,
          body: copy.withdrawBody,
          submit: copy.withdrawSubmit,
          reason: false,
          label: undefined,
        }
      : acting?.kind === "withdrawClaim"
        ? {
            title: copy.withdrawClaim,
            body: copy.withdrawClaimBody,
            submit: copy.withdrawClaim,
            reason: false,
            label: undefined,
          }
        : acting?.kind === "approve"
          ? {
              title: copy.approveTitle,
              body: copy.approveBody,
              submit: copy.approveSubmit,
              reason: false,
              label: undefined,
            }
          : acting
            ? {
                title: copy.rejectTitle,
                body: copy.rejectBody,
                submit: copy.rejectSubmit,
                reason: true,
                label: copy.rejectReason,
              }
            : null;

  return (
    <div className="perf-tab hd-tab shf-tab">
      <p className="recruit-muted">{copy.intro}</p>
      <section className="hd-section" aria-label={copy.title}>
        <div className="recruit-toolbar">
          <div className="recruit-filters">
            <FilterSelect
              label={copy.statusLabel}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              allLabel={copy.allStatuses}
              options={Object.entries(copy.status).map(([id, label]) => ({
                id,
                label,
              }))}
            />
            <RangeInput
              type="date"
              label={copy.fromDate}
              value={fromDate}
              onChange={(value) => {
                setFromDate(value);
                setPage(1);
              }}
            />
          </div>
          {list.data?.canPost && (
            <Button
              onPress={() => {
                setNotice("");
                setPosting(true);
              }}
            >
              <Plus size={18} />
              {copy.post}
            </Button>
          )}
        </div>
        {notice && (
          <p
            role={failed ? "alert" : "status"}
            className={failed ? "inline-error" : "recruit-notice"}
            dir="auto"
          >
            {notice}
          </p>
        )}
        <CollectionView
          id="shf-open"
          label={copy.title}
          noun="open shifts"
          items={list.data?.items ?? []}
          loading={!list.data}
          getKey={(i) => i.id}
          columns={columns}
          openKey={openKey}
          onOpenKeyChange={setOpenKey}
          server={{
            page,
            limit: list.data?.limit ?? 10,
            total: list.data?.total ?? 0,
            onPageChange: setPage,
          }}
          emptyIcon={Hand}
          emptyTitle={copy.empty}
          emptyDescription={copy.emptyBody}
          renderCard={(i) => (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className="text-primary">{dayLong(i.workDate)}</strong>
                <StatusCell item={i} />
              </div>
              <ShiftBlock
                shift={{
                  ...i,
                  crossesMidnight: i.endAt.slice(0, 10) > i.workDate,
                }}
              />
              <span className="text-sm text-tertiary" dir="auto">
                {copy.audience[i.audience]} · {copy.postedBy(i.postedBy)}
              </span>
              <span className="text-sm">
                {copy.pendingClaims(i.pendingClaims)}
              </span>
              {actionsOf(i)}
            </div>
          )}
          detail={detail}
        />
      </section>
      {decide && <ClaimsToDecide ask={ask} />}
      <Modal
        open={posting}
        title={copy.postTitle}
        onClose={() => setPosting(false)}
      >
        {posting && (
          <PostFields
            onClose={() => setPosting(false)}
            onDone={() => {
              setFailed(false);
              setNotice(copy.posted);
            }}
          />
        )}
      </Modal>
      {acting && dialog && (
        <ConfirmDialog
          open
          title={dialog.title}
          body={dialog.body}
          label={dialog.label}
          submit={dialog.submit}
          needsReason={dialog.reason}
          onClose={() => setActing(null)}
          onSubmit={(reason) => {
            if (acting.kind === "withdrawOpen")
              return attempt(`open/${acting.item.id}/withdraw`, {
                version: acting.item.version,
              });
            const step =
              acting.kind === "withdrawClaim" ? "withdraw" : acting.kind;
            return attempt(`claims/${acting.claim.id}/${step}`, {
              version: acting.claim.version,
              ...(reason ? { reason } : {}),
            });
          }}
        />
      )}
    </div>
  );
}

function OpenBody({
  item,
  ask,
}: {
  item: ShfOpenShift;
  ask: (next: Acting) => void;
}) {
  const full = useShfOpenDetail(item.id);
  const shown = full.data?.openShift ?? item;
  return (
    <div className="flex flex-col gap-5">
      <DetailFields
        title={copy.title}
        fields={[
          {
            label: copy.columns.shift,
            value: <bdi>{`${shown.templateName} · ${shown.templateCode}`}</bdi>,
          },
          { label: copy.columns.date, value: dayLong(shown.workDate) },
          {
            label: copy.columns.time,
            value: timeRange(shown.startAt, shown.endAt),
          },
          {
            label: text.detail.planned,
            value: hoursText(shown.plannedMinutes),
          },
          {
            label: text.detail.break,
            value:
              shown.breakMinutes > 0
                ? text.shift.break(shown.breakMinutes)
                : text.shift.noBreak,
          },
          { label: copy.statusLabel, value: copy.status[shown.status] },
          { label: copy.whoCanClaim, value: copy.audience[shown.audience] },
          { label: copy.postedByLabel, value: <bdi>{shown.postedBy}</bdi> },
        ]}
      />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-secondary">
          {copy.claimsTitle}
        </h3>
        {full.error ? (
          <p role="alert" className="inline-error">
            {full.error.message}
          </p>
        ) : !full.data ? (
          <div className="cv-skeleton h-16 rounded-xl bg-secondary" />
        ) : full.data.claims.length === 0 ? (
          <p className="text-sm text-tertiary">{copy.noClaims}</p>
        ) : (
          <ul className="perf-krs" aria-label={copy.claimsTitle}>
            {full.data.claims.map((c) => (
              <li key={c.id} className="perf-kr">
                <strong dir="auto">
                  {c.mine ? text.common.you : c.employeeName}
                </strong>
                <span className="recruit-muted">
                  {copy.claimStatus2[c.status]} · {dateTime(c.createdAt)}
                </span>
                <ClaimButtons claim={c} ask={ask} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ClaimsToDecide({ ask }: { ask: (next: Acting) => void }) {
  const [page, setPage] = useState(1);
  const list = useShfClaims(
    true,
    `view=approvals&status=pending&page=${page}&limit=10`,
  );
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const c = copy.claimColumns;
  const columns: Column<ShfClaim>[] = [
    {
      id: "date",
      label: c.date,
      isRowHeader: true,
      sortValue: (x) => x.workDate,
      render: (x) => <strong className="text-sm">{dayLong(x.workDate)}</strong>,
    },
    {
      id: "shift",
      label: c.shift,
      render: (x) => <span className="text-sm">{x.templateCode}</span>,
    },
    {
      id: "person",
      label: c.person,
      render: (x) => (
        <span className="text-sm" dir="auto">
          {x.employeeName}
        </span>
      ),
    },
    {
      id: "status",
      label: c.status,
      render: (x) => (
        <StatusPill
          label={copy.claimStatus2[x.status]}
          color={claimColor[x.status] ?? "gray"}
        />
      ),
    },
    {
      id: "actions",
      label: c.actions,
      render: (x) => <ClaimButtons claim={x} ask={ask} />,
    },
  ];
  return (
    <section className="hd-section" aria-label={copy.approvalsTitle}>
      <h2 className="hd-h2">{copy.approvalsTitle}</h2>
      <p className="recruit-muted">{copy.approvalsIntro}</p>
      <CollectionView
        id="shf-claims"
        label={copy.approvalsTitle}
        noun="claims"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(x) => x.id}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={Hand}
        emptyTitle={copy.approvalsEmpty}
        renderCard={(x) => (
          <div className="flex min-w-0 flex-col gap-2">
            <strong className="text-primary">{dayLong(x.workDate)}</strong>
            <span className="text-sm" dir="auto">
              {x.employeeName} · {x.templateCode}
            </span>
            <ClaimButtons claim={x} ask={ask} />
          </div>
        )}
      />
    </section>
  );
}

function PostFields({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { send, busy, error } = useShfSend();
  const templates = useShfTemplates(true, "active=true&limit=100");
  const active = templates.data?.items ?? [];
  const today = todayIso();
  const [templateId, setTemplateId] = useState("");
  const [workDate, setWorkDate] = useState("");
  const ready = templateId !== "" && workDate !== "";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const done = await send("open", { templateId, workDate });
    if (done !== null) {
      onDone();
      onClose();
    }
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.postIntro}</p>
      <Select
        label={copy.template}
        placeholder={text.assign.templatePlaceholder}
        selectedKey={templateId || null}
        onSelectionChange={(key) => key && setTemplateId(String(key))}
      >
        {active.map((t) => (
          <Select.Item
            key={t.id}
            id={t.id}
            label={`${t.name} · ${t.code} · ${t.startTime}–${t.endTime}`}
          />
        ))}
      </Select>
      <RangeInput
        type="date"
        label={copy.date}
        value={workDate}
        onChange={setWorkDate}
        min={today}
        max={addDays(today, 364)}
        isRequired
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={copy.postSubmit}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}
