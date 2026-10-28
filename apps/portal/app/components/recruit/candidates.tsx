import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { UserCircle } from "@phosphor-icons/react/dist/csr/UserCircle";
import {
  Avatar,
  Button,
  Checkbox,
  CollectionView,
  DetailFields,
  ErrorState,
  Input,
  RangeInput,
  Select,
  StatusBadge,
  TextArea,
  type CollectionDetail,
  type Column,
} from "@anvi/ui";
import type { RecruitCandidate } from "@anvi/contracts";
import {
  useRecruitCandidateReveal,
  useRecruitCandidates,
  useRecruitRequisitions,
} from "../../lib/api";
import { recruitmentCopy as text } from "../../lib/copy/recruitment";
import {
  FormActions,
  FormError,
  ListFilters,
  Modal,
  NoteDialog,
  PersonPicker,
  SelectField,
  dateOnly,
  useDebounced,
  useRecruitSend,
  type Person,
} from "./shared";

const copy = text.candidates;
const sources = Object.keys(copy.sources) as Array<keyof typeof copy.sources>;

type Acting =
  | { kind: "new" }
  | {
      kind: "apply" | "extend" | "withdraw" | "anonymise";
      item: RecruitCandidate;
    };

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

function consent(item: RecruitCandidate) {
  if (item.anonymised)
    return (
      <StatusBadge color="gray" size="sm" type="pill-color">
        {copy.consent.anonymised}
      </StatusBadge>
    );
  if (item.consentWithdrawnAt)
    return (
      <StatusBadge color="warning" size="sm" type="pill-color">
        {copy.consent.withdrawn}
      </StatusBadge>
    );
  return (
    <StatusBadge color="success" size="sm" type="pill-color">
      {copy.consent.given}
    </StatusBadge>
  );
}

const columns: Column<RecruitCandidate>[] = [
  {
    id: "name",
    label: copy.columns.name,
    isRowHeader: true,
    sortValue: (item) => item.name,
    render: (item) => (
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm text-primary">{item.name}</strong>
        <span className="text-sm text-tertiary">
          {item.email ?? copy.masked}
        </span>
      </span>
    ),
  },
  {
    id: "company",
    label: copy.columns.company,
    render: (item) => (
      <span className="text-sm">{item.currentCompany ?? text.common.none}</span>
    ),
  },
  {
    id: "experience",
    label: copy.columns.experience,
    sortValue: (item) => item.totalExperienceMonths,
    render: (item) => (
      <span className="text-sm">
        {text.common.months(item.totalExperienceMonths)}
      </span>
    ),
  },
  {
    id: "source",
    label: copy.columns.source,
    render: (item) => (
      <span className="text-sm">{copy.sources[item.source]}</span>
    ),
  },
  {
    id: "consent",
    label: copy.columns.consent,
    render: consent,
  },
  {
    id: "applications",
    label: copy.columns.applications,
    sortValue: (item) => item.applicationCount,
    render: (item) => <span className="text-sm">{item.applicationCount}</span>,
  },
];

export function CandidatesTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const q = useDebounced(search.trim());
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (source !== "all") query.set("source", source);
  const list = useRecruitCandidates(true, query.toString());
  const [acting, setActing] = useState<Acting | null>(null);
  const { send } = useRecruitSend();
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );

  const detail: CollectionDetail<RecruitCandidate> = {
    title: (item) => item.name,
    subtitle: (item) => (
      <span className="flex flex-wrap items-center gap-2">
        {copy.sources[item.source]}
        {consent(item)}
      </span>
    ),
    body: (item) => <CandidateDetail item={item} />,
    footer: (item, close) => (
      <>
        {!item.anonymised && !item.consentWithdrawnAt && (
          <Button
            onPress={() => {
              close();
              setActing({ kind: "apply", item });
            }}
          >
            {copy.actions.apply}
          </Button>
        )}
        {item.canExtendRetention && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "extend", item });
            }}
          >
            {copy.actions.extend}
          </Button>
        )}
        {item.canWithdrawConsent && (
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
        {item.canAnonymise && (
          <Button
            variant="secondary"
            onPress={() => {
              close();
              setActing({ kind: "anonymise", item });
            }}
          >
            {copy.actions.anonymise}
          </Button>
        )}
      </>
    ),
  };

  return (
    <div className="recruit-tab">
      <div className="recruit-toolbar">
        <ListFilters
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
          status={source}
          onStatus={(value) => {
            setSource(value);
            setPage(1);
          }}
          statuses={sources}
          labels={copy.sources}
        />
        <Button onPress={() => setActing({ kind: "new" })}>
          <Plus size={18} />
          {copy.add}
        </Button>
      </div>
      <CollectionView
        id="recruit-candidates"
        label={text.tabs.candidates}
        noun="candidates"
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
        emptyIcon={UserCircle}
        emptyTitle={copy.empty}
        emptyDescription={copy.emptyBody}
        onClearFilters={
          search || source !== "all"
            ? () => {
                setSearch("");
                setSource("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(item) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-3">
              <Avatar initials={initials(item.name)} />
              <span className="flex min-w-0 flex-col">
                <strong className="break-words text-primary">
                  {item.name}
                </strong>
                <span className="break-all text-sm text-tertiary">
                  {item.email ?? copy.masked}
                </span>
              </span>
            </div>
            <span className="text-sm text-secondary">
              {item.currentCompany ?? text.common.none} ·{" "}
              {text.common.months(item.totalExperienceMonths)}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-tertiary">
              {copy.sources[item.source]}
              {consent(item)}
              {item.purgeEligible && (
                <StatusBadge color="warning" size="sm" type="pill-color">
                  {copy.eligible}
                </StatusBadge>
              )}
            </span>
          </div>
        )}
        detail={detail}
      />
      <NewCandidate
        open={acting?.kind === "new"}
        onClose={() => setActing(null)}
      />
      {acting?.kind === "apply" && (
        <ApplyDialog item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "extend" && (
        <ExtendDialog item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "withdraw" && (
        <NoteDialog
          open
          title={copy.withdraw.title}
          body={copy.withdraw.body}
          label={copy.withdraw.label}
          submit={copy.withdraw.submit}
          required
          minLength={10}
          onClose={() => setActing(null)}
          onSubmit={async (reason) =>
            (await send(`candidates/${acting.item.id}/withdraw-consent`, {
              version: acting.item.version,
              reason,
            })) !== null
          }
        />
      )}
      {acting?.kind === "anonymise" && (
        <NoteDialog
          open
          title={copy.anonymise.title}
          body={copy.anonymise.body}
          label={copy.anonymise.label}
          submit={copy.anonymise.submit}
          confirm={copy.anonymise.confirm}
          required
          minLength={10}
          onClose={() => setActing(null)}
          onSubmit={async (reason) =>
            (await send(`candidates/${acting.item.id}/anonymise`, {
              reason,
            })) !== null
          }
        />
      )}
    </div>
  );
}

// Contact details stay masked until HR asks; asking is an audited read.
function CandidateDetail({ item }: { item: RecruitCandidate }) {
  const [revealing, setRevealing] = useState(false);
  const full = useRecruitCandidateReveal(revealing ? item.id : null);
  const shown = full.data;
  return (
    <div className="flex flex-col gap-5">
      {item.anonymised ? (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-tertiary">
          {copy.detail.anonymisedNote}
        </p>
      ) : (
        <section
          className="flex flex-col gap-2"
          aria-label={copy.detail.contact}
        >
          <DetailFields
            title={copy.detail.contact}
            fields={[
              { label: copy.detail.email, value: shown?.email ?? item.email },
              { label: copy.detail.phone, value: shown?.phone ?? item.phone },
            ]}
          />
          {shown ? (
            <>
              <p role="status" className="text-sm text-tertiary">
                {copy.detail.revealed}
              </p>
              <Button
                variant="secondary"
                className="self-start"
                onPress={() => setRevealing(false)}
              >
                <EyeSlash size={16} />
                {copy.detail.hide}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-tertiary">{copy.detail.maskedNote}</p>
              {full.error && <FormError message={full.error.message} />}
              <Button
                variant="secondary"
                className="self-start"
                isDisabled={revealing}
                onPress={() => setRevealing(true)}
              >
                <Eye size={16} />
                {revealing ? copy.detail.revealing : copy.detail.reveal}
              </Button>
            </>
          )}
        </section>
      )}
      <DetailFields
        title={copy.detail.about}
        fields={[
          { label: copy.detail.company, value: item.currentCompany },
          {
            label: copy.detail.experience,
            value: text.common.months(item.totalExperienceMonths),
          },
          { label: copy.detail.source, value: copy.sources[item.source] },
          { label: copy.detail.notes, value: item.notes },
          { label: copy.detail.applications, value: item.applicationCount },
        ]}
      />
      <DetailFields
        title={copy.detail.privacy}
        fields={[
          {
            label: copy.detail.consentAt,
            value: item.consentRecordedAt
              ? dateOnly(item.consentRecordedAt)
              : null,
          },
          {
            label: copy.detail.retentionUntil,
            value: item.retentionUntil ? dateOnly(item.retentionUntil) : null,
          },
          {
            label: copy.detail.withdrawnAt,
            value: item.consentWithdrawnAt
              ? dateOnly(item.consentWithdrawnAt)
              : null,
          },
        ]}
      />
    </div>
  );
}

function NewCandidate({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={copy.addTitle} onClose={onClose}>
      {open && <NewCandidateForm onClose={onClose} />}
    </Modal>
  );
}

function NewCandidateForm({ onClose }: { onClose: () => void }) {
  const { send, busy, error } = useRecruitSend();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [years, setYears] = useState("0");
  const [source, setSource] = useState<keyof typeof copy.sources | "">(
    "direct",
  );
  const [referrer, setReferrer] = useState<Person[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [retention, setRetention] = useState("");
  const [notes, setNotes] = useState("");
  const months = Math.round(Number(years) * 12);
  const ready =
    name.trim() &&
    email.includes("@") &&
    source &&
    agreed &&
    Number.isFinite(months) &&
    months >= 0 &&
    (source !== "referral" || referrer.length === 1);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !source) return;
    const done = await send("candidates", {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      currentCompany: company.trim() || null,
      totalExperienceMonths: months,
      source,
      referrerEmployeeId: source === "referral" ? referrer[0]!.id : null,
      consentGiven: agreed,
      retentionUntil: retention || null,
      notes: notes.trim() || null,
    });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.addBody}</p>
      <Input
        label={copy.fields.name}
        value={name}
        onChange={setName}
        maxLength={120}
        isRequired
        hideRequiredIndicator
        autoFocus
      />
      <div className="leave-dates">
        <Input
          label={copy.fields.email}
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={254}
          autoComplete="off"
          isRequired
          hideRequiredIndicator
        />
        <Input
          label={copy.fields.phone}
          type="tel"
          value={phone}
          onChange={setPhone}
          maxLength={20}
          autoComplete="off"
        />
      </div>
      <div className="leave-dates">
        <Input
          label={copy.fields.company}
          value={company}
          onChange={setCompany}
          maxLength={120}
        />
        <RangeInput
          label={copy.fields.years}
          type="number"
          min={0}
          max={60}
          step={0.5}
          value={years}
          onChange={setYears}
        />
      </div>
      <SelectField
        label={copy.fields.source}
        value={source}
        onChange={setSource}
        options={sources}
        labels={copy.sources}
      />
      {source === "referral" && (
        <PersonPicker
          label={copy.fields.referrer}
          selected={referrer}
          onChange={setReferrer}
        />
      )}
      <RangeInput
        type="date"
        label={copy.fields.retention}
        value={retention}
        onChange={setRetention}
      />
      <TextArea
        label={copy.fields.notes}
        value={notes}
        onChange={setNotes}
        maxLength={1000}
      />
      <Checkbox
        isSelected={agreed}
        onChange={setAgreed}
        label={copy.fields.consent}
      />
      <FormError message={error} />
      <FormActions
        busy={busy}
        submit={copy.add}
        onCancel={onClose}
        disabled={!ready}
      />
    </form>
  );
}

function ApplyDialog({
  item,
  onClose,
}: {
  item: RecruitCandidate;
  onClose: () => void;
}) {
  const open = useRecruitRequisitions(true, "status=open&limit=100");
  const { send, busy, error } = useRecruitSend();
  const [requisitionId, setRequisitionId] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!requisitionId) return;
    const done = await send("applications", {
      candidateId: item.id,
      requisitionId,
    });
    if (done !== null) onClose();
  }
  const rows = open.data?.items ?? [];
  return (
    <Modal open title={copy.apply.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.apply.body(item.name)}</p>
        {open.data && rows.length === 0 ? (
          <p>{copy.apply.none}</p>
        ) : (
          <Select
            label={copy.apply.requisition}
            selectedKey={requisitionId || null}
            onSelectionChange={(key) => key && setRequisitionId(String(key))}
            isDisabled={!open.data}
          >
            {rows.map((row) => (
              <Select.Item
                key={row.id}
                id={row.id}
                label={`${row.code} ${row.title}`}
              />
            ))}
          </Select>
        )}
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.apply.submit}
          onCancel={onClose}
          disabled={!requisitionId}
        />
      </form>
    </Modal>
  );
}

function ExtendDialog({
  item,
  onClose,
}: {
  item: RecruitCandidate;
  onClose: () => void;
}) {
  const { send, busy, error } = useRecruitSend();
  const [until, setUntil] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!until) return;
    const done = await send(`candidates/${item.id}/extend-retention`, {
      version: item.version,
      retentionUntil: until,
    });
    if (done !== null) onClose();
  }
  return (
    <Modal open title={copy.extend.title} onClose={onClose}>
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <p>{copy.extend.body}</p>
        <RangeInput
          type="date"
          label={copy.extend.label}
          value={until}
          onChange={setUntil}
          isRequired
        />
        <FormError message={error} />
        <FormActions
          busy={busy}
          submit={copy.extend.submit}
          onCancel={onClose}
          disabled={!until}
        />
      </form>
    </Modal>
  );
}
