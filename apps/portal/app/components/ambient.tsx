import { useEffect, useRef } from "react";
import { usePreferences } from "../lib/preferences";

// Slow drifting colour behind a dark hero. Pure CSS; the motion stops under
// reduced motion (see wow.css).
export function Aurora({ className = "" }: { className?: string }) {
  return (
    <div className={`aurora ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <span />
    </div>
  );
}

// The whole-app backdrop and pointer light, mounted once at the root.
export function Ambient() {
  return (
    <>
      <div className="ambient" aria-hidden="true">
        <i />
        <i />
      </div>
      <CursorGlow />
    </>
  );
}

// A soft light that trails the mouse across the whole app. It is skipped on
// touch screens and with reduced motion, never takes pointer events, and
// carries no information.
export function CursorGlow() {
  const { reduceMotion } = usePreferences();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const glow = ref.current;
    if (
      !glow ||
      reduceMotion ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    let targetX = -999;
    let targetY = -999;
    let x = targetX;
    let y = targetY;
    let raf = 0;
    const tick = () => {
      x += (targetX - x) * 0.18;
      y += (targetY - y) * 0.18;
      glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      raf =
        Math.abs(targetX - x) + Math.abs(targetY - y) > 0.5
          ? requestAnimationFrame(tick)
          : 0;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      // Cards under the pointer get a spotlight at the pointer's position.
      const card = (event.target as Element | null)?.closest?.<HTMLElement>(
        ".panel, [data-spot]",
      );
      if (card) {
        const box = card.getBoundingClientRect();
        card.style.setProperty(
          "--sx",
          `${(event.clientX - box.left).toFixed(0)}px`,
        );
        card.style.setProperty(
          "--sy",
          `${(event.clientY - box.top).toFixed(0)}px`,
        );
      }
      if (x === -999) {
        x = event.clientX;
        y = event.clientY;
      }
      targetX = event.clientX;
      targetY = event.clientY;
      glow.dataset.active = "true";
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const leave = () => delete glow.dataset.active;
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);
  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
