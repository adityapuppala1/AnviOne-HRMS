import { useState, type FormEvent } from "react";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import {
  Button,
  Checkbox,
  EmptyBlock,
  ErrorState,
  Input,
  RangeInput,
} from "@anvi/ui";
import { HandHeart } from "@phosphor-icons/react/dist/csr/HandHeart";
import type { EngValue } from "@anvi/contracts";
import { useEngValues } from "../../lib/api";
import { engageCopy as text } from "../../lib/copy/engage";
import { KudosList } from "./feed";
import {
  FormActions,
  FormError,
  Modal,
  StatusPill,
  useEngSend,
} from "./shared";

const copy = text.manage;

export function ManageTab() {
  return (
    <div className="eng-tab perf-tab eng-manage">
      <ValuesSection />
      <section className="eng-section" aria-labelledby="eng-hidden-h">
        <h2 className="hd-h2" id="eng-hidden-h">
          {copy.hiddenHeading}
        </h2>
        <p className="recruit-muted">{copy.hiddenIntro}</p>
        <KudosList
          view="hidden"
          emptyTitle={copy.hiddenEmpty}
          emptyBody={copy.hiddenEmptyBody}
        />
      </section>
    </div>
  );
}

function ValuesSection() {
  const values = useEngValues(true);
  const [editing, setEditing] = useState<EngValue | "new" | null>(null);
  if (values.error)
    return (
      <ErrorState
        message={values.error.message}
        onRetry={() => void values.refetch()}
      />
    );
  const items = values.data?.items ?? [];
  return (
    <section className="eng-section" aria-labelledby="eng-values-h">
      <h2 className="hd-h2" id="eng-values-h">
        {copy.valuesHeading}
      </h2>
      <p className="recruit-muted">{copy.valuesIntro}</p>
      <div>
        <Button onPress={() => setEditing("new")}>
          <Plus size={18} aria-hidden />
          {copy.addValue}
        </Button>
      </div>
      {values.data && items.length === 0 ? (
        <EmptyBlock icon={HandHeart} title={copy.addValue} />
      ) : (
        <ul className="eng-values">
          {items.map((value) => (
            <li key={value.id}>
              <strong>{value.name}</strong>
              <StatusPill
                label={value.active ? copy.active : copy.retired}
                color={value.active ? "success" : "gray"}
              />
              <Button
                variant="ghost"
                onPress={() => setEditing(value)}
                aria-label={`${text.manage.editValue}: ${value.name}`}
              >
                <PencilSimple size={16} aria-hidden />
                {text.manage.editValue}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ValueDialog
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function ValueDialog({
  item,
  onClose,
}: {
  item: EngValue | null;
  onClose: () => void;
}) {
  const { send, busy, error } = useEngSend();
  const [name, setName] = useState(item?.name ?? "");
  const [sort, setSort] = useState(String(item?.sort ?? 100));
  const [active, setActive] = useState(item?.active ?? true);
  const ready = name.trim().length >= 2 && sort !== "";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const order = Math.max(0, Math.min(1000, Math.round(Number(sort)) || 0));
    const done = item
      ? await send(
          `values/${item.id}`,
          { name: name.trim(), active, sort: order, version: item.version },
          "PUT",
        )
      : await send("values", { name: name.trim(), sort: order });
    if (done !== null) onClose();
  }
  return (
    <Modal
      open
      title={item ? copy.editValue : copy.newValue}
      onClose={() => !busy && onClose()}
    >
      <form className="leave-form" onSubmit={(event) => void submit(event)}>
        <Input
          label={copy.valueName}
          hint={copy.nameHint}
          value={name}
          onChange={setName}
          maxLength={40}
          isRequired
          hideRequiredIndicator
          autoFocus
        />
        {item && (
          <Checkbox
            isSelected={active}
            onChange={setActive}
            label={copy.valueActive}
          />
        )}
        <RangeInput
          type="number"
          label={copy.valueSort}
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
    </Modal>
  );
}
