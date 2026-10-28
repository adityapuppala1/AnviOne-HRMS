import { useEffect, useState } from "react";

export type Orientation = "vertical" | "horizontal";
const ORIENTATION_KEY = "anvi.chart.orientation";

export function readOrientation(): Orientation {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === "horizontal"
      ? "horizontal"
      : "vertical";
  } catch {
    return "vertical";
  }
}
export function saveOrientation(value: Orientation) {
  try {
    localStorage.setItem(ORIENTATION_KEY, value);
  } catch {
    // Private windows can refuse storage; the choice just is not remembered.
  }
}

export const isUuid = (value: string | null): value is string =>
  Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );

// True when the person asked for less motion in their device settings or in
// the portal's own "Reduce motion" preference (data-motion="reduce").
export function motionReduced() {
  if (typeof document === "undefined") return false;
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  return query || document.documentElement.dataset.motion === "reduce";
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const update = () => setReduced(motionReduced());
    update();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return reduced;
}

// Department can be null from the API; show nothing misleading.
export const deptLabel = (
  value: string | null | undefined,
  fallback: string,
) => (value && value.trim() ? value : fallback);
