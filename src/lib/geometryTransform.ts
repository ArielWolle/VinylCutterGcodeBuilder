import type { ItemTransform, SvgItem } from "../types";

export interface Point {
  x: number;
  y: number;
}

/**
 * Applies an item's live transform to a local-space point (mm, scale 1, origin at the natural
 * bbox bottom-left, Y increases upward). Mirrors the SVG `translate(x,y) rotate(rotation)
 * scale(sx,sy)` transform order, but rotates about the *center* of the scaled bbox rather than
 * (0,0) so that rotation feels natural in the editor.
 */
export function localToWorld(item: SvgItem, lx: number, ly: number): Point {
  const { transform, naturalWidthMm, naturalHeightMm } = item;
  const { x, y, scaleX, scaleY, rotation } = transform;

  const w = naturalWidthMm * scaleX;
  const h = naturalHeightMm * scaleY;
  const cx = w / 2;
  const cy = h / 2;

  // Scale
  const sx = lx * scaleX;
  const sy = ly * scaleY;

  // Rotate about the center of the scaled bbox
  const rad = (rotation * Math.PI) / 180;
  const dx = sx - cx;
  const dy = sy - cy;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;

  return { x: x + rx, y: y + ry };
}

/** Inverse of localToWorld: converts a world-space (frame mm) point into item-local space. */
export function worldToLocal(item: SvgItem, wx: number, wy: number): Point {
  const { transform, naturalWidthMm, naturalHeightMm } = item;
  const { x, y, scaleX, scaleY, rotation } = transform;

  const w = naturalWidthMm * scaleX;
  const h = naturalHeightMm * scaleY;
  const cx = w / 2;
  const cy = h / 2;

  const rad = (-rotation * Math.PI) / 180;
  const dx = wx - x - cx;
  const dy = wy - y - cy;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;

  return { x: rx / scaleX, y: ry / scaleY };
}

/**
 * World-space center of the item's bbox.
 *
 * IMPORTANT: localToWorld() already multiplies its (lx, ly) arguments by scaleX/scaleY
 * internally, so callers must pass *natural* (unscaled) local coordinates here, not
 * pre-multiplied ones - otherwise the scale gets applied twice (scaleX²), which is invisible
 * at scale 1 but silently breaks every handle/box/resize computation the moment an item is
 * resized.
 */
export function itemCenter(item: SvgItem): Point {
  return localToWorld(item, item.naturalWidthMm / 2, item.naturalHeightMm / 2);
}

/**
 * The 4 corners of the item's (rotated) bbox in world space, walked consistently around the
 * perimeter: local (0,0) [bottom-left], (w,0) [bottom-right], (w,h) [top-right], (0,h) [top-left]
 * - remember local Y increases upward, so "h" is the top edge, not the bottom.
 *
 * Natural (unscaled) dimensions are passed to localToWorld() - see the note on itemCenter().
 */
export function itemWorldCorners(item: SvgItem): [Point, Point, Point, Point] {
  const w = item.naturalWidthMm;
  const h = item.naturalHeightMm;
  return [
    localToWorld(item, 0, 0),
    localToWorld(item, w, 0),
    localToWorld(item, w, h),
    localToWorld(item, 0, h),
  ];
}

/** Axis-aligned world-space bounding box for the item (accounts for rotation). */
export function itemWorldBBox(item: SvgItem): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = itemWorldCorners(item);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function defaultTransform(): ItemTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}
