import { useState } from "react";
import { ArrowsLeftRight } from "@phosphor-icons/react/dist/csr/ArrowsLeftRight";
import { Button, CollectionView, ErrorState, type Column } from "@anvi/ui";
import type { ShfSwap } from "@anvi/contracts";
import { useShfSwaps } from "../../lib/shifts-api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import { useWorkspace } from "../../routes/workspace";
import {
  ConfirmDialog,
  FilterSelect,
  StatusPill,
  dayLong,
  swapColor,
  useShfSend,
} from "./shared";

const copy = text.swaps;
type Step = "accept" | "decline" | "cancel" | "approve" | "reject";
type Acting = { step: Step; swap: ShfSwap };

const dialogs: Record<
  Step,
  {
    title: string;
    body: string;
    submit: string;
    label?: string;
    reason: boolean;
  }
> = {
  accept: {
    title: copy.acceptTitle,
    body: copy.acceptBody,
    submit: copy.acceptSubmit,
    reason: false,
  },
  decline: {
    title: copy.declineTitle,
    body: copy.declineBody,
    submit: copy.declineSubmit,
    reason: false,
  },
  cancel: {
    title: copy.cancelTitle,
    body: copy.cancelBody,
    submit: copy.cancelSubmit,
    reason: false,
  },
  approve: {
    title: copy.approveTitle,
    body: copy.approveBody,
    submit: copy.approveSubmit,
    reason: false,
  },
  reject: {
    title: copy.rejectTitle,
    body: copy.rejectBody,
    submit: copy.rejectSubmit,
    label: copy.rejectReason,
    reason: true,
  },
};

function StatusCell({ swap }: { swap: ShfSwap }) {
  const label =
    swap.expired && (swap.status === "proposed" || swap.status === "accepted")
      ? copy.expired
      : copy.status[swap.status];
  return (
    <StatusPill
      label={label}
      color={swap.expired ? "gray" : (swapColor[swap.status] ?? "gray")}
    />
  );
}

function Sides({ swap }: { swap: ShfSwap }) {
  const { me } = useWorkspace();
  const side = (s: ShfSwap["requester"]) => (
    <span className="shf-swapside" dir="auto">
      <strong>
        {s.employeeId === me.employeeId ? text.common.you : s.employeeName}
      </strong>
      {": "}
      {copy.sideLine(s.templateName, s.startTime, s.endTime)}
    </span>
  );
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {side(swap.requester)}
      {side(swap.colleague)}
    </span>
  );
}

function Actions({
  swap,
  ask,
}: {
  swap: ShfSwap;
  ask: (step: Step, swap: ShfSwap) => void;
}) {
  const { me } = useWorkspace();
  const party =
    swap.requester.employeeId === me.employeeId ||
    swap.colleague.employeeId === me.employeeId;
  const named = `${dayLong(swap.workDate)}`;
  const buttons: [boolean, Step, string, "primary" | "secondary"][] = [
    [swap.canAccept, "accept", copy.accept, "primary"],
    [swap.canDecline, "decline", copy.decline, "secondary"],
    [swap.canCancel, "cancel", copy.cancel, "secondary"],
    [swap.canApprove, "approve", copy.approve, "primary"],
    [swap.canReject, "reject", copy.reject, "secondary"],
  ];
  return (
    <span className="flex min-w-0 flex-col gap-2">
      <span className="flex flex-wrap gap-2">
        {buttons
          .filter(([can]) => can)
          .map(([, step, label, variant]) => (
            <Button
              key={step}
              variant={variant}
              aria-label={`${label}: ${named}`}
              onPress={() => ask(step, swap)}
            >
              {label}
            </Button>
          ))}
      </span>
      {party && swap.status === "accepted" && !swap.expired && (
        <span className="recruit-muted" role="note">
          {copy.fourEyes}
        </span>
      )}
      {swap.decisionReason && (
        <span className="recruit-muted" dir="auto">
          {copy.decision}: {swap.decisionReason}
        </span>
      )}
      {swap.decidedBy && (
        <span className="recruit-muted" dir="auto">
          {copy.decidedBy(swap.decidedBy)}
        </span>
      )}
    </span>
  );
}

function SwapList({
  mode,
  ask,
}: {
  mode: "mine" | "approvals";
  ask: (step: Step, swap: ShfSwap) => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const query = new URLSearchParams({
    view: mode,
    page: String(page),
    limit: "10",
  });
  if (status !== "all") query.set("status", status);
  else if (mode === "approvals") query.set("status", "accepted");
  const list = useShfSwaps(true, query.toString());
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const columns: Column<ShfSwap>[] = [
    {
      id: "date",
      label: copy.columns.date,
      isRowHeader: true,
      sortValue: (s) => s.workDate,
      render: (s) => <strong className="text-sm">{dayLong(s.workDate)}</strong>,
    },
    { id: "swap", label: copy.columns.swap, render: (s) => <Sides swap={s} /> },
    {
      id: "status",
      label: copy.columns.status,
      render: (s) => <StatusCell swap={s} />,
    },
    {
      id: "actions",
      label: copy.columns.actions,
      render: (s) => <Actions swap={s} ask={ask} />,
    },
  ];
  const approvals = mode === "approvals";
  return (
    <>
      <div className="recruit-filters">
        <FilterSelect
          label={copy.filterStatus}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          allLabel={approvals ? copy.status.accepted : copy.allStatuses}
          options={Object.entries(copy.status)
            .filter(([id]) => !approvals || id !== "accepted")
            .map(([id, label]) => ({ id, label }))}
        />
      </div>
      <CollectionView
        id={`shf-swaps-${mode}`}
        label={approvals ? copy.approvalsTitle : copy.mineTitle}
        noun="swaps"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(s) => s.id}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={ArrowsLeftRight}
        emptyTitle={approvals ? copy.emptyApprovals : copy.empty}
        emptyDescription={approvals ? undefined : copy.emptyBody}
        renderCard={(s) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="text-primary">{dayLong(s.workDate)}</strong>
              <StatusCell swap={s} />
            </div>
            <Sides swap={s} />
            <Actions swap={s} ask={ask} />
          </div>
        )}
      />
    </>
  );
}

export function SwapsTab({ self, decide }: { self: boolean; decide: boolean }) {
  const { attempt } = useShfSend();
  const [acting, setActing] = useState<Acting | null>(null);
  const d = acting ? dialogs[acting.step] : null;
  const ask = (step: Step, swap: ShfSwap) => setActing({ step, swap });
  return (
    <div className="perf-tab hd-tab shf-tab">
      <p className="recruit-muted">{copy.intro}</p>
      {self && (
        <section className="hd-section" aria-label={copy.mineTitle}>
          <h2 className="hd-h2">{copy.mineTitle}</h2>
          <SwapList mode="mine" ask={ask} />
        </section>
      )}
      {decide && (
        <section className="hd-section" aria-label={copy.approvalsTitle}>
          <h2 className="hd-h2">{copy.approvalsTitle}</h2>
          <p className="recruit-muted">{copy.approvalsIntro}</p>
          <SwapList mode="approvals" ask={ask} />
        </section>
      )}
      {acting && d && (
        <ConfirmDialog
          open
          title={d.title}
          body={d.body}
          label={d.label}
          submit={d.submit}
          cancel={copy.keep}
          needsReason={d.reason}
          onClose={() => setActing(null)}
          onSubmit={async (reason) => {
            return attempt(`swaps/${acting.swap.id}/${acting.step}`, {
              version: acting.swap.version,
              ...(reason ? { reason } : {}),
            });
          }}
        />
      )}
    </div>
  );
}
