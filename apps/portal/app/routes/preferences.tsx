import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { Desktop } from "@phosphor-icons/react/dist/csr/Desktop";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { CursorClick } from "@phosphor-icons/react/dist/csr/CursorClick";
import { ArrowsInLineVertical } from "@phosphor-icons/react/dist/csr/ArrowsInLineVertical";
import { ArrowsOutLineVertical } from "@phosphor-icons/react/dist/csr/ArrowsOutLineVertical";
import { motion } from "motion/react";
import { Badge, PageHeader, Switch } from "@anvi/ui";
import { usePreferences } from "../lib/preferences";
import { preferencesCopy as text } from "../lib/copy/settings";

export default function Preferences() {
  const { preferences, update, reduceMotion } = usePreferences();
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.subtitle}
        actions={
          <Badge>
            <Check size={15} />
            {text.saved}
          </Badge>
        }
      ></PageHeader>
      <div className="preferences-layout">
        <section className="panel preferences-form">
          <fieldset>
            <legend>{text.appearance.legend}</legend>
            <p>{text.appearance.hint}</p>
            <div className="mode-options">
              {(
                [
                  { value: "light", label: text.appearance.light, icon: Sun },
                  { value: "dark", label: text.appearance.dark, icon: Moon },
                  {
                    value: "system",
                    label: text.appearance.system,
                    icon: Desktop,
                  },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className={`mode-option ${preferences.mode === value ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={value}
                    checked={preferences.mode === value}
                    onChange={() => update({ mode: value })}
                  />
                  <span
                    className={`mode-illustration mode-${value}`}
                    aria-hidden="true"
                  >
                    <i />
                    <span>
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span>
                    <Icon size={18} />
                    {label}
                    {preferences.mode === value && <Check size={16} />}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{text.density.legend}</legend>
            <p>{text.density.hint}</p>
            <div className="density-options">
              {(
                [
                  {
                    value: "comfortable",
                    label: text.density.comfortable.label,
                    description: text.density.comfortable.description,
                    icon: ArrowsOutLineVertical,
                  },
                  {
                    value: "compact",
                    label: text.density.compact.label,
                    description: text.density.compact.description,
                    icon: ArrowsInLineVertical,
                  },
                ] as const
              ).map(({ value, label, description, icon: Icon }) => (
                <label
                  key={value}
                  className={preferences.density === value ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="density"
                    checked={preferences.density === value}
                    onChange={() => update({ density: value })}
                  />
                  <Icon size={23} />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  {preferences.density === value && <Check size={18} />}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="motion-preference">
            <div>
              <h2>
                <CursorClick size={20} />
                {text.motion.heading}
              </h2>
              <p>{text.motion.body}</p>
            </div>
            <Switch
              className={`switch button ${preferences.reduceMotion ? "on" : ""}`}
              isSelected={preferences.reduceMotion}
              aria-label={text.motion.heading}
              onChange={(value) => update({ reduceMotion: value })}
            >
              <motion.span
                className="switch-thumb"
                animate={{ x: preferences.reduceMotion ? 20 : 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 450, damping: 30 }
                }
              />
            </Switch>
          </div>
        </section>
        <aside className="preferences-aside">
          <div className="preference-sample">
            <div className="sample-top">
              <SlidersHorizontal size={22} />
              <Badge>{text.sample.badge}</Badge>
            </div>
            <h2>
              {text.sample.titleLine1}
              <br />
              {text.sample.titleLine2}
            </h2>
            <div className="sample-rows">
              {text.sample.rows.map(({ label, initials }) => (
                <div key={label}>
                  <span>{initials}</span>
                  <div>
                    <strong>{label}</strong>
                    <i />
                  </div>
                  <Check size={16} />
                </div>
              ))}
            </div>
          </div>
          <p>{text.aside}</p>
        </aside>
      </div>
    </div>
  );
}
