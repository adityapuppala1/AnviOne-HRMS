import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DialogPanel,
  ErrorState,
  LoadingState,
  Select,
  TextArea,
} from "@anvi/ui";
import {
  employeeClassificationSchema,
  employeeClassificationUpdateSchema,
  type EmployeeDetail,
} from "@anvi/contracts";
import { api, ApiError, useOrganization } from "../lib/api";
import { useWorkspace } from "../routes/workspace";
import { classificationCopy as text } from "../lib/copy/classification";
import { organizationCopy } from "../lib/copy/organization";
import "../routes/organization.css";

type Ref = { id: string; code: string; name: string } | null;
const NONE = "__none__";
const kinds = [
  { kind: "designation", field: "designation" },
  { kind: "grade", field: "grade" },
  { kind: "cost_center", field: "costCenter" },
] as const;

function UnitSelect({
  kind,
  label,
  current,
  value,
  onChange,
  disabled,
}: {
  kind: (typeof kinds)[number]["kind"];
  label: string;
  current: Ref;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const units = useOrganization(
    new URLSearchParams({
      kind,
      q: "",
      page: "1",
      limit: "50",
    }).toString(),
  );
  if (units.error)
    return (
      <ErrorState
        message={text.loadFailed}
        onRetry={() => void units.refetch()}
      />
    );
  if (units.isPending) return <LoadingState />;
  const choices = units.data.items
    .filter((item) => item.inEffect && !item.mergedIntoId)
    .map((item) => ({ id: item.id, code: item.code, name: item.name }));
  // A saved link to a unit that has since ended stays visible as it is.
  if (current && !choices.some((c) => c.id === current.id))
    choices.unshift(current);
  return (
    <Select
      label={label}
      hint={units.data.pages > 1 ? text.moreUnits : undefined}
      placeholder={text.placeholder}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key ?? NONE))}
      isDisabled={disabled}
    >
      {[
        <Select.Item key={NONE} id={NONE} label={text.none} />,
        ...choices.map((choice) => (
          <Select.Item
            key={choice.id}
            id={choice.id}
            label={choice.name}
            supportingText={choice.code}
          />
        )),
      ]}
    </Select>
  );
}

export function ClassificationDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { me } = useWorkspace();
  const queryClient = useQueryClient();
  const [ids, setIds] = useState<Record<string, string>>({
    designation: employee.designation?.id ?? NONE,
    grade: employee.grade?.id ?? NONE,
    costCenter: employee.costCenter?.id ?? NONE,
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["employee"] }),
      queryClient.invalidateQueries({ queryKey: ["directory"] }),
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const pick = (field: string) => (ids[field] === NONE ? null : ids[field]);
    const parsed = employeeClassificationUpdateSchema.safeParse({
      designationId: pick("designation"),
      gradeId: pick("grade"),
      costCenterId: pick("costCenter"),
      version: employee.version,
      reason,
    });
    if (!parsed.success) {
      setError(text.reasonInvalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/people/${employee.id}/classification`,
        employeeClassificationSchema,
        {
          method: "PUT",
          headers: { "X-CSRF-Token": me.csrfToken },
          body: JSON.stringify(parsed.data),
        },
      );
      await refresh();
      onSaved(result.changed ? text.saved : text.unchanged);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 400 && e instanceof Error) setError(e.message);
      else if (status === 403) setError(text.errors.forbidden);
      else if (status === 404) setError(text.errors.notFound);
      else if (status === 409) {
        setError(text.errors.stale);
        await refresh();
      } else setError(text.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPanel
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={text.title(employee.name)}
      className="organization-editor"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="organization-form"
      >
        <p className="organization-form-intro">{text.intro}</p>
        {kinds.map(({ kind, field }) => (
          <UnitSelect
            key={kind}
            kind={kind}
            label={organizationCopy.kinds[kind].singular.replace(/^./, (c) =>
              c.toUpperCase(),
            )}
            current={employee[field]}
            value={ids[field]!}
            onChange={(id) => setIds((prev) => ({ ...prev, [field]: id }))}
            disabled={busy}
          />
        ))}
        <TextArea
          label={text.reason}
          hint={text.reasonHint}
          isRequired
          hideRequiredIndicator
          minLength={10}
          maxLength={300}
          rows={3}
          value={reason}
          onChange={setReason}
          isDisabled={busy}
        />
        {error && (
          <div className="inline-error organization-form-error" role="alert">
            <p>{error}</p>
          </div>
        )}
        <div className="organization-form-actions">
          <Button variant="secondary" isDisabled={busy} onPress={onClose}>
            {text.cancel}
          </Button>
          <Button type="submit" isDisabled={busy}>
            {busy ? text.saving : text.save}
          </Button>
        </div>
      </form>
    </DialogPanel>
  );
}
