import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Handshake } from "@phosphor-icons/react/dist/csr/Handshake";
import {
  Button,
  Checkbox,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  RangeInput,
  Select,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import { recruitOfferAcceptedSchema, type RecruitOffer } from "@anvi/contracts";
import { useRecruitApplications, useRecruitOffers } from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  StatusPill,
  dateOnly,
  offerColor,
  todayIso,
  useDebounced,
  useRecruitSend,
} from "./shared";

const copy = text.offers;
const statuses = Object.keys(copy.status);

type Acting =
  | { kind: "accept" | "decline" | "withdraw"; item: RecruitOffer }
  | { kind: "new" };

const pill = (item: RecruitOffer) => (
  <StatusPill
    label={copy.status[item.status]}
    color={offerColor[item.status] ?? "gray"}
  />
);

const columns: Column<RecruitOffer>[] = [
  {
    id: "candidate",
    label: copy.columns.candidate,
    isRowHeader: true,
    sortValue: (item) => item.candidateName,
    render: (item) => (
      <strong className="text-sm text-primary">{item.candidateName}</strong>
    ),
  },
  {
    id: "role",
    label: copy.columns.role,
    render: (item) => <span className="text-sm">{item.title}</span>,
  },
  {
    id: "joining",
    label: copy.columns.joining,
    sortValue: (item) => item.proposedJoiningDate,
    render: (item) => (
      <span className="text-sm">{dateOnly(item.proposedJoiningDate)}</span>
    ),
  },
  {
    id: "manager",
    label: copy.columns.manager,
    render: (item) => <span className="text-sm">{item.managerName}</span>,
  },
  {
    id: "status",
    label: copy.columns.status,
    sortValue: (item) => item.status,
    render: pill,
  },
];

export function OffersTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("status", status);
  const list = useRecruitOffers(true, query.toString());
  const [acting, setActing] = useState<Acting | null>(null);
  const [notice, setNotice] = useState("");
  const { send, busy, error } = useRecruitSend();
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  const step = (item: RecruitOffer, name: "submit" | "approve" | "send") =>
    send(`offers/${item.id}/${name}`, { version: item.version });

  const detail: CollectionDetail<RecruitOffer> = {
    title: (item) => item.candidateName,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {item.title}
        {pill(item)}
      </span>
    ),
    body: (item) => (
      <div className="flex flex-col gap-5">
        {(item.status === "draft" || item.status === "pending_approval") && (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
            {copy.detail.fourEyes}
          </p>
        )}
        <DetailFields
          fields={[
            { label: copy.detail.candidate, value: item.candidateName },
            { label: copy.detail.role, value: item.title },
            {
              label: copy.detail.joining,
              value: dateOnly(item.proposedJoiningDate),
            },
            { label: copy.detail.manager, value: item.managerName },
            { label: copy.detail.status, value: copy.status[item.status] },
            { label: copy.detail.note, value: item.statusNote },
            { label: copy.detail.createdBy, value: item.createdBy },
            { label: copy.detail.approvedBy, value: item.approvedBy },
            {
              label: copy.detail.sentAt,
              value: item.sentAt ? dateOnly(item.sentAt) : null,
            },
            {
              label: copy.detail.respondedOn,
              value: item.respondedOn ? dateOnly(item.respondedOn) : null,
            },
          ]}
        />
        {item.candidateCaseId && (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
            {copy.detail.preboardingCreated}
          </p>
        )}
        <p className="text-sm text-tertiary">{copy.sentNote}</p>
        <FormError message={error} />
      </div>
    ),
    footer: (item, close) => (
      <>
        {item.canWithdraw && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "withdraw", item });
            }}
          >
            {copy.actions.withdraw}
          </Button>
        )}
        {item.canRecordResponse && (
          <>
            <Button
              variant="secondary"
              onPress={() => {
                close();
                setActing({ kind: "decline", item });
              }}
            >
              {copy.actions.decline}
            </Button>
            <Button
              onPress={() => {
                close();
                setActing({ kind: "accept", item });
              }}
            >
              {copy.actions.accept}
            </Button>
          </>
        )}
        {item.canSubmit && (
          <Button isDisabled={busy} onPress={() => void step(item, "submit")}>
            {copy.actions.submit}
          </Button>
        )}
        {item.canApprove && (
          <Button isDisabled={busy} onPress={() => void step(item, "approve")}>
            {copy.actions.approve}
          </Button>
        )}
        {item.canSend && (
          <Button isDisabled={busy} onPress={() => void step(item, "send")}>
            {copy.actions.send}
          </Button>
        )}
      </>
    ),
  };

  return (
    <div className="recruit-tab">
      {notice && (
        <p role="status" className="recruit-notice">
          {notice}
        </p>
      )}
      <div className="recruit-toolbar">
        <ListFilters
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          status={status}
          onStatus={(value) => {
            setStatus(value);
            setPage(1);
          }}
          statuses={statuses}
          labels={copy.status}
        />
        <Button onPress={() => setActing({ kind: "new" })}>
          <Plus size={18} />
          {copy.create}
        </Button>
      </div>
      <CollectionView
        id="recruit-offers"
        label={text.tabs.offers}
        noun="offers"
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
        emptyIcon={Handshake}
        emptyTitle={copy.empty}
        emptyDescription={copy.emptyBody}
        onClearFilters={
          search || status !== "all"
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
                {item.candidateName}
              </strong>
              {pill(item)}
            </div>
            <span className="text-sm text-secondary">{item.title}</span>
            <span className="text-sm text-tertiary">
              {copy.detail.joining}: {dateOnly(item.proposedJoiningDate)}
            </span>
            <span className="text-sm text-tertiary">
              {copy.detail.manager}: {item.managerName}
            </span>
          </div>
        )}
        detail={detail}
      />
      <OfferCreateDialog
        open={acting?.kind === "new"}
        onClose={() => setActing(null)}
      />
      {acting?.kind === "accept" && (
        <AcceptDialog
          item={acting.item}
          onClose={() => setActing(null)}
          onDone={() => setNotice(copy.detail.preboardingCreated)}
        />
      )}
      {acting?.kind === "decline" && (
        <DeclineDialog item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "withdraw" && (
        <NoteDialog
          open
          title={copy.withdraw.title}
          body={copy.withdraw.body}
          label={copy.withdraw.label}
          submit={copy.withdraw.submit}
          required
          onClose={() => setActing(null)}
          onSubmit={async (note) =>
            (await send(`offers/${acting.item.id}/withdraw`, {
              version: acting.item.version,
              note,
            })) !== null
          }
        />
      )}
    </div>
  );
}

// Create an offer for an application. From the pipeline the application is already chosen.
export function OfferCreateDialog({
  open,
  applicationId,
  onClose,
}: {
  open: boolean;
  applicationId?: string;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={copy.createTitle} onClose={onClose}>
      {open && (
        <OfferCreateForm applicationId={applicationId} onClose={onClose} />
      )}
    </Modal>
  );
}

function OfferCreateForm({
  applicationId,
  onClose,
}: {
  applicationId?: string;
  onClose: () => void;
}) {
  const apps = useRecruitApplications(true, "limit=100");
  const { send, busy, error } = useRecruitSend();
  const [chosen, setChosen] = useState(applicationId ?? "");
  const [joining, setJoining] = useState("");
  const ready = apps.data?.items.filter((a) => a.canMakeOffer) ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen || !joining) return;
    const done = await send("offers", {
      applicationId: chosen,
      proposedJoiningDate: joining,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.createBody}</p>
      {apps.data && ready.length === 0 ? (
        <p>{copy.noApplications}</p>
      ) : (
        <Select
          label={copy.application}
          selectedKey={chosen || null}
          onSelectionChange={(key) => key && setChosen(String(key))}
          isDisabled={!apps.data}
        >
          {ready.map((a) => (
            <Select.Item
              key={a.id}
              id={a.id}
              label={`${a.candidateName} · ${a.requisitionCode} ${a.requisitionTitle}`}
            />
          ))}
        </Select>
      )}
      <RangeInput
        type="date"
        label={copy.joiningDate}
        value={joining}
        onChange={setJoining}
        min={todayIso()}
        isRequired
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={copy.create}
        onCancel={onClose}
        disabled={!chosen || !joining}
      />
    </form>
  );
}

function AcceptDialog({
  item,
  onClose,
  onDone,
}: {
  item: RecruitOffer;
  onClose: () => void;
  onDone: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  const [date, setDate] = useState(todayIso());
  const [email, setEmail] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await send(
      `offers/${item.id}/accept`,
      {
        version: item.version,
        respondedOn: date,
        preboardingEmail: email.trim(),
      },
      recruitOfferAcceptedSchema,
    );
    if (done) {
      onDone();
      onClose();
    }
  }
  return (
    <Modal open title={copy.accept.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.accept.body}</p>
        <RangeInput
          type="date"
          label={copy.accept.date}
          value={date}
          onChange={setDate}
          isRequired
        />
        <Input
          label={copy.accept.email}
          hint={copy.accept.emailHint}
          type="email"
          placeholder="name@anvi.example"
          value={email}
          onChange={setEmail}
          maxLength={254}
          autoComplete="off"
          isRequired
          hideRequiredIndicator
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.accept.submit}
          onCancel={onClose}
          disabled={!date || !email.includes("@")}
        />
      </form>
    </Modal>
  );
}

function DeclineDialog({
  item,
  onClose,
}: {
  item: RecruitOffer;
  onClose: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  const [date, setDate] = useState(todayIso());
  const [expired, setExpired] = useState(false);
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await send(`offers/${item.id}/decline`, {
      version: item.version,
      respondedOn: date,
      expired,
      ...(note.trim().length >= 3 ? { note: note.trim() } : {}),
    });
    if (done !== null) onClose();
  }
  return (
    <Modal open title={copy.decline.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.decline.body}</p>
        <RangeInput
          type="date"
          label={copy.decline.date}
          value={date}
          onChange={setDate}
          isRequired
        />
        <Checkbox
          isSelected={expired}
          onChange={setExpired}
          label={copy.decline.expired}
        />
        <Input
          label={copy.decline.note}
          value={note}
          onChange={setNote}
          maxLength={500}
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.decline.submit}
          onCancel={onClose}
          disabled={!date}
        />
      </form>
    </Modal>
  );
}
