import { describe, expect, it } from "vitest";
import { applyTransform, computeTransformFromAnchors, normalizeTransform } from "./geometry";

describe("geometry helpers", () => {
  it("normalizes scale and opacity into safe ranges", () => {
    const result = normalizeTransform({
      x: 10,
      y: 20,
      scale: 99,
      rotation: 0,
      opacity: -2,
    });

    expect(result.scale).toBe(8);
    expect(result.opacity).toBe(0.1);
  });

  it("computes a transform that maps anchor points", () => {
    const transform = computeTransformFromAnchors(
      [
        { x: 10, y: 0 },
        { x: 10, y: 20 },
      ],
      [
        { x: 50, y: 50 },
        { x: 90, y: 50 },
      ],
      { width: 20, height: 20 },
    );

    const first = applyTransform({ x: 10, y: 0 }, transform, { width: 20, height: 20 });
    const second = applyTransform({ x: 10, y: 20 }, transform, { width: 20, height: 20 });

    expect(first.x).toBeCloseTo(50, 4);
    expect(first.y).toBeCloseTo(50, 4);
    expect(second.x).toBeCloseTo(90, 4);
    expect(second.y).toBeCloseTo(50, 4);
  });
});
