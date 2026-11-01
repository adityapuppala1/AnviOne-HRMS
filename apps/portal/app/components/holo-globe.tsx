import { useEffect, useRef } from "react";
import { usePreferences } from "../lib/preferences";
import {
  DEG,
  PINS,
  THREADS,
  arc,
  faceLongitude,
  fibonacciSphere,
  rotate,
  toVec,
} from "../lib/globe-math";

const LATTICE = fibonacciSphere(1100);
const PIN_VECS = PINS.map((pin) => toVec(pin.lat * DEG, pin.lon * DEG));
const ARCS = THREADS.map(([from, to]) => ({
  from,
  to,
  points: arc(PIN_VECS[from]!, PIN_VECS[to]!, 40),
}));
const START_SPIN = faceLongitude(PINS[0]!.lon);
const BASE_TILT = 0.38;
const MARIGOLD = "#f4b23e";

type State = {
  spin: number;
  velocity: number;
  tilt: number;
  nudge: number;
  targetTilt: number;
  targetNudge: number;
  dragging: boolean;
  marigold: string;
};

function paint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  state: State,
  seconds: number,
  pins: number,
) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.4;
  const spin = state.spin + state.nudge;
  ctx.clearRect(0, 0, width, height);

  // Halo behind the sphere.
  const halo = ctx.createRadialGradient(
    cx,
    cy,
    radius * 0.6,
    cx,
    cy,
    // Fades to nothing before the canvas edge so no square shows.
    radius * 1.24,
  );
  halo.addColorStop(0, "rgba(139,135,230,0.30)");
  halo.addColorStop(1, "rgba(139,135,230,0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  // Glassy body.
  const body = ctx.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.4,
    radius * 0.1,
    cx,
    cy,
    radius,
  );
  body.addColorStop(0, "rgba(190,188,255,0.22)");
  body.addColorStop(0.7, "rgba(80,78,190,0.10)");
  body.addColorStop(1, "rgba(150,230,255,0.18)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const place = (v: { x: number; y: number; z: number }) => ({
    x: cx + v.x * radius,
    y: cy - v.y * radius,
    z: v.z,
  });

  // Graticule: meridians and parallels every 30 degrees.
  ctx.lineWidth = dpr;
  ctx.strokeStyle = "#c9c7ff";
  ctx.globalAlpha = 0.16;
  const trace = (points: { lat: number; lon: number }[]) => {
    ctx.beginPath();
    let pen = false;
    for (const { lat, lon } of points) {
      const p = place(rotate(toVec(lat * DEG, lon * DEG), spin, state.tilt));
      if (p.z > 0) {
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  };
  for (let lon = 0; lon < 360; lon += 30)
    trace(Array.from({ length: 29 }, (_, i) => ({ lat: -84 + i * 6, lon })));
  for (let lat = -60; lat <= 60; lat += 30)
    trace(Array.from({ length: 61 }, (_, i) => ({ lat, lon: i * 6 })));

  // Dot lattice with an iridescent hue and a scan band sweeping over it.
  const scan = Math.sin(seconds * 0.6) * 0.95;
  for (const point of LATTICE) {
    const v = rotate(point, spin, state.tilt);
    const front = Math.max(v.z, 0);
    const lit = Math.max(0, 1 - Math.abs(v.y - scan) * 6);
    const hue = 238 - (v.x * 0.5 + 0.5) * 60 + lit * 20;
    ctx.globalAlpha = v.z < 0 ? 0.07 : 0.2 + 0.55 * front + lit * 0.25;
    ctx.fillStyle = `hsl(${hue.toFixed(0)} 90% ${Math.round(68 + lit * 22)}%)`;
    const size = (0.7 + 1.1 * front + lit) * dpr;
    ctx.fillRect(
      cx + v.x * radius - size / 2,
      cy - v.y * radius - size / 2,
      size,
      size,
    );
  }

  // The scan line itself.
  const scanY = cy - scan * radius;
  const half = Math.sqrt(Math.max(radius * radius - (scan * radius) ** 2, 0));
  const beam = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  beam.addColorStop(0, "rgba(150,230,255,0)");
  beam.addColorStop(0.5, "rgba(150,230,255,0.85)");
  beam.addColorStop(1, "rgba(150,230,255,0)");
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = beam;
  ctx.fillRect(cx - half, scanY - dpr, half * 2, dpr * 2);

  // Marigold threads between offices, each carrying a travelling pulse.
  ARCS.forEach(({ from, to, points }, index) => {
    if (from >= pins || to >= pins) return;
    ctx.strokeStyle = state.marigold;
    ctx.lineWidth = 1.6 * dpr;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    let pen = false;
    const projected = points.map((p) => place(rotate(p, spin, state.tilt)));
    for (const p of projected) {
      if (p.z > 0.04) {
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
    const pulse =
      projected[
        Math.floor(
          ((((seconds * 0.3 + index * 0.19) % 1) + 1) % 1) *
            (projected.length - 1),
        )
      ]!;
    if (pulse.z > 0.04) {
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, 2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Office pins with a soft sonar ring.
  PIN_VECS.slice(0, pins).forEach((pin, index) => {
    const p = place(rotate(pin, spin, state.tilt));
    if (p.z <= 0.05) return;
    const phase = (seconds * 0.8 + index * 0.31) % 1;
    ctx.strokeStyle = state.marigold;
    ctx.lineWidth = dpr;
    ctx.globalAlpha = (1 - phase) * 0.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (3 + phase * 13) * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = state.marigold;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.8 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1 * dpr, 0, Math.PI * 2);
    ctx.fill();
  });

  // Fresnel rim.
  const rim = ctx.createRadialGradient(
    cx,
    cy,
    radius * 0.82,
    cx,
    cy,
    radius * 1.02,
  );
  rim.addColorStop(0, "rgba(160,235,255,0)");
  rim.addColorStop(0.85, "rgba(160,235,255,0.30)");
  rim.addColorStop(1, "rgba(200,198,255,0.55)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.02, 0, Math.PI * 2);
  ctx.fill();
}

// A rotating, draggable holographic globe. It is decorative: the offices it
// shows are illustrative, so the canvas is hidden from assistive technology.
// With reduced motion it paints one still frame and ignores the pointer.
export function HoloGlobe({
  pins = PINS.length,
  className = "",
}: {
  pins?: number;
  className?: string;
}) {
  const { reduceMotion } = usePreferences();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The provider only learns the system setting after mount, so read it
  // directly too. Using the combined value as the effect dependency means the
  // provider catching up does not restart the globe and repaint it.
  const still =
    reduceMotion ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const state: State = {
      spin: START_SPIN,
      velocity: 0,
      tilt: BASE_TILT,
      nudge: 0,
      targetTilt: BASE_TILT,
      targetNudge: 0,
      dragging: false,
      marigold: MARIGOLD,
    };
    let width = 0;
    let height = 0;
    let dpr = 1;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    let seconds = 0;

    const readColour = () => {
      const value = getComputedStyle(canvas)
        .getPropertyValue("--marigold")
        .trim();
      state.marigold = /^#[0-9a-f]{6}$/i.test(value) ? value : MARIGOLD;
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(box.width * dpr));
      height = Math.max(1, Math.round(box.height * dpr));
      canvas.width = width;
      canvas.height = height;
      readColour();
      paint(ctx, width, height, dpr, state, seconds, pins);
      canvas.dataset.ready = "true";
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      // The frame timestamp can precede the time we started; never run backwards.
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
      last = now;
      seconds += dt;
      if (!state.dragging) {
        state.spin += (0.16 + state.velocity) * dt;
        state.velocity *= Math.exp(-2.5 * dt);
      }
      state.tilt += (state.targetTilt - state.tilt) * Math.min(1, dt * 4);
      state.nudge += (state.targetNudge - state.nudge) * Math.min(1, dt * 4);
      if (Math.floor(seconds) !== Math.floor(seconds - dt)) readColour();
      paint(ctx, width, height, dpr, state, seconds, pins);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const sizing = new ResizeObserver(resize);
    sizing.observe(canvas);
    resize();
    if (still) return () => sizing.disconnect();

    // Parallax: the globe leans toward the pointer across the whole window.
    const fine = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    ).matches;
    const lean = (event: PointerEvent) => {
      if (state.dragging) return;
      state.targetTilt =
        BASE_TILT + (event.clientY / window.innerHeight - 0.5) * 0.28;
      state.targetNudge = (event.clientX / window.innerWidth - 0.5) * 0.5;
    };
    if (fine) window.addEventListener("pointermove", lean, { passive: true });

    // Dragging spins the globe and releases with inertia.
    let lastX = 0;
    let lastT = 0;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      state.dragging = true;
      lastX = event.clientX;
      lastT = event.timeStamp;
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = "true";
    };
    const drag = (event: PointerEvent) => {
      if (!state.dragging) return;
      const dx = event.clientX - lastX;
      const dt = Math.max((event.timeStamp - lastT) / 1000, 0.001);
      state.spin += dx * 0.008;
      state.velocity = Math.max(-4, Math.min(4, (dx * 0.008) / dt));
      lastX = event.clientX;
      lastT = event.timeStamp;
    };
    const up = (event: PointerEvent) => {
      // Holding still before letting go means no flick.
      if (event.timeStamp - lastT > 80) state.velocity = 0;
      state.dragging = false;
      delete canvas.dataset.dragging;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", drag);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    const watching = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      start();
    });
    watching.observe(canvas);
    document.addEventListener("visibilitychange", start);
    start();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      sizing.disconnect();
      watching.disconnect();
      window.removeEventListener("pointermove", lean);
      document.removeEventListener("visibilitychange", start);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", drag);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [pins, still]);

  return (
    <canvas
      ref={canvasRef}
      className={`holo-globe ${className}`}
      aria-hidden="true"
    />
  );
}
