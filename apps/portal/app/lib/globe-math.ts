// Projection helpers for the holographic globe. Pure functions so the 3D
// maths can be unit-tested without a canvas.
export type Vec = { x: number; y: number; z: number };

export const DEG = Math.PI / 180;

// Office pins. India first because Anvi is an India-first product; the rest
// show that the same workspace can span countries. Positions are decorative:
// they do not claim any real office exists.
export const PINS: ReadonlyArray<{ lat: number; lon: number }> = [
  { lat: 12.97, lon: 77.59 },
  { lat: 19.08, lon: 72.88 },
  { lat: 28.61, lon: 77.21 },
  { lat: 17.39, lon: 78.49 },
  { lat: 13.08, lon: 80.27 },
  { lat: 18.52, lon: 73.86 },
  { lat: 22.57, lon: 88.36 },
  { lat: 1.35, lon: 103.82 },
  { lat: 25.2, lon: 55.27 },
  { lat: 51.51, lon: -0.13 },
];

// Pairs of pin indexes joined by the marigold thread.
export const THREADS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 7],
  [2, 8],
  [8, 9],
  [3, 6],
];

export function toVec(lat: number, lon: number): Vec {
  const cl = Math.cos(lat);
  return { x: cl * Math.sin(lon), y: Math.sin(lat), z: cl * Math.cos(lon) };
}

// Spin about the vertical axis, then tilt toward the viewer.
export function rotate(v: Vec, spin: number, tilt: number): Vec {
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const x = v.x * cs + v.z * ss;
  const z = v.z * cs - v.x * ss;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return { x, y: v.y * ct - z * st, z: v.y * st + z * ct };
}

export function fibonacciSphere(count: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const lon = (golden * i) % (2 * Math.PI);
    return toVec(Math.asin(y), lon - Math.PI);
  });
}

// Points along the great circle between two unit vectors, lifted off the
// surface in the middle so threads read as arcs rather than chords.
export function arc(a: Vec, b: Vec, steps: number, lift = 0.22): Vec[] {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const sin = Math.sin(omega) || 1;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const wa = Math.sin((1 - t) * omega) / sin;
    const wb = Math.sin(t * omega) / sin;
    const raise = 1 + lift * Math.sin(Math.PI * t) * (omega / Math.PI);
    return {
      x: (a.x * wa + b.x * wb) * raise,
      y: (a.y * wa + b.y * wb) * raise,
      z: (a.z * wa + b.z * wb) * raise,
    };
  });
}

// The spin that brings a longitude to the front of the globe.
export const faceLongitude = (lon: number) => -lon * DEG;
