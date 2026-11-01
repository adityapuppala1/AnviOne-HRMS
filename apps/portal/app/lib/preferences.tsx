import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { MotionConfig } from "motion/react";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";

type Preferences = {
  mode: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  reduceMotion: boolean;
  collapsed: boolean;
};
const defaults: Preferences = {
  mode: "system",
  density: "comfortable",
  reduceMotion: false,
  collapsed: false,
};
const Context = createContext<{
  preferences: Preferences;
  update: (next: Partial<Preferences>) => void;
  dark: boolean;
  reduceMotion: boolean;
}>({
  preferences: defaults,
  update: () => {},
  dark: false,
  reduceMotion: false,
});
export const usePreferences = () => useContext(Context);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaults);
  const [systemDark, setSystemDark] = useState(false);
  const [systemReduced, setSystemReduced] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("anvi-display") ?? "null",
      );
      if (saved && typeof saved === "object") {
        const p = saved as Partial<Preferences>;
        setPreferences({
          mode: ["light", "dark", "system"].includes(p.mode ?? "")
            ? p.mode!
            : "system",
          density: p.density === "compact" ? "compact" : "comfortable",
          reduceMotion: p.reduceMotion === true,
          collapsed: p.collapsed === true,
        });
      }
    } catch {
      /* Storage is optional; in-memory preferences remain usable. */
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemDark(media.matches);
    setSystemReduced(motionMedia.matches);
    const change = () => setSystemDark(media.matches);
    // Motion's installed hook snapshots the initial preference. Subscribe here
    // so OS changes update CSS, MotionConfig and pointer effects immediately.
    const motionChange = () => setSystemReduced(motionMedia.matches);
    media.addEventListener("change", change);
    motionMedia.addEventListener("change", motionChange);
    return () => {
      media.removeEventListener("change", change);
      motionMedia.removeEventListener("change", motionChange);
    };
  }, []);
  const dark =
    preferences.mode === "dark" ||
    (preferences.mode === "system" && systemDark);
  const reduceMotion = preferences.reduceMotion || systemReduced;
  useEffect(() => {
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.motion = reduceMotion ? "reduce" : "full";
  }, [dark, preferences.density, reduceMotion]);
  function update(next: Partial<Preferences>) {
    setPreferences((current) => {
      const merged = { ...current, ...next };
      try {
        localStorage.setItem("anvi-display", JSON.stringify(merged));
      } catch {
        /* No persistence is required for access. */
      }
      return merged;
    });
  }
  return (
    <Context.Provider value={{ preferences, update, dark, reduceMotion }}>
      <IconContext.Provider value={{ weight: "regular", "aria-hidden": true }}>
        <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
          {children}
        </MotionConfig>
      </IconContext.Provider>
    </Context.Provider>
  );
}
