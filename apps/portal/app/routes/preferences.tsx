import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { Desktop } from "@phosphor-icons/react/dist/csr/Desktop";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { CursorClick } from "@phosphor-icons/react/dist/csr/CursorClick";
import { ArrowsInLineVertical } from "@phosphor-icons/react/dist/csr/ArrowsInLineVertical";
import { ArrowsOutLineVertical } from "@phosphor-icons/react/dist/csr/ArrowsOutLineVertical";
import { motion } from "motion/react";
import { Badge, Switch } from "@anvi/ui";
import { usePreferences } from "../lib/preferences";

export default function Preferences() {
  const { preferences, update, reduceMotion } = usePreferences();
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Make room for your way of working</p>
          <h1>A space that suits you.</h1>
          <p>Your display preferences apply on this browser.</p>
        </div>
        <Badge>
          <Check size={15} />
          Saved automatically
        </Badge>
      </div>
      <div className="preferences-layout">
        <section className="panel preferences-form">
          <fieldset>
            <legend>Appearance</legend>
            <p>Choose your light. Follow your device, or set your own.</p>
            <div className="mode-options">
              {(
                [
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "system", label: "System", icon: Desktop },
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
            <legend>Workspace density</legend>
            <p>Adjust the space between rows and cards.</p>
            <div className="density-options">
              {(
                [
                  {
                    value: "comfortable",
                    label: "Comfortable",
                    description: "More breathing room",
                    icon: ArrowsOutLineVertical,
                  },
                  {
                    value: "compact",
                    label: "Compact",
                    description: "More in one view",
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
                Reduce motion
              </h2>
              <p>
                Keep transitions and decorative effects still. Your device's
                reduced-motion setting is always respected.
              </p>
            </div>
            <Switch
              className={`switch button ${preferences.reduceMotion ? "on" : ""}`}
              isSelected={preferences.reduceMotion}
              aria-label="Reduce motion"
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
              <Badge>Live preview</Badge>
            </div>
            <h2>
              Your workspace,
              <br />
              your rhythm.
            </h2>
            <div className="sample-rows">
              {["People directory", "Team explorer", "Work profile"].map(
                (label, index) => (
                  <div key={label}>
                    <span>
                      {index === 0 ? "MI" : index === 1 ? "NR" : "AS"}
                    </span>
                    <div>
                      <strong>{label}</strong>
                      <i />
                    </div>
                    <Check size={16} />
                  </div>
                ),
              )}
            </div>
          </div>
          <p>
            Appearance changes are personal. Organization branding is managed
            separately by your platform admin.
          </p>
        </aside>
      </div>
    </div>
  );
}
