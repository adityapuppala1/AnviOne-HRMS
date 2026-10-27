import { useEffect, useRef } from "react";
import { usePreferences } from "./preferences";

// Eases the pointer position into two CSS variables, --px and --py (-1 to 1,
// measured from the middle of the window). Layers read them through
// `.parallax-layer` and scale by their own --depth, so the effect costs one
// style write per frame and no React renders. It does nothing with reduced
// motion or on touch screens.
export function useParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const { reduceMotion } = usePreferences();
  useEffect(() => {
    const element = ref.current;
    if (
      !element ||
      reduceMotion ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const tick = () => {
      x += (targetX - x) * 0.08;
      y += (targetY - y) * 0.08;
      element.style.setProperty("--px", x.toFixed(3));
      element.style.setProperty("--py", y.toFixed(3));
      raf =
        Math.abs(targetX - x) + Math.abs(targetY - y) > 0.002
          ? requestAnimationFrame(tick)
          : 0;
    };
    const move = (event: PointerEvent) => {
      targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);
  return ref;
}
