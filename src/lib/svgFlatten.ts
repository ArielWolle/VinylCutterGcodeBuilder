import { lengthToMm, PX_TO_MM } from "./units";
import type { FlattenedPath } from "../types";

export interface ParsedSvgResult {
  naturalWidthMm: number;
  naturalHeightMm: number;
  /** Paths already normalized: origin at (0,0) = top-left of the combined bbox, in mm, at scale 1. */
  paths: FlattenedPath[];
}

const GEOMETRY_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);

const SKIP_ANCESTOR_TAGS = new Set(["defs", "clipPath", "mask", "symbol", "pattern"]);

function isInsideSkippedAncestor(el: Element, root: Element): boolean {
  let node: Element | null = el.parentElement;
  while (node && node !== root) {
    if (SKIP_ANCESTOR_TAGS.has(node.tagName.toLowerCase())) return true;
    node = node.parentElement;
  }
  return false;
}

function isHidden(el: Element): boolean {
  const style = (el as HTMLElement).style;
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  const displayAttr = el.getAttribute("display");
  if (displayAttr === "none") return true;
  const visAttr = el.getAttribute("visibility");
  if (visAttr === "hidden" || visAttr === "collapse") return true;
  return false;
}

function anyAncestorHidden(el: Element, root: Element): boolean {
  let node: Element | null = el;
  while (node && node !== root.parentElement) {
    if (isHidden(node)) return true;
    if (node === root) break;
    node = node.parentElement;
  }
  return false;
}

/** Determine the document width/height in mm from the width/height attrs, falling back to viewBox. */
function resolveDocSizeMm(svg: SVGSVGElement): { widthMm: number; heightMm: number; vb: { x: number; y: number; w: number; h: number } } {
  const vbAttr = svg.getAttribute("viewBox");
  let vb = { x: 0, y: 0, w: 0, h: 0 };
  if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }

  const widthAttrMm = lengthToMm(svg.getAttribute("width"));
  const heightAttrMm = lengthToMm(svg.getAttribute("height"));

  let widthMm: number;
  let heightMm: number;

  if (widthAttrMm && heightAttrMm) {
    widthMm = widthAttrMm;
    heightMm = heightAttrMm;
    if (vb.w <= 0 || vb.h <= 0) {
      vb = { x: 0, y: 0, w: widthAttrMm / PX_TO_MM, h: heightAttrMm / PX_TO_MM };
    }
  } else if (vb.w > 0 && vb.h > 0) {
    // No explicit physical size: assume viewBox units are px.
    widthMm = vb.w * PX_TO_MM;
    heightMm = vb.h * PX_TO_MM;
  } else {
    // Last resort: use getBBox after attaching to the DOM (handled by caller) - fallback default.
    widthMm = 100;
    heightMm = 100;
    vb = { x: 0, y: 0, w: widthMm / PX_TO_MM, h: heightMm / PX_TO_MM };
  }

  return { widthMm, heightMm, vb };
}

/**
 * Total sampled points across an entire document are capped to this budget so that complex,
 * many-node SVGs (icon packs, traced raster images, etc.) can't blow up import time. The step
 * length is derived from the document's total geometry length divided by this budget, so simple
 * SVGs still get fine (sub-0.35 user-unit) detail while huge ones degrade gracefully instead of
 * freezing the tab.
 */
const TARGET_TOTAL_SAMPLE_POINTS = 12000;
const MIN_STEP_LEN = 0.35;
const MIN_STEPS_PER_SHAPE = 3;
const MAX_STEPS_PER_SHAPE = 1500;

function samplePoints(el: SVGGeometryElement, ctm: DOMMatrix, total: number, stepLen: number): [number, number][] {
  if (!Number.isFinite(total) || total <= 0) {
    // Degenerate (e.g. a point). Still try to sample a single point.
    try {
      const p = el.getPointAtLength(0);
      const tp = p.matrixTransform(ctm);
      return [[tp.x, tp.y]];
    } catch {
      return [];
    }
  }

  let steps = Math.ceil(total / stepLen);
  steps = Math.max(steps, MIN_STEPS_PER_SHAPE);
  steps = Math.min(steps, MAX_STEPS_PER_SHAPE);

  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const len = (i / steps) * total;
    const p = el.getPointAtLength(len);
    const tp = p.matrixTransform(ctm);
    pts.push([tp.x, tp.y]);
  }
  return pts;
}

/** Hands control back to the browser for a frame so it can paint UI updates and stay responsive
 *  during long-running synchronous work like sampling a complex SVG's geometry. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

const YIELD_EVERY_N_ELEMENTS = 25;

/**
 * Elements with no fill and no stroke render nothing visible in the original artwork - these are
 * usually leftover construction/guide geometry (bounding boxes, baseline markers, etc.) from
 * text-to-path or export tools, not intended cut lines, so we skip them.
 */
function isVisuallyInvisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  const opacity = parseFloat(style.opacity || "1");
  if (Number.isFinite(opacity) && opacity <= 0) return true;

  const fill = style.fill;
  const stroke = style.stroke;
  const fillOpacity = parseFloat(style.fillOpacity || "1");
  const strokeOpacity = parseFloat(style.strokeOpacity || "1");

  const fillInvisible = fill === "none" || fill === "transparent" || fillOpacity <= 0;
  const strokeInvisible = stroke === "none" || stroke === "transparent" || strokeOpacity <= 0;

  return fillInvisible && strokeInvisible;
}

function isClosedShape(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "circle" || tag === "ellipse" || tag === "polygon" || tag === "rect") return true;
  if (tag === "path") {
    const d = el.getAttribute("d") || "";
    return /[zZ]\s*$/.test(d.trim());
  }
  return false;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const FIRST_MOVE_RE = /^[Mm]\s*([+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)[\s,]+([+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/;

/**
 * A single <path> "d" attribute can contain multiple subpaths (each starting with its own M/m
 * command) - most commonly an outer contour plus one or more inner "holes" for letters like
 * O, A, R, e, etc. Treating the whole d string as one continuous curve (as getTotalLength /
 * getPointAtLength naturally do) draws a spurious straight line stitching the end of one subpath
 * to the start of the next, cutting straight through the middle of the glyph. This splits a path
 * element into one temporary sibling <path> per subpath (inserted right next to the original, so
 * it inherits the exact same ancestor transforms/CTM), correctly resolving a leading relative
 * "m" against the true end point of the previous subpath.
 */
function splitPathIntoSubpathElements(pathEl: Element): { el: SVGGeometryElement; closed: boolean }[] {
  const d = (pathEl.getAttribute("d") || "").trim();
  if (!d) return [];

  const chunks = d.match(/[Mm][^Mm]*/g);
  if (!chunks || chunks.length <= 1) {
    return [{ el: pathEl as unknown as SVGGeometryElement, closed: /[Zz]\s*$/.test(d) }];
  }

  const parent = pathEl.parentNode;
  if (!parent) return [{ el: pathEl as unknown as SVGGeometryElement, closed: /[Zz]\s*$/.test(d) }];

  const results: { el: SVGGeometryElement; closed: boolean }[] = [];
  let currentEnd: [number, number] | null = null;

  for (const rawChunk of chunks) {
    let chunk = rawChunk;
    const isRelative = chunk[0] === "m";
    const firstMove = FIRST_MOVE_RE.exec(chunk);

    if (isRelative && firstMove && currentEnd) {
      const dx = parseFloat(firstMove[1]);
      const dy = parseFloat(firstMove[2]);
      const ax = currentEnd[0] + dx;
      const ay = currentEnd[1] + dy;
      chunk = `M ${ax} ${ay}` + chunk.slice(firstMove[0].length);
    }

    const tempPath = document.createElementNS(SVG_NS, "path");
    tempPath.setAttribute("d", chunk);
    parent.insertBefore(tempPath, pathEl);

    const closed = /[Zz]\s*$/.test(chunk.trim());
    results.push({ el: tempPath as unknown as SVGGeometryElement, closed });

    // Track this subpath's true end point (in the path's own local/untransformed space) so a
    // relative "m" starting the *next* subpath resolves correctly.
    try {
      const total = tempPath.getTotalLength();
      const end = tempPath.getPointAtLength(total);
      currentEnd = [end.x, end.y];
    } catch {
      currentEnd = null;
    }
  }

  return results;
}

/**
 * Parses raw SVG markup into flattened, mm-space polylines.
 * Uses the browser's native SVG geometry engine (getTotalLength / getPointAtLength / getCTM)
 * so nested transforms, viewBoxes and curve/arc math are all handled correctly for us.
 *
 * This yields back to the browser periodically while sampling, so complex SVGs (many nodes,
 * long curves) take a bit of wall-clock time but never lock up the tab or the UI thread for the
 * whole duration - the app stays responsive and can show an "Importing..." indicator throughout.
 */
export async function parseSvgToPaths(svgText: string): Promise<ParsedSvgResult> {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Could not parse SVG file: invalid XML.");
  }
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (!svg || svg.tagName.toLowerCase() !== "svg") {
    throw new Error("File does not contain a top-level <svg> element.");
  }

  // Must attach to a live document for getCTM/getTotalLength to compute reliably in all browsers.
  const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  host.setAttribute(
    "style",
    "position:absolute; left:-99999px; top:-99999px; width:1px; height:1px; overflow:visible;"
  );
  const imported = document.importNode(svg, true) as unknown as SVGSVGElement;
  host.appendChild(imported);
  document.body.appendChild(host);

  try {
    const { widthMm, heightMm, vb } = resolveDocSizeMm(imported);
    const mmPerUnitX = vb.w > 0 ? widthMm / vb.w : PX_TO_MM;
    const mmPerUnitY = vb.h > 0 ? heightMm / vb.h : PX_TO_MM;

    const all = Array.from(imported.querySelectorAll("*"));

    // Pass 1: gather candidate geometry elements + their CTM/length up front (cheap calls),
    // so we can derive a document-wide sampling budget before doing the expensive
    // getPointAtLength() sampling loop below.
    const candidates: { el: SVGGeometryElement; ctm: DOMMatrix; total: number; closed: boolean }[] = [];
    let totalLenAll = 0;
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const tag = el.tagName.toLowerCase();
      if (!GEOMETRY_TAGS.has(tag)) continue;
      if (isInsideSkippedAncestor(el, imported)) continue;
      if (anyAncestorHidden(el, imported)) continue;
      if (isVisuallyInvisible(el)) continue;

      // A single <path> may contain multiple subpaths (e.g. a letter's outer contour plus an
      // inner hole for O/A/R/etc.) - split those into separate geometry entries up front so they
      // never get stitched together into one continuous curve.
      const subEntries = tag === "path" ? splitPathIntoSubpathElements(el) : [{ el: el as unknown as SVGGeometryElement, closed: isClosedShape(el) }];

      for (const { el: geomEl, closed } of subEntries) {
        if (typeof geomEl.getCTM !== "function" || typeof geomEl.getTotalLength !== "function") continue;
        const ctm = geomEl.getCTM();
        if (!ctm) continue;

        let total = 0;
        try {
          total = geomEl.getTotalLength();
        } catch {
          continue;
        }

        candidates.push({ el: geomEl, ctm, total, closed });
        totalLenAll += Math.max(total, 0);
      }

      if (i % YIELD_EVERY_N_ELEMENTS === 0) await yieldToMain();
    }

    const stepLen = Math.max(MIN_STEP_LEN, totalLenAll / TARGET_TOTAL_SAMPLE_POINTS);

    // Pass 2: sample each shape at a resolution derived from the shared budget above.
    const rawPaths: { points: [number, number][]; closed: boolean }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const { el, ctm, total, closed } = candidates[i];
      const pxPoints = samplePoints(el, ctm, total, stepLen);
      if (pxPoints.length >= 2) {
        // Convert from the root SVG's user-unit space (viewBox units) into mm.
        const mmPoints: [number, number][] = pxPoints.map(([x, y]) => [
          (x - vb.x) * mmPerUnitX,
          (y - vb.y) * mmPerUnitY,
        ]);
        rawPaths.push({ points: mmPoints, closed });
      }

      if (i % YIELD_EVERY_N_ELEMENTS === 0) await yieldToMain();
    }

    if (rawPaths.length === 0) {
      throw new Error("No cuttable geometry (path/rect/circle/ellipse/line/polyline/polygon) found in SVG.");
    }

    // Normalize: shift everything so the combined bbox top-left is (0,0).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of rawPaths) {
      for (const [x, y] of p.points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    const naturalWidthMm = Math.max(maxX - minX, 0.01);
    const naturalHeightMm = Math.max(maxY - minY, 0.01);

    // Normalize to the bbox top-left, then flip Y so local (0,0) is the bottom-left corner and
    // Y increases upward - matching the app's overall Y-up/bottom-left coordinate convention
    // (SVG itself is natively Y-down/top-left).
    const paths: FlattenedPath[] = rawPaths.map((p) => ({
      closed: p.closed,
      points: p.points.map(([x, y]) => [x - minX, naturalHeightMm - (y - minY)] as [number, number]),
    }));

    return { naturalWidthMm, naturalHeightMm, paths };
  } finally {
    document.body.removeChild(host);
  }
}
