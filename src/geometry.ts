import type { OverlayTransform, Point } from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const normalizeTransform = (transform: OverlayTransform): OverlayTransform => ({
  x: Number.isFinite(transform.x) ? transform.x : 0,
  y: Number.isFinite(transform.y) ? transform.y : 0,
  scale: clamp(
    Number.isFinite(transform.scale) ? transform.scale : 1,
    0.1,
    8,
  ),
  rotation: Number.isFinite(transform.rotation) ? transform.rotation : 0,
  opacity: clamp(
    Number.isFinite(transform.opacity) ? transform.opacity : 0.75,
    0.1,
    1,
  ),
});

export const distance = (a: Point, b: Point) =>
  Math.hypot(b.x - a.x, b.y - a.y);

export const angleBetween = (a: Point, b: Point) =>
  Math.atan2(b.y - a.y, b.x - a.x);

export const getImageCenter = (width: number, height: number): Point => ({
  x: width / 2,
  y: height / 2,
});

export const computeTransformFromAnchors = (
  source: [Point, Point],
  target: [Point, Point],
  size: { width: number; height: number },
): OverlayTransform => {
  const sourceDistance = distance(source[0], source[1]);
  const targetDistance = distance(target[0], target[1]);
  const scale = sourceDistance === 0 ? 1 : targetDistance / sourceDistance;
  const rotation = angleBetween(target[0], target[1]) - angleBetween(source[0], source[1]);

  const transformedSource = applyTransform(source[0], { x: 0, y: 0, scale, rotation, opacity: 1 }, size);

  return normalizeTransform({
    x: target[0].x - transformedSource.x,
    y: target[0].y - transformedSource.y,
    scale,
    rotation,
    opacity: 0.75,
  });
};

export const applyTransform = (
  point: Point,
  transform: OverlayTransform,
  size: { width: number; height: number },
): Point => {
  const center = getImageCenter(size.width, size.height);
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  const localX = point.x - center.x;
  const localY = point.y - center.y;

  return {
    x: transform.x + localX * transform.scale * cos - localY * transform.scale * sin,
    y: transform.y + localX * transform.scale * sin + localY * transform.scale * cos,
  };
};
