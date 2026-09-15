// Drag-knife toolpath helpers: blade swivel (offset arc) compensation, overcut, and
// travel/blade-alignment ordering. This is a TypeScript port of the approach used by
// PolyCut (PolyCut.Core/Processors/Cut/OffsetGenerator.vb, OvercutGenerator.vb and
// CutProcessor.vb), simplified to a single pass (no handling for chains of segments
// shorter than the blade radius).

export interface GeoLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Vec2 = [number, number];

const COLLINEARITY_SIN_5DEG = 0.08715572466147; // sin(5 degrees)
const ALIGNMENT_THRESHOLD_COS_25DEG = 0.906;
const ARC_SEGMENTS = 10;
const LOOKAHEAD = 3;
const EPS = 1e-6;

export function lineLength(l: GeoLine): number {
  return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
}

export function lineAngle(l: GeoLine): number {
  return Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
}

export function lineDirection(l: GeoLine): Vec2 {
  const len = lineLength(l) || 1;
  return [(l.x2 - l.x1) / len, (l.y2 - l.y1) / len];
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function isContinuousWith(a: GeoLine, b: GeoLine, eps = EPS): boolean {
  return Math.abs(a.x2 - b.x1) < eps && Math.abs(a.y2 - b.y1) < eps;
}

function isCollinearWith(a: GeoLine, b: GeoLine, sinTol: number): boolean {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const aLen2 = ax * ax + ay * ay;
  const bLen2 = bx * bx + by * by;
  if (aLen2 <= 0 || bLen2 <= 0) return true;
  const cross = ax * by - ay * bx;
  return cross * cross <= sinTol * sinTol * aLen2 * bLen2;
}

/** Converts a closed sequence of points (points[last] assumed ~= points[0]) into GeoLines. */
export function pointsToClosedLoop(points: [number, number][]): GeoLine[] {
  const lines: GeoLine[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) continue;
    lines.push({ x1, y1, x2, y2 });
  }
  return lines;
}

export function pointsToOpenPath(points: [number, number][]): GeoLine[] {
  return pointsToClosedLoop(points);
}

export function linesToPoints(lines: GeoLine[]): [number, number][] {
  if (lines.length === 0) return [];
  const pts: [number, number][] = [[lines[0].x1, lines[0].y1]];
  for (const l of lines) pts.push([l.x2, l.y2]);
  return pts;
}

/**
 * Inserts blade-swivel compensation arcs at sharp corners of a closed loop: each line is
 * extended by the tool radius so the blade tip lands exactly on the true corner, then a short
 * arc (the blade spinning in place around its pivot) reorients the blade for the next segment.
 * Near-collinear corners (<5 degrees) are left untouched since no meaningful swivel is needed.
 */
export function createOffsetArcs(lines: GeoLine[], toolRadius: number): GeoLine[] {
  if (toolRadius <= 0 || lines.length < 2) return lines;

  const working = lines.slice();
  const n = working.length;
  const result: GeoLine[] = [];

  for (let i = 0; i < n; i++) {
    const l1 = working[i];
    const l2 = working[(i + 1) % n];

    if (!isContinuousWith(l1, l2) || isCollinearWith(l1, l2, COLLINEARITY_SIN_5DEG)) {
      result.push(l1);
      continue;
    }

    const thetaA = lineAngle(l1);
    const thetaB = lineAngle(l2);
    const corner: Vec2 = [l1.x2, l1.y2];
    const dirA: Vec2 = [Math.cos(thetaA), Math.sin(thetaA)];
    const dirB: Vec2 = [Math.cos(thetaB), Math.sin(thetaB)];

    // Clamp the swivel radius to a fraction of the shorter adjacent segment so the extension
    // never overshoots past that segment's own far endpoint. Without this, short strokes near a
    // corner (common in text/font outlines) get corrupted into a self-intersecting wedge/loop
    // instead of a clean rounded corner.
    const maxRadius = Math.min(lineLength(l1), lineLength(l2)) * 0.45;
    const radius = Math.min(toolRadius, maxRadius);
    if (radius <= 1e-6) {
      result.push(l1);
      continue;
    }

    const extendedEnd: Vec2 = [corner[0] + radius * dirA[0], corner[1] + radius * dirA[1]];
    result.push({ x1: l1.x1, y1: l1.y1, x2: extendedEnd[0], y2: extendedEnd[1] });

    let delta = thetaB - thetaA;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    let prev = extendedEnd;
    for (let s = 1; s <= ARC_SEGMENTS; s++) {
      const a = thetaA + (delta * s) / ARC_SEGMENTS;
      const pt: Vec2 = [corner[0] + toolRadius * Math.cos(a), corner[1] + toolRadius * Math.sin(a)];
      result.push({ x1: prev[0], y1: prev[1], x2: pt[0], y2: pt[1] });
      prev = pt;
    }

    // Shorten the start of l2 to where the arc actually ended up.
    working[(i + 1) % n] = { x1: prev[0], y1: prev[1], x2: l2.x2, y2: l2.y2 };
  }

  return result;
}

/**
 * Extends the cut past the loop's closing point by `overcut` mm, ensuring the material is
 * fully severed even if the initial pierce point didn't quite connect.
 */
export function createOvercuts(lines: GeoLine[], overcut: number): GeoLine[] {
  if (!lines.length || overcut <= 0) return lines;

  for (let i = 1; i < lines.length; i++) {
    if (!isContinuousWith(lines[i - 1], lines[i])) return lines;
  }
  if (!isContinuousWith(lines[lines.length - 1], lines[0])) return lines;

  const totalPerimeter = lines.reduce((s, l) => s + lineLength(l), 0);
  const requested = Math.min(overcut, totalPerimeter);

  const overcutLines: GeoLine[] = [];
  let remainder = requested;
  let i = 0;
  while (remainder > 0) {
    const l = lines[i];
    const len = lineLength(l);
    remainder -= len;
    const theta = lineAngle(l);
    const p2: Vec2 =
      remainder > 0
        ? [l.x2, l.y2]
        : [l.x1 + (remainder + len) * Math.cos(theta), l.y1 + (remainder + len) * Math.sin(theta)];
    overcutLines.push({ x1: l.x1, y1: l.y1, x2: p2[0], y2: p2[1] });
    i = (i + 1) % lines.length;
  }

  return [...lines, ...overcutLines];
}

/** Rotates a closed loop's starting line so its entry direction best matches the blade's current heading. */
export function reorderLoopForBladeAlignment(loop: GeoLine[], lastBladeDir: Vec2 | null): GeoLine[] {
  if (loop.length < 2) return loop;
  const n = loop.length;
  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let idx = 0; idx < n; idx++) {
    const predIdx = (idx - 1 + n) % n;
    const predDir = lineDirection(loop[predIdx]);
    const currDir = lineDirection(loop[idx]);
    const hasFreeEntry = dot(predDir, currDir) >= ALIGNMENT_THRESHOLD_COS_25DEG;
    const dirScore = lastBladeDir ? dot(lastBladeDir, currDir) : 0;
    const score = (hasFreeEntry ? 10 : 0) + dirScore;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }

  return [...loop.slice(bestIdx), ...loop.slice(0, bestIdx)];
}

export interface PathEntry {
  lines: GeoLine[];
  closed: boolean;
}

/** Greedy nearest-neighbour ordering: minimizes travel by always jumping to the closest next start point. */
export function greedyOrderEntries(entries: PathEntry[]): PathEntry[] {
  if (entries.length <= 1) return entries;
  const remaining = entries.slice();
  const ordered: PathEntry[] = [remaining.shift()!];

  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    const lastEnd = last.lines[last.lines.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const start = remaining[i].lines[0];
      const d = Math.hypot(start.x1 - lastEnd.x2, start.y1 - lastEnd.y2);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered;
}

/**
 * Full toolpath planning pass.
 *
 * `optimizeTravel` runs a pure greedy nearest-neighbour pass to minimize travel distance between
 * cuts - this is the main thing that matters for "why does it jump around", and applies
 * regardless of tool type.
 *
 * `alignBladeDirection` should only be enabled when there's an actual physical drag-knife blade
 * with a real swivel cost (cutMode === "cut" && toolDiameterMm > 0). It re-picks among the next
 * few already-nearby candidates based on entry-direction alignment with the blade's current
 * heading, which reduces swivel wear/time - but it works *against* travel distance, so enabling
 * it when there's no blade to align (toolDiameterMm === 0) only makes the path worse for no
 * benefit at all.
 */
export function planToolpathOrder(entries: PathEntry[], optimizeTravel: boolean, alignBladeDirection: boolean): PathEntry[] {
  const remaining = optimizeTravel ? greedyOrderEntries(entries) : entries.slice();
  if (!alignBladeDirection) return remaining;

  const reordered: PathEntry[] = [];
  let lastBladeDir: Vec2 | null = null;

  while (remaining.length) {
    let bestIdx = 0;
    if (lastBladeDir && remaining.length > 1) {
      const limit = Math.min(LOOKAHEAD, remaining.length);
      let bestScore = -Infinity;
      for (let i = 0; i < limit; i++) {
        const d = lineDirection(remaining[i].lines[0]);
        const score = dot(lastBladeDir, d) * lineLength(remaining[i].lines[0]);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }

    let entry = remaining.splice(bestIdx, 1)[0];
    if (entry.closed) {
      entry = { ...entry, lines: reorderLoopForBladeAlignment(entry.lines, lastBladeDir) };
    }
    reordered.push(entry);
    lastBladeDir = lineDirection(entry.lines[entry.lines.length - 1]);
  }

  return reordered;
}
