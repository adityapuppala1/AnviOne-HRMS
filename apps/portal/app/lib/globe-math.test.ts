import { describe, expect, it } from "vitest";
import {
  DEG,
  PINS,
  THREADS,
  arc,
  faceLongitude,
  fibonacciSphere,
  rotate,
  toVec,
} from "./globe-math";

const length = (v: { x: number; y: number; z: number }) =>
  Math.hypot(v.x, v.y, v.z);

describe("globe maths", () => {
  it("places points on the unit sphere", () => {
    for (const v of fibonacciSphere(200)) expect(length(v)).toBeCloseTo(1, 6);
  });

  it("spreads lattice points over both hemispheres", () => {
    const points = fibonacciSphere(400);
    expect(points.filter((p) => p.y > 0).length).toBeGreaterThan(180);
    expect(points.filter((p) => p.y < 0).length).toBeGreaterThan(180);
  });

  it("rotation keeps points on the sphere", () => {
    const v = rotate(toVec(0.4, 1.1), 0.7, 0.35);
    expect(length(v)).toBeCloseTo(1, 6);
  });

  it("brings the chosen longitude to the front", () => {
    const bengaluru = PINS[0]!;
    const v = rotate(
      toVec(bengaluru.lat * DEG, bengaluru.lon * DEG),
      faceLongitude(bengaluru.lon),
      0,
    );
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeGreaterThan(0.9);
  });

  it("arcs start and end on their pins and rise between them", () => {
    const [from, to] = THREADS[0]!;
    const a = toVec(PINS[from]!.lat * DEG, PINS[from]!.lon * DEG);
    const b = toVec(PINS[to]!.lat * DEG, PINS[to]!.lon * DEG);
    const points = arc(a, b, 24);
    expect(points).toHaveLength(25);
    expect(points[0]!.x).toBeCloseTo(a.x, 6);
    expect(points[24]!.z).toBeCloseTo(b.z, 6);
    expect(length(points[12]!)).toBeGreaterThan(1);
  });

  it("every thread joins two known pins", () => {
    for (const [from, to] of THREADS) {
      expect(PINS[from]).toBeDefined();
      expect(PINS[to]).toBeDefined();
    }
  });
});
