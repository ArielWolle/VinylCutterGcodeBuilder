import { useCallback, useEffect, useRef, useState } from "react";
import { useDesignStore } from "../store/designStore";
import { itemCenter, itemWorldCorners, localToWorld } from "../lib/geometryTransform";
import type { SvgItem } from "../types";

interface Pt {
  x: number;
  y: number;
}

type DragMode =
  | { kind: "move"; id: string; startPointer: Pt; startTransformXY: Pt }
  | {
      kind: "resize";
      id: string;
      corner: number;
      /** World position of the opposite corner, which must stay fixed while resizing. */
      anchorWorld: Pt;
      /** Pointer world position at drag start, used to track the raw drag delta. */
      startPointerWorld: Pt;
      /** World position of the grabbed corner at drag start (may differ slightly from the
       *  pointer position if the click landed within the handle's hit-tolerance, not dead center). */
      startHandleWorld: Pt;
      rotationRad: number;
      naturalW: number;
      naturalH: number;
    }
  | { kind: "rotate"; id: string; center: Pt }
  | { kind: "pan"; startPointer: Pt; startPan: Pt }
  | null;

/** Natural-unit corner flags (0/1 along each axis), matching itemWorldCorners' [TL,TR,BR,BL] order. */
const CORNER_FLAGS: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const HANDLE_R = 6;
const ROTATE_OFFSET_PX = 26;

export function CanvasArea() {
  const frame = useDesignStore((s) => s.frame);
  const items = useDesignStore((s) => s.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const tool = useDesignStore((s) => s.tool);
  const view = useDesignStore((s) => s.view);
  const measure = useDesignStore((s) => s.measure);
  const importing = useDesignStore((s) => s.importing);
  const selectItem = useDesignStore((s) => s.selectItem);
  const updateTransform = useDesignStore((s) => s.updateTransform);
  const setView = useDesignStore((s) => s.setView);
  const setMeasurePoint = useDesignStore((s) => s.setMeasurePoint);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragMode>(null);
  const [, forceRender] = useState(0);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  // World space uses a Y-up, bottom-left origin (0,0), matching most cutter/plotter machine
  // coordinate conventions. Screen space is the usual Y-down pixel space, so the Y axis is
  // flipped (about the frame height) when converting between the two.
  const toWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return { x: (sx - view.panX) / view.pixelsPerMm, y: frame.heightMm - (sy - view.panY) / view.pixelsPerMm };
    },
    [view, frame.heightMm]
  );

  const toScreen = useCallback(
    (wx: number, wy: number): Pt => ({
      x: wx * view.pixelsPerMm + view.panX,
      y: (frame.heightMm - wy) * view.pixelsPerMm + view.panY,
    }),
    [view, frame.heightMm]
  );

  const hitTestItem = useCallback(
    (world: Pt): SvgItem | null => {
      // Test topmost (last) item first.
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item.visible) continue;
        const corners = itemWorldCorners(item);
        if (pointInPolygon(world, corners)) return item;
      }
      return null;
    },
    [items]
  );

  // React attaches onWheel as a passive listener, so preventDefault() inside it is a no-op (and
  // logs a warning). We need a real non-passive listener to stop the page from scrolling while
  // zooming, so it's wired up manually via useEffect below instead of a JSX onWheel prop.
  const viewRef = useRef(view);
  viewRef.current = view;
  const frameHeightRef = useRef(frame.heightMm);
  frameHeightRef.current = frame.heightMm;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const v = viewRef.current;
      const H = frameHeightRef.current;
      const worldBeforeX = (cx - v.panX) / v.pixelsPerMm;
      const worldBeforeY = H - (cy - v.panY) / v.pixelsPerMm;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(Math.max(v.pixelsPerMm * factor, 0.2), 40);
      const panX = cx - worldBeforeX * next;
      const panY = cy - (H - worldBeforeY) * next;
      setView({ pixelsPerMm: next, panX, panY });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [setView]);

  const beginMove = (item: SvgItem, world: Pt) => {
    dragRef.current = {
      kind: "move",
      id: item.id,
      startPointer: world,
      startTransformXY: { x: item.transform.x, y: item.transform.y },
    };
  };

  const beginResize = (item: SvgItem, corner: number, pointerWorld: Pt) => {
    const corners = itemWorldCorners(item);
    dragRef.current = {
      kind: "resize",
      id: item.id,
      corner,
      anchorWorld: corners[(corner + 2) % 4],
      startPointerWorld: pointerWorld,
      startHandleWorld: corners[corner],
      rotationRad: (item.transform.rotation * Math.PI) / 180,
      naturalW: item.naturalWidthMm,
      naturalH: item.naturalHeightMm,
    };
  };

  const beginRotate = (item: SvgItem) => {
    dragRef.current = { kind: "rotate", id: item.id, center: itemCenter(item) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const world = toWorld(e.clientX, e.clientY);

    if (tool === "measure") {
      if (!measure.a || (measure.a && measure.b)) {
        setMeasurePoint("a", world);
        setMeasurePoint("b", null);
      } else {
        setMeasurePoint("b", world);
      }
      return;
    }

    if (tool === "pan" || e.button === 1) {
      dragRef.current = { kind: "pan", startPointer: { x: e.clientX, y: e.clientY }, startPan: { x: view.panX, y: view.panY } };
      return;
    }

    // Check handles of the currently-selected item first.
    if (selectedItem && !selectedItem.locked) {
      const corners = itemWorldCorners(selectedItem);
      for (let c = 0; c < 4; c++) {
        const screen = toScreen(corners[c].x, corners[c].y);
        if (dist(screen, { x: e.clientX - offsetLeft(svgRef), y: e.clientY - offsetTop(svgRef) }) < HANDLE_R + 4) {
          beginResize(selectedItem, c, world);
          return;
        }
      }
      const rotateWorld = rotateHandleWorld(selectedItem);
      const rotateScreen = toScreen(rotateWorld.x, rotateWorld.y);
      if (dist(rotateScreen, { x: e.clientX - offsetLeft(svgRef), y: e.clientY - offsetTop(svgRef) }) < HANDLE_R + 4) {
        beginRotate(selectedItem);
        return;
      }
    }

    const hit = hitTestItem(world);
    if (hit) {
      if (selectedId !== hit.id) selectItem(hit.id);
      if (!hit.locked) beginMove(hit, world);
    } else {
      selectItem(null);
      // Clicking empty grid space pans the view, like most canvas editors.
      dragRef.current = { kind: "pan", startPointer: { x: e.clientX, y: e.clientY }, startPan: { x: view.panX, y: view.panY } };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const world = toWorld(e.clientX, e.clientY);

    if (drag.kind === "pan") {
      const dx = e.clientX - drag.startPointer.x;
      const dy = e.clientY - drag.startPointer.y;
      setView({ panX: drag.startPan.x + dx, panY: drag.startPan.y + dy });
      return;
    }

    if (drag.kind === "move") {
      const dx = world.x - drag.startPointer.x;
      const dy = world.y - drag.startPointer.y;
      updateTransform(drag.id, { x: drag.startTransformXY.x + dx, y: drag.startTransformXY.y + dy });
      return;
    }

    if (drag.kind === "resize") {
      // Track the raw mouse delta so the grabbed corner follows the cursor exactly, regardless
      // of exactly where within the handle's hit-tolerance the initial click landed.
      const dxPointer = world.x - drag.startPointerWorld.x;
      const dyPointer = world.y - drag.startPointerWorld.y;
      const newHandleWorld: Pt = {
        x: drag.startHandleWorld.x + dxPointer,
        y: drag.startHandleWorld.y + dyPointer,
      };

      // Express the new handle position relative to the fixed opposite-corner anchor, in the
      // shape's own (rotated) axes, to get the new scaled width/height.
      const vx = newHandleWorld.x - drag.anchorWorld.x;
      const vy = newHandleWorld.y - drag.anchorWorld.y;
      const r = -drag.rotationRad;
      const localX = vx * Math.cos(r) - vy * Math.sin(r);
      const localY = vx * Math.sin(r) + vy * Math.cos(r);

      let newScaleX = Math.max(Math.abs(localX) / drag.naturalW, 0.02);
      let newScaleY = Math.max(Math.abs(localY) / drag.naturalH, 0.02);

      // Default: keep aspect ratio locked (best for logos/text). Hold Shift to resize freely.
      if (!e.shiftKey) {
        const factor = Math.max(newScaleX, newScaleY);
        newScaleX = factor;
        newScaleY = factor;
      }

      const newScaledW = newScaleX * drag.naturalW;
      const newScaledH = newScaleY * drag.naturalH;

      // Re-solve x/y (the top-left-at-rotation-0 reference point) so the opposite corner stays
      // exactly fixed at anchorWorld, regardless of rotation.
      const [fx, fy] = CORNER_FLAGS[drag.corner];
      const ax = newScaledW * (0.5 - fx);
      const ay = newScaledH * (0.5 - fy);
      const rot = drag.rotationRad;
      const rax = ax * Math.cos(rot) - ay * Math.sin(rot);
      const ray = ax * Math.sin(rot) + ay * Math.cos(rot);
      const centerX = drag.anchorWorld.x - rax;
      const centerY = drag.anchorWorld.y - ray;

      updateTransform(drag.id, {
        scaleX: newScaleX,
        scaleY: newScaleY,
        x: centerX - newScaledW / 2,
        y: centerY - newScaledH / 2,
      });
      return;
    }

    if (drag.kind === "rotate") {
      const dx = world.x - drag.center.x;
      const dy = world.y - drag.center.y;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      if (!e.shiftKey) {
        // Magnetic snap: lock to the nearest 15-degree increment only when close to it,
        // otherwise allow free rotation in between. Hold Shift to disable snapping entirely.
        const nearest = Math.round(deg / 15) * 15;
        if (Math.abs(angleDiff(deg, nearest)) < 4) {
          deg = ((nearest % 360) + 360) % 360;
        }
      }
      updateTransform(drag.id, { rotation: deg });
      return;
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    forceRender((n) => n + 1);
  };

  const rotateHandleWorld = (item: SvgItem): Pt => {
    // Local Y increases upward (bottom-left origin), so the top edge is at y = naturalHeightMm;
    // the handle sits a fixed screen-pixel distance beyond that edge.
    const offsetMm = ROTATE_OFFSET_PX / view.pixelsPerMm;
    return localToWorld(item, item.naturalWidthMm / 2, item.naturalHeightMm + offsetMm / item.transform.scaleY);
  };

  // --- Rendering ---

  const frameTL = toScreen(0, 0);
  const frameBR = toScreen(frame.widthMm, frame.heightMm);

  const gridLines: React.ReactNode[] = [];
  const stepMinor = 10;
  for (let gx = 0; gx <= frame.widthMm + 0.001; gx += stepMinor) {
    const major = Math.round(gx) % 50 === 0;
    gridLines.push(
      <line
        key={`v${gx}`}
        x1={gx}
        y1={0}
        x2={gx}
        y2={frame.heightMm}
        stroke={major ? "#3a4152" : "#262c38"}
        strokeWidth={major ? 0.6 / view.pixelsPerMm : 0.3 / view.pixelsPerMm}
      />
    );
  }
  for (let gy = 0; gy <= frame.heightMm + 0.001; gy += stepMinor) {
    const major = Math.round(gy) % 50 === 0;
    gridLines.push(
      <line
        key={`h${gy}`}
        x1={0}
        y1={gy}
        x2={frame.widthMm}
        y2={gy}
        stroke={major ? "#3a4152" : "#262c38"}
        strokeWidth={major ? 0.6 / view.pixelsPerMm : 0.3 / view.pixelsPerMm}
      />
    );
  }

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={`canvas-svg tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <rect x={0} y={0} width="100%" height="100%" fill="#161a22" />
        {/* World space is Y-up with origin at the bottom-left; screen space is Y-down, so we
            flip Y (about the frame height) here once for the whole scene - frame, grid and
            every item nest inside this single transform and inherit the flip consistently. */}
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.pixelsPerMm}) translate(0 ${frame.heightMm}) scale(1 -1)`}>
          <rect x={0} y={0} width={frame.widthMm} height={frame.heightMm} fill="#1c212c" />
          {gridLines}
          <rect
            x={0}
            y={0}
            width={frame.widthMm}
            height={frame.heightMm}
            fill="none"
            stroke="#5b8dee"
            strokeWidth={1.2 / view.pixelsPerMm}
          />

          {items.map((item) => {
            if (!item.visible) return null;
            // Rotate about the center of the *scaled* bbox (cx,cy), matching the math in
            // geometryTransform.ts, so the rendered shape stays in sync with the selection
            // outline/handles as it spins.
            const cx = (item.naturalWidthMm * item.transform.scaleX) / 2;
            const cy = (item.naturalHeightMm * item.transform.scaleY) / 2;
            const transform = `translate(${item.transform.x} ${item.transform.y}) rotate(${item.transform.rotation} ${cx} ${cy}) scale(${item.transform.scaleX} ${item.transform.scaleY})`;
            const isSelected = item.id === selectedId;
            return (
              <g key={item.id} transform={transform} opacity={item.locked ? 0.6 : 1}>
                {item.paths.map((p, idx) => (
                  <polyline
                    key={idx}
                    points={p.points.map(([x, y]) => `${x},${y}`).join(" ")}
                    fill="none"
                    stroke={isSelected ? "#ffb347" : "#e7ecf5"}
                    strokeWidth={0.35 / (view.pixelsPerMm * item.transform.scaleX)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Screen-space overlay: selection outline, handles, measure tool, frame size label */}
      <svg className="canvas-overlay">
        {(() => {
          const origin = toScreen(0, 0);
          const s = 7;
          return (
            <g>
              <line x1={origin.x - s} y1={origin.y - s} x2={origin.x + s} y2={origin.y + s} stroke="#ff4d4f" strokeWidth={2} strokeLinecap="round" />
              <line x1={origin.x - s} y1={origin.y + s} x2={origin.x + s} y2={origin.y - s} stroke="#ff4d4f" strokeWidth={2} strokeLinecap="round" />
            </g>
          );
        })()}

        {selectedItem &&
          (() => {
            const corners = itemWorldCorners(selectedItem).map((c) => toScreen(c.x, c.y));
            const rotateW = rotateHandleWorld(selectedItem);
            const rotateS = toScreen(rotateW.x, rotateW.y);
            const path = corners.map((c) => `${c.x},${c.y}`).join(" ");
            const widthMm = selectedItem.naturalWidthMm * selectedItem.transform.scaleX;
            const heightMm = selectedItem.naturalHeightMm * selectedItem.transform.scaleY;
            // corners[0]/[1] = bottom edge, corners[0]/[3] = left edge (local Y increases upward).
            const bottomMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
            const leftMid = { x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 };
            return (
              <g>
                <polygon points={path} fill="none" stroke="#ffb347" strokeWidth={1.5} strokeDasharray="4 3" />

                <g>
                  <rect x={bottomMid.x - 62} y={bottomMid.y + 10} width={124} height={18} rx={3} fill="#10141b" stroke="#ffb347" strokeWidth={1} />
                  <text x={bottomMid.x} y={bottomMid.y + 23} textAnchor="middle" fill="#ffb347" fontSize={10.5}>
                    {formatDim(widthMm)}
                  </text>
                </g>
                <g>
                  <rect x={leftMid.x - 116} y={leftMid.y - 9} width={110} height={18} rx={3} fill="#10141b" stroke="#ffb347" strokeWidth={1} />
                  <text x={leftMid.x - 61} y={leftMid.y + 4} textAnchor="middle" fill="#ffb347" fontSize={10.5}>
                    {formatDim(heightMm)}
                  </text>
                </g>

                {!selectedItem.locked && (
                  <>
                    {/* corners[2]/[3] are the top edge (local y = naturalHeightMm, since local Y increases upward) */}
                    <line x1={(corners[2].x + corners[3].x) / 2} y1={(corners[2].y + corners[3].y) / 2} x2={rotateS.x} y2={rotateS.y} stroke="#ffb347" strokeWidth={1.5} />
                    {corners.map((c, i) => (
                      <rect key={i} x={c.x - HANDLE_R} y={c.y - HANDLE_R} width={HANDLE_R * 2} height={HANDLE_R * 2} fill="#1c212c" stroke="#ffb347" strokeWidth={1.5} style={{ cursor: "nwse-resize" }} />
                    ))}
                    <circle cx={rotateS.x} cy={rotateS.y} r={HANDLE_R} fill="#1c212c" stroke="#ffb347" strokeWidth={1.5} style={{ cursor: "grab" }} />
                  </>
                )}
                {dragRef.current?.kind === "rotate" && dragRef.current.id === selectedItem.id && (
                  <g>
                    <rect x={rotateS.x - 26} y={rotateS.y - 34} width={52} height={20} rx={4} fill="#10141b" stroke="#ffb347" />
                    <text x={rotateS.x} y={rotateS.y - 20} textAnchor="middle" fill="#ffb347" fontSize={12}>
                      {`${selectedItem.transform.rotation.toFixed(1)}\u00B0`}
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

        {measure.a &&
          (() => {
            const a = toScreen(measure.a.x, measure.a.y);
            const b = measure.b ? toScreen(measure.b.x, measure.b.y) : null;
            const d = measure.b ? Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y) : 0;
            return (
              <g>
                <circle cx={a.x} cy={a.y} r={4} fill="#39d98a" />
                {b && (
                  <>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#39d98a" strokeWidth={2} strokeDasharray="6 4" />
                    <circle cx={b.x} cy={b.y} r={4} fill="#39d98a" />
                    <rect x={(a.x + b.x) / 2 - 34} y={(a.y + b.y) / 2 - 22} width={68} height={20} rx={4} fill="#10141b" stroke="#39d98a" />
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" fill="#39d98a" fontSize={12}>
                      {d.toFixed(2)} mm
                    </text>
                  </>
                )}
              </g>
            );
          })()}
      </svg>

      {importing && (
        <div className="canvas-importing-banner">
          <span className="spinner" /> Importing SVG&hellip; (large/complex files may take a few seconds)
        </div>
      )}

      <div className="canvas-hint">
        {tool === "measure"
          ? "Measure: click two points to see the distance."
          : tool === "pan"
          ? "Pan: drag to move the view."
          : "Select: drag body to move, corner handle to resize (Shift = free aspect), top handle to rotate."}
      </div>
    </div>
  );
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Formats a millimeter dimension as "123.4mm (4.86in)" for on-canvas size labels. */
function formatDim(mm: number): string {
  const inches = mm / 25.4;
  return `${mm.toFixed(1)}mm (${inches.toFixed(2)}in)`;
}

/** Smallest signed difference (in degrees, range -180..180) between two angles. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function offsetLeft(ref: React.RefObject<SVGSVGElement>): number {
  return ref.current?.getBoundingClientRect().left ?? 0;
}
function offsetTop(ref: React.RefObject<SVGSVGElement>): number {
  return ref.current?.getBoundingClientRect().top ?? 0;
}
