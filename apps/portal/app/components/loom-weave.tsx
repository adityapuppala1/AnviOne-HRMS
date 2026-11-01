import { motion } from "motion/react";
import { usePreferences } from "../lib/preferences";

// Anvi Loom signature: people as threads woven into one fabric.
// Vertical warp threads stay still; weft threads draw across once, the
// marigold thread last. Knots mark where colleagues meet.
const WEFT = [
  "M-20 70 C 90 30, 170 110, 280 62 S 470 24, 620 76",
  "M-20 128 C 110 168, 200 92, 320 132 S 500 170, 620 118",
  "M-20 190 C 80 150, 220 226, 340 186 S 520 150, 620 196",
];
const THREAD = "M-20 156 C 120 96, 230 216, 360 150 S 540 92, 620 142";
const KNOTS = [
  { x: 150, y: 108 },
  { x: 318, y: 140 },
  { x: 470, y: 112 },
];

export function LoomWeave({
  knots = [],
  className = "",
}: {
  knots?: string[];
  className?: string;
}) {
  const { reduceMotion } = usePreferences();
  const draw = (delay: number) =>
    reduceMotion
      ? { initial: false as const }
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: {
            duration: 1.6,
            delay,
            ease: [0.65, 0, 0.35, 1] as const,
          },
        };
  return (
    <svg
      className={`loom-weave ${className}`}
      viewBox="0 0 600 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {Array.from({ length: 16 }, (_, i) => (
        <line
          key={i}
          className="loom-warp"
          x1={18 + i * 38}
          x2={18 + i * 38}
          y1="0"
          y2="240"
        />
      ))}
      {WEFT.map((d, i) => (
        <motion.path key={d} d={d} className="loom-weft" {...draw(0.15 * i)} />
      ))}
      <motion.path d={THREAD} className="loom-thread" {...draw(0.55)} />
      {knots.slice(0, KNOTS.length).map((initials, i) => {
        const { x, y } = KNOTS[i]!;
        return (
          <motion.g
            key={`${initials}-${i}`}
            className="loom-knot"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: reduceMotion ? 0 : 1.4 + i * 0.12 }}
            style={{ transformOrigin: `${x}px ${y}px` }}
          >
            <circle cx={x} cy={y} r="19" />
            <text x={x} y={y} dy="0.35em">
              {initials}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}
