// Adapted from Magic UI Number Ticker (MIT). See LICENSE.md in this directory.
// Source: https://magicui.design/docs/components/number-ticker, retrieved 2026-10-25.
// Anvi adaptation: no Next.js/cn helper, zero-padding, settles instantly when motion is reduced.
import { useEffect, useRef } from "react";
import { animate, useInView } from "motion/react";

export function NumberTicker({
  value,
  pad = 0,
  disabled,
  className = "",
}: {
  value: number;
  pad?: number;
  disabled: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const format = (n: number) => String(Math.round(n)).padStart(pad, "0");
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (disabled || !inView) {
      node.textContent = format(disabled ? value : 0);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => (node.textContent = format(latest)),
    });
    return () => controls.stop();
  }, [value, pad, disabled, inView]);
  return (
    <span ref={ref} className={`number-ticker ${className}`}>
      {format(value)}
    </span>
  );
}
