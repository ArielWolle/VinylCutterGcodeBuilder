import type { FrameSettings, MachineSettings, SvgItem } from "../types";
import { localToWorld } from "./geometryTransform";
import {
  createOffsetArcs,
  createOvercuts,
  linesToPoints,
  planToolpathOrder,
  pointsToClosedLoop,
  type PathEntry,
} from "./dragKnife";

export interface GcodeSegment {
  type: "travel" | "cut";
  /** Machine-space (mm) points, same coordinate space as the emitted G-code X/Y values. */
  points: [number, number][];
}

export interface GcodeResult {
  lines: string[];
  text: string;
  pathCount: number;
  pointCount: number;
  estimatedLengthMm: number;
  /** Flattened travel (G0) and cut (G1) moves in machine space, for toolpath visualization. */
  segments: GcodeSegment[];
}

function num(n: number, decimals: number): string {
  return n.toFixed(decimals);
}

/**
 * Converts placed SVG items into G-code.
 *
 * Two head-actuation modes are supported, matching converter.py's intent:
 *  - "z": toggles the cutter by moving Z between zUp/zDown.
 *  - "spindle": toggles the cutter using explicit M-codes (default M03/M05) instead
 *     of Z moves, for machines where the "spindle" turns the blade/tool on and off.
 *
 * When cutMode === "cut", closed paths get drag-knife blade-swivel compensation
 * (offset arcs at sharp corners) and an overcut, and the whole job can optionally be
 * reordered for shorter travel + fewer/smaller blade swivels (see lib/dragKnife.ts).
 */
export function generateGcode(
  items: SvgItem[],
  frame: FrameSettings,
  settings: MachineSettings
): GcodeResult {
  const { decimals } = settings;
  const lines: string[] = [];
  let pathCount = 0;
  let pointCount = 0;
  let estimatedLengthMm = 0;

  const toMachine = (x: number, y: number): [number, number] => {
    const mx = x + settings.originOffsetX;
    const my = (settings.invertY ? frame.heightMm - y : y) + settings.originOffsetY;
    return [mx, my];
  };

  const headUp = (): string[] =>
    settings.headActuation === "z" ? [`G0 Z${num(settings.zUp, decimals)}`] : [settings.spindleOffCode];

  const headDown = (zWork: number): string[] =>
    settings.headActuation === "z"
      ? [`G1 Z${num(zWork, decimals)} F${settings.feedRateCutMmMin}`]
      : [settings.spindleOnCode];

  if (settings.startGcode.trim()) {
    lines.push(...settings.startGcode.split(/\r?\n/));
  }
  lines.push("G21 ; millimeters");
  lines.push("G90 ; absolute positioning");
  if (settings.headActuation === "z") {
    lines.push(`G0 Z${num(settings.safeZ, decimals)}`);
  }
  lines.push(...headUp());

  // 1. Build machine-space path entries (open + closed) from every visible item, in layer order.
  const entries: PathEntry[] = [];
  for (const item of items) {
    if (!item.visible || !item.paths) continue;
    for (const path of item.paths) {
      if (path.points.length < 2) continue;
      const machinePts = path.points.map(([lx, ly]) => {
        const world = localToWorld(item, lx, ly);
        return toMachine(world.x, world.y);
      });
      const geoLines = pointsToClosedLoop(machinePts);
      if (geoLines.length === 0) continue;
      entries.push({ lines: geoLines, closed: path.closed });
    }
  }

  // 2. Order entries for minimal travel / blade swivel (if enabled).
  const ordered = planToolpathOrder(entries, settings.optimizeToolpath);

  // 3. Apply drag-knife blade compensation + overcut to closed loops when in cut mode.
  const toolRadius = settings.cutMode === "cut" ? settings.toolDiameterMm / 2 : 0;
  const overcut = settings.cutMode === "cut" ? settings.overcutMm : 0;

  const finalEntries = ordered.map((entry) => {
    if (!entry.closed || settings.cutMode !== "cut") return entry;
    let geoLines = entry.lines;
    if (toolRadius > 0) geoLines = createOffsetArcs(geoLines, toolRadius);
    if (overcut > 0) geoLines = createOvercuts(geoLines, overcut);
    return { ...entry, lines: geoLines };
  });

  // 4. Emit G-code, repeating for the configured number of passes.
  let lastFeedTravel = -1;
  let lastFeedCut = -1;
  const passes = Math.max(1, Math.round(settings.passes));
  const segments: GcodeSegment[] = [];
  let lastPos: [number, number] | null = null;

  for (let passIndex = 0; passIndex < passes; passIndex++) {
    if (passes > 1) lines.push(`; Pass ${passIndex + 1} of ${passes}`);
    const zWork = settings.zDown + passIndex * settings.passHeightDeltaMm;

    for (const entry of finalEntries) {
      const pts = linesToPoints(entry.lines);
      if (pts.length < 2) continue;
      pathCount++;

      const [sx, sy] = pts[0];
      const travelLine =
        lastFeedTravel === settings.feedRateTravelMmMin
          ? `G0 X${num(sx, decimals)} Y${num(sy, decimals)}`
          : `G0 X${num(sx, decimals)} Y${num(sy, decimals)} F${settings.feedRateTravelMmMin}`;
      lines.push(travelLine);
      lastFeedTravel = settings.feedRateTravelMmMin;

      if (lastPos) segments.push({ type: "travel", points: [lastPos, [sx, sy]] });

      lines.push(...headDown(zWork));

      const cutPts: [number, number][] = [[sx, sy]];
      let prev = pts[0];
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = pts[i];
        const cutLine =
          lastFeedCut === settings.feedRateCutMmMin
            ? `G1 X${num(x, decimals)} Y${num(y, decimals)}`
            : `G1 X${num(x, decimals)} Y${num(y, decimals)} F${settings.feedRateCutMmMin}`;
        lines.push(cutLine);
        lastFeedCut = settings.feedRateCutMmMin;
        estimatedLengthMm += Math.hypot(x - prev[0], y - prev[1]);
        prev = [x, y];
        pointCount++;
        cutPts.push([x, y]);
      }
      segments.push({ type: "cut", points: cutPts });
      lastPos = prev;

      lines.push(...headUp());
    }
  }

  if (settings.headActuation === "z") {
    lines.push(`G0 Z${num(settings.safeZ, decimals)}`);
  }
  if (settings.endGcode.trim()) {
    lines.push(...settings.endGcode.split(/\r?\n/));
  }

  return {
    lines,
    text: lines.join("\n") + "\n",
    pathCount,
    pointCount,
    estimatedLengthMm,
    segments,
  };
}

export function estimateJobTimeSeconds(result: GcodeResult, settings: MachineSettings): number {
  // Very rough estimate based on cut feed rate only.
  const mmPerMin = Math.max(settings.feedRateCutMmMin, 1);
  return (result.estimatedLengthMm / mmPerMin) * 60;
}
