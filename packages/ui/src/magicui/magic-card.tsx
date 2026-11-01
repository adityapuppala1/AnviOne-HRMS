// Adapted from Magic UI Magic Card (MIT). See LICENSE.md in this directory.
// Source: https://magicui.design/r/magic-card.json, retrieved 2026-10-25.
// Anvi adaptation: semantic tokens, no Next.js, no orb, reduced motion/touch guard.
import type { ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";

export function MagicCard({
  children,
  className = "",
  disabled,
}: {
  children: ReactNode;
  className?: string;
  disabled: boolean;
}) {
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const background = useMotionTemplate`radial-gradient(280px circle at ${x}px ${y}px, var(--brand-soft), transparent 100%)`;
  return (
    <div
      className={`magic-card ${className}`}
      onPointerMove={(event) => {
        if (disabled || event.pointerType !== "mouse") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        x.set(event.clientX - bounds.left);
        y.set(event.clientY - bounds.top);
      }}
      onPointerLeave={() => {
        x.set(-400);
        y.set(-400);
      }}
    >
      {!disabled && (
        <motion.div
          aria-hidden="true"
          className="magic-card-glow"
          style={{ background }}
        />
      )}
      <div className="magic-card-content">{children}</div>
    </div>
  );
}
