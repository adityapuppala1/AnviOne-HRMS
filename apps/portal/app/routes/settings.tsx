import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Palette } from "@phosphor-icons/react/dist/csr/Palette";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Desktop } from "@phosphor-icons/react/dist/csr/Desktop";
import { DeviceMobile } from "@phosphor-icons/react/dist/csr/DeviceMobile";
import { Users } from "@phosphor-icons/react/dist/csr/Users";
import { TreeStructure } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { Button, ErrorState, Badge, MagicCard } from "@anvi/ui";
import { brandingSchema, type Theme } from "@anvi/contracts";
import { api } from "../lib/api";
import { useWorkspace } from "./workspace";
import { Brand } from "../components/brand";
import { usePreferences } from "../lib/preferences";
import { settingsCopy as text } from "../lib/copy/settings";
export default function Settings() {
  const { me, branding } = useWorkspace();
  const { reduceMotion } = usePreferences();
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [form, setForm] = useState(branding),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    setForm(branding);
  }, [branding]);
  const dirty = JSON.stringify(form) !== JSON.stringify(branding);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  if (!me.permissions.includes("branding.write"))
    return <ErrorState message={text.denied} />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const updated = await api("/branding/active", brandingSchema, {
        method: "PUT",
        headers: { "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify(form),
      });
      client.setQueryData(["branding"], updated);
      setForm(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : text.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <Badge>{text.version(branding.version)}</Badge>
      </div>
      <form
        onSubmit={(event) => void submit(event)}
        className="settings-layout"
      >
        <div className="panel settings-form">
          <div className="panel-heading">
            <h2>{text.essentials}</h2>
            <Palette size={20} />
          </div>
          <div className="form-fields">
            {(
              [
                {
                  key: "organizationName",
                  label: text.fields.organizationName.label,
                  help: text.fields.organizationName.help,
                  max: 60,
                },
                {
                  key: "platformName",
                  label: text.fields.platformName.label,
                  help: text.fields.platformName.help,
                  max: 30,
                },
                {
                  key: "employeeName",
                  label: text.fields.employeeName.label,
                  help: text.fields.employeeName.help,
                  max: 30,
                },
              ] as const
            ).map(({ key, label, help, max }) => (
              <label key={key}>
                <strong>{label}</strong>
                <input
                  required
                  minLength={2}
                  maxLength={max}
                  value={form[key]}
                  onChange={(e) => {
                    setForm({ ...form, [key]: e.target.value });
                    setSaved(false);
                  }}
                />
                <small>{help}</small>
              </label>
            ))}
            <fieldset className="theme-options">
              <legend>{text.palette.legend}</legend>
              <p>{text.palette.hint}</p>
              <div>
                {(
                  [
                    { value: "ocean", label: text.palette.names.ocean },
                    { value: "iris", label: text.palette.names.iris },
                    { value: "forest", label: text.palette.names.forest },
                  ] satisfies { value: Theme; label: string }[]
                ).map((theme) => (
                  <label
                    key={theme.value}
                    className={`theme-option theme-${theme.value} ${form.theme === theme.value ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={theme.value}
                      checked={form.theme === theme.value}
                      onChange={() => {
                        setForm({ ...form, theme: theme.value });
                        setSaved(false);
                      }}
                    />
                    <span className="theme-swatch">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{theme.label}</span>
                    {form.theme === theme.value && <Check size={14} />}
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="save-success" role="status">
                <Check size={17} />
                {text.published}
              </p>
            )}
            <div className="settings-actions">
              <Button
                type="button"
                variant="secondary"
                isDisabled={busy || !dirty}
                onPress={() => {
                  setForm(branding);
                  setError("");
                  setSaved(false);
                }}
              >
                {text.discard}
              </Button>
              <Button type="submit" isDisabled={busy || !dirty}>
                {busy ? text.publishing : text.publish}
                <ArrowUpRight size={16} />
              </Button>
            </div>
          </div>
        </div>
        <aside className={`settings-preview preview-${form.theme}`}>
          <div className="preview-heading">
            <p className="eyebrow">{text.preview.eyebrow}</p>
            <div className="view-toggle">
              <Button
                variant="icon"
                aria-label={text.preview.desktop}
                aria-pressed={previewMode === "desktop"}
                onPress={() => setPreviewMode("desktop")}
              >
                <Desktop size={18} />
              </Button>
              <Button
                variant="icon"
                aria-label={text.preview.mobile}
                aria-pressed={previewMode === "mobile"}
                onPress={() => setPreviewMode("mobile")}
              >
                <DeviceMobile size={18} />
              </Button>
            </div>
          </div>
          <MagicCard disabled={reduceMotion} className="brand-preview-magic">
            <div className={`preview-window preview-device-${previewMode}`}>
              <div className="preview-sidebar">
                <Brand name={form.platformName} light />
                <span className="preview-nav active">
                  {text.preview.overview}
                </span>
                <span className="preview-nav">
                  <Users size={12} />
                  {text.preview.people}
                </span>
                <span className="preview-nav">
                  <TreeStructure size={12} />
                  {text.preview.teams}
                </span>
              </div>
              <div className="preview-content">
                <span>{form.organizationName}</span>
                <h3>
                  {text.preview.welcomeTo}
                  <br />
                  {form.employeeName}.
                </h3>
                <div className="preview-block">
                  <Users size={22} weight="duotone" />
                  <strong>{text.preview.connected}</strong>
                </div>
                <div className="preview-block short">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </MagicCard>
          <p>{text.preview.note}</p>
        </aside>
      </form>
    </div>
  );
}
