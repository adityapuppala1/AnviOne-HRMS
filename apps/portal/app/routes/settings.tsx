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
    return (
      <ErrorState message="Workspace settings require the Platform admin role. Switch to an assigned role to continue." />
    );
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
      setError(e instanceof Error ? e.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Organization identity</p>
          <h1>Your workspace. Your signature.</h1>
          <p>Choose the names and colors your people come home to.</p>
        </div>
        <Badge>Version {branding.version}</Badge>
      </div>
      <form
        onSubmit={(event) => void submit(event)}
        className="settings-layout"
      >
        <div className="panel settings-form">
          <div className="panel-heading">
            <h2>The essentials</h2>
            <Palette size={20} />
          </div>
          <div className="form-fields">
            {(
              [
                {
                  key: "organizationName",
                  label: "Organization name",
                  help: "Shown in your workspace navigation.",
                  max: 60,
                },
                {
                  key: "platformName",
                  label: "Platform name",
                  help: "The name for your HR and administration workspace.",
                  max: 30,
                },
                {
                  key: "employeeName",
                  label: "Employee workspace name",
                  help: "A familiar name for the employee experience.",
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
              <legend>Workspace palette</legend>
              <p>Considered colors, with readable contrast.</p>
              <div>
                {(
                  [
                    { value: "ocean", label: "Atlas" },
                    { value: "iris", label: "Iris" },
                    { value: "forest", label: "Woodland" },
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
                Workspace settings published.
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
                Discard changes
              </Button>
              <Button type="submit" isDisabled={busy || !dirty}>
                {busy ? "Publishing…" : "Publish changes"}
                <ArrowUpRight size={16} />
              </Button>
            </div>
          </div>
        </div>
        <aside className={`settings-preview preview-${form.theme}`}>
          <div className="preview-heading">
            <p className="eyebrow">Your workspace, previewed</p>
            <div className="view-toggle">
              <Button
                variant="icon"
                aria-label="Desktop preview"
                aria-pressed={previewMode === "desktop"}
                onPress={() => setPreviewMode("desktop")}
              >
                <Desktop size={18} />
              </Button>
              <Button
                variant="icon"
                aria-label="Mobile preview"
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
                <span className="preview-nav active">Overview</span>
                <span className="preview-nav">
                  <Users size={12} />
                  People
                </span>
                <span className="preview-nav">
                  <TreeStructure size={12} />
                  Teams
                </span>
              </div>
              <div className="preview-content">
                <span>{form.organizationName}</span>
                <h3>
                  Welcome to
                  <br />
                  {form.employeeName}.
                </h3>
                <div className="preview-block">
                  <Users size={22} weight="duotone" />
                  <strong>Your people, connected.</strong>
                </div>
                <div className="preview-block short">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </MagicCard>
          <p>
            Your names and palette update throughout the workspace when you
            publish.
          </p>
        </aside>
      </form>
    </div>
  );
}
