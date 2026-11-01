import type { CSSProperties, ReactNode } from "react";
import { useParallax } from "../lib/use-parallax";
import { HoloGlobe } from "./holo-globe";

export type Satellite = { key: string; node: ReactNode; accent: string };
export type FloatCard = {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  accent: string;
};

// Where each floating card sits (as a percentage of the stage) and how far it
// travels with the pointer. Cards stay inside the stage so nothing can push the
// page wider than the screen.
const SPOTS = [
  { top: "6%", left: "0%", depth: 26 },
  { top: "58%", right: "0%", depth: 34 },
  { bottom: "2%", left: "8%", depth: 18 },
] as const;

// Two tilted orbit rings carry the satellites; the globe sits between them.
const RINGS = [
  { size: 98, tilt: -16, squash: 0.42, seconds: 46, reverse: false },
  { size: 80, tilt: 22, squash: 0.52, seconds: 32, reverse: true },
] as const;

const style = (vars: Record<string, string | number>) =>
  vars as unknown as CSSProperties;

// The signature moment: a holographic globe of offices, ringed by orbiting
// product modules and people, with glass cards floating at different depths.
// All of it is decorative (aria-hidden); it moves with the pointer and stands
// still with reduced motion.
export function GlobeStage({
  satellites,
  cards = [],
  pins,
  className = "",
}: {
  satellites: Satellite[];
  cards?: FloatCard[];
  pins?: number;
  className?: string;
}) {
  const ref = useParallax<HTMLDivElement>();
  return (
    <div ref={ref} className={`globe-stage ${className}`} aria-hidden="true">
      {RINGS.map((ring, ringIndex) => {
        const members = satellites.filter(
          (_, i) => i % RINGS.length === ringIndex,
        );
        return (
          <div
            key={ringIndex}
            className="orbit parallax-layer"
            style={style({
              "--size": `${ring.size}%`,
              "--tilt": `${ring.tilt}deg`,
              "--squash": ring.squash,
              "--unsquash": 1 / ring.squash,
              "--seconds": `${ring.seconds}s`,
              "--direction": ring.reverse ? "reverse" : "normal",
              "--counter": ring.reverse ? "normal" : "reverse",
              "--depth": ringIndex === 0 ? -8 : -3,
            })}
          >
            <div className="orbit-spin">
              <span className="orbit-ring" />
              {members.map((member, i) => (
                <span
                  key={member.key}
                  className="orbit-slot"
                  style={style({ "--at": `${(360 / members.length) * i}deg` })}
                >
                  <span
                    className="orbit-pin"
                    style={style({ "--accent": member.accent })}
                  >
                    {member.node}
                  </span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <div
        className="globe-core parallax-layer"
        style={style({ "--depth": 8 })}
      >
        <HoloGlobe pins={pins} />
      </div>
      {cards.slice(0, SPOTS.length).map((card, i) => (
        <div
          key={card.key}
          className="float-card parallax-layer"
          style={style({
            ...SPOTS[i],
            "--depth": SPOTS[i]!.depth,
            "--accent": card.accent,
            "--bob": `${5 + i * 1.3}s`,
            "--delay": `${i * -1.7}s`,
          })}
        >
          <span className="float-card-icon">{card.icon}</span>
          <span>
            <strong>{card.title}</strong>
            <small>{card.detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
