import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import {
  Button,
  Checkbox,
  CollectionView,
  ErrorState,
  Input,
  RangeInput,
  type Column,
} from "@anvi/ui";
import {
  shfColourSchema,
  type ShfSettings,
  type ShfTemplate,
} from "@anvi/contracts";
import { useShfSettings, useShfTemplates } from "../../lib/shifts-api";
import { shiftsCopy as text } from "../../lib/copy/shifts";
import {
  FilterSelect,
  FormActions,
  FormError,
  Modal,
  SearchBox,
  StatusPill,
  dateTime,
  hoursText,
  useDebounced,
  useShfSend,
} from "./shared";

const copy = text.settings;
const colours = shfColourSchema.options;

export function SettingsTab() {
  return (
    <div className="hd-settings">
      <RestSection />
      <TemplatesSection />
    </div>
  );
}

// ---- Minimum rest ----

function RestSection() {
  const settings = useShfSettings(true);
  if (settings.error)
    return (
      <ErrorState
        message={settings.error.message}
        onRetry={() => void settings.refetch()}
      />
    );
  return (
    <section className="hd-section" aria-label={copy.restTitle}>
      <div>
        <h2 className="hd-h2">{copy.restTitle}</h2>
        <p className="recruit-muted">{copy.restIntro}</p>
      </div>
      {settings.data ? (
        <RestForm
          key={`${settings.data.version}-${settings.data.minRestHours}`}
          settings={settings.data}
        />
      ) : (
        <div className="cv-skeleton h-16 rounded-xl bg-secondary" />
      )}
    </section>
  );
}

function RestForm({ settings }: { settings: ShfSettings }) {
  const { send, busy, error } = useShfSend();
  const [hours, setHours] = useState(String(settings.minRestHours));
  const [saved, setSaved] = useState(false);
  const value = Number(hours);
  const valid = Number.isInteger(value) && value >= 0 && value <= 24;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaved(false);
    const done = await send(
      "settings",
      { minRestHours: value, version: settings.version },
      "PUT",
    );
    if (done !== null) setSaved(true);
  }
  return (
    <form className="leave-form shf-rest" onSubmit={(e) => void submit(e)}>
      <RangeInput
        type="number"
        label={copy.restField}
        hint={copy.restHint}
        value={hours}
        onChange={setHours}
        min={0}
        max={24}
        isRequired
      />
      <p className="recruit-muted">
        {settings.version === 0
          ? copy.restDefault
          : settings.updatedBy && settings.updatedAt
            ? copy.restUpdated(settings.updatedBy, dateTime(settings.updatedAt))
            : ""}
      </p>
      {saved && (
        <p role="status" className="recruit-notice">
          {copy.restSaved}
        </p>
      )}
      <FormError message={error} />
      <div className="leave-actions">
        <Button type="submit" isDisabled={busy || !valid}>
          {busy ? text.common.saving : copy.restSave}
        </Button>
      </div>
    </form>
  );
}

// ---- Templates ----

function TemplatesSection() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const q = useDebounced(search.trim());
  const [editing, setEditing] = useState<ShfTemplate | "new" | null>(null);
  const query = new URLSearchParams({ page: String(page), limit: "10", q });
  if (status !== "all") query.set("active", status);
  const list = useShfTemplates(true, query.toString());
  if (list.error)
    return (
      <ErrorState
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  const edit = (item: ShfTemplate) =>
    item.canEdit ? (
      <Button
        variant="secondary"
        aria-label={`${copy.edit}: ${item.name}`}
        onPress={() => setEditing(item)}
      >
        {copy.edit}
      </Button>
    ) : null;
  const pill = (item: ShfTemplate) => (
    <StatusPill
      label={item.active ? copy.active : copy.inactive}
      color={item.active ? "success" : "gray"}
    />
  );
  const columns: Column<ShfTemplate>[] = [
    {
      id: "template",
      label: copy.columns.template,
      isRowHeader: true,
      sortValue: (t) => t.name,
      render: (t) => (
        <span className="shf-tpl" data-colour={t.colour}>
          <span className="shf-swatch" aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <strong className="text-sm" dir="auto">
              {t.name}
            </strong>
            <span className="text-sm text-tertiary">
              {t.code} · {text.colour[t.colour]}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "time",
      label: copy.columns.time,
      render: (t) => (
        <span className="text-sm">
          {t.startTime}–{t.endTime}
          {t.crossesMidnight ? ` (${copy.crosses})` : ""}
        </span>
      ),
    },
    {
      id: "break",
      label: copy.columns.break,
      render: (t) => (
        <span className="text-sm">
          {t.breakMinutes > 0
            ? text.shift.break(t.breakMinutes)
            : text.shift.noBreak}
        </span>
      ),
    },
    {
      id: "paid",
      label: copy.columns.paid,
      render: (t) => (
        <span className="text-sm">{hoursText(t.paidMinutes)}</span>
      ),
    },
    { id: "status", label: copy.columns.status, render: pill },
    { id: "actions", label: copy.columns.actions, render: edit },
  ];
  const filtered = Boolean(search) || status !== "all";
  return (
    <section className="hd-section" aria-label={copy.templatesTitle}>
      <div className="recruit-toolbar">
        <div>
          <h2 className="hd-h2">{copy.templatesTitle}</h2>
          <p className="recruit-muted">{copy.templatesIntro}</p>
        </div>
        <Button onPress={() => setEditing("new")}>
          <Plus size={18} />
          {copy.add}
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
          label={copy.columns.status}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          allLabel={text.common.all}
          options={[
            { id: "true", label: copy.active },
            { id: "false", label: copy.inactive },
          ]}
        />
      </div>
      <CollectionView
        id="shf-templates"
        label={copy.templatesTitle}
        noun="templates"
        items={list.data?.items ?? []}
        loading={!list.data}
        getKey={(t) => t.id}
        columns={columns}
        server={{
          page,
          limit: list.data?.limit ?? 10,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyIcon={Gear}
        emptyTitle={filtered ? copy.emptyFiltered : copy.empty}
        emptyDescription={filtered ? undefined : copy.emptyBody}
        onClearFilters={
          filtered
            ? () => {
                setSearch("");
                setStatus("all");
                setPage(1);
              }
            : undefined
        }
        renderCard={(t) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="shf-tpl" data-colour={t.colour}>
                <span className="shf-swatch" aria-hidden="true" />
                <strong className="min-w-0 break-words text-primary" dir="auto">
                  {t.name}
                </strong>
              </span>
              {pill(t)}
            </div>
            <span className="text-sm text-tertiary">
              {t.code} · {text.colour[t.colour]} · {t.startTime}–{t.endTime}
              {t.crossesMidnight ? ` (${copy.crosses})` : ""}
            </span>
            <span className="text-sm">
              {hoursText(t.paidMinutes)} ·{" "}
              {t.breakMinutes > 0
                ? text.shift.break(t.breakMinutes)
                : text.shift.noBreak}
            </span>
            {edit(t)}
          </div>
        )}
      />
      <Modal
        open={editing !== null}
        title={editing === "new" ? copy.addTitle : copy.editTitle}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <TemplateFields
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

const toMinutes = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function TemplateFields({
  item,
  onClose,
}: {
  item: ShfTemplate | null;
  onClose: () => void;
}) {
  const { send, busy, error } = useShfSend();
  const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [start, setStart] = useState(item?.startTime ?? "09:00");
  const [end, setEnd] = useState(item?.endTime ?? "17:00");
  const [pause, setPause] = useState(String(item?.breakMinutes ?? 30));
  const [colour, setColour] = useState<(typeof colours)[number]>(
    item?.colour ?? "teal",
  );
  const [active, setActive] = useState(item?.active ?? true);
  const s = toMinutes(start);
  const e = toMinutes(end);
  const crosses = e <= s;
  const length = crosses ? e + 1440 - s : e - s;
  const breakMin = Number(pause);
  const validBreak =
    Number.isInteger(breakMin) &&
    breakMin >= 0 &&
    breakMin <= 180 &&
    breakMin < length;
  const validLength = length >= 15 && length <= 960;
  const ready =
    name.trim().length >= 2 &&
    (item !== null || /^[A-Za-z0-9][A-Za-z0-9-]{1,11}$/.test(code.trim())) &&
    /^\d\d:\d\d$/.test(start) &&
    /^\d\d:\d\d$/.test(end) &&
    validBreak &&
    validLength;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const fields = {
      name: name.trim(),
      startTime: start,
      endTime: end,
      breakMinutes: breakMin,
      colour,
    };
    const done = item
      ? await send(
          `templates/${item.id}`,
          { ...fields, active, version: item.version },
          "PUT",
        )
      : await send("templates", { code: code.trim().toUpperCase(), ...fields });
    if (done !== null) onClose();
  }
  return (
    <form className="leave-form" onSubmit={(ev) => void submit(ev)}>
      {item ? (
        <p>
          <strong>{copy.fields.code}:</strong> {item.code}
        </p>
      ) : (
        <Input
          label={copy.fields.code}
          hint={copy.fields.codeHint}
          value={code}
          onChange={setCode}
          maxLength={12}
          isRequired
          hideRequiredIndicator
          autoFocus
        />
      )}
      <Input
        label={copy.fields.name}
        value={name}
        onChange={setName}
        maxLength={60}
        isRequired
        hideRequiredIndicator
      />
      <div className="leave-dates">
        <RangeInput
          type="time"
          label={copy.fields.start}
          value={start}
          onChange={setStart}
          isRequired
        />
        <RangeInput
          type="time"
          label={copy.fields.end}
          value={end}
          onChange={setEnd}
          isRequired
        />
      </div>
      <RangeInput
        type="number"
        label={copy.fields.break}
        hint={copy.fields.breakHint}
        value={pause}
        onChange={setPause}
        min={0}
        max={180}
        isRequired
      />
      <p className="recruit-muted" role="note">
        {validLength
          ? copy.preview(
              hoursText(Math.max(0, length - (breakMin || 0))),
              crosses,
            )
          : copy.shiftLength}
      </p>
      <fieldset className="shf-colours">
        <legend>{copy.fields.colour}</legend>
        <p className="recruit-muted">{copy.fields.colourHint}</p>
        <div className="shf-colour-list">
          {colours.map((c) => (
            <label
              key={c}
              className="shf-colour"
              data-colour={c}
              data-selected={colour === c ? "" : undefined}
            >
              <input
                type="radio"
                name="shf-colour"
                value={c}
                checked={colour === c}
                onChange={() => setColour(c)}
              />
              <span className="shf-swatch" aria-hidden="true" />
              <span>{text.colour[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {item && (
        <Checkbox
          isSelected={active}
          onChange={setActive}
          label={copy.fields.active}
        />
      )}
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
