import { useEffect, useRef } from "react";
import { useDesignStore } from "../store/designStore";
import { useGcodeStore } from "../store/gcodeStore";
import { useSerialStore } from "../store/serialStore";

interface Pt {
  x: number;
  y: number;
}

/**
 * Read-only view of the generated G-code toolpath, drawn on the same grid as the design canvas.
 * Cut (G1) moves and travel (G0) moves are rendered in different colors so you can sanity-check
 * the plan before sending it to the machine.
 */
export function GcodePreviewPanel() {
  const frame = useDesignStore((s) => s.frame);
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const result = useGcodeStore((s) => s.result);
  const jobStatus = useSerialStore((s) => s.job.status);
  const currentPos = useSerialStore((s) => s.job.currentPos);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startPointer: Pt; startPan: Pt } | null>(null);

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

  const toScreen = (wx: number, wy: number): Pt => ({
    x: wx * view.pixelsPerMm + view.panX,
    y: (frame.heightMm - wy) * view.pixelsPerMm + view.panY,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startPointer: { x: e.clientX, y: e.clientY }, startPan: { x: view.panX, y: view.panY } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startPointer.x;
    const dy = e.clientY - dragRef.current.startPointer.y;
    setView({ panX: dragRef.current.startPan.x + dx, panY: dragRef.current.startPan.y + dy });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const gridLines: React.ReactNode[] = [];
  const stepMinor = 10;
  for (let gx = 0; gx <= frame.widthMm + 0.001; gx += stepMinor) {
    const major = Math.round(gx) % 50 === 0;
    gridLines.push(
      <line key={`v${gx}`} x1={gx} y1={0} x2={gx} y2={frame.heightMm} stroke={major ? "#3a4152" : "#262c38"} strokeWidth={major ? 0.6 / view.pixelsPerMm : 0.3 / view.pixelsPerMm} />
    );
  }
  for (let gy = 0; gy <= frame.heightMm + 0.001; gy += stepMinor) {
    const major = Math.round(gy) % 50 === 0;
    gridLines.push(
      <line key={`h${gy}`} x1={0} y1={gy} x2={frame.widthMm} y2={gy} stroke={major ? "#3a4152" : "#262c38"} strokeWidth={major ? 0.6 / view.pixelsPerMm : 0.3 / view.pixelsPerMm} />
    );
  }

  const origin = toScreen(0, 0);
  const originSize = 7;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <rect x={0} y={0} width="100%" height="100%" fill="#161a22" />
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.pixelsPerMm}) translate(0 ${frame.heightMm}) scale(1 -1)`}>
          <rect x={0} y={0} width={frame.widthMm} height={frame.heightMm} fill="#1c212c" />
          {gridLines}
          <rect x={0} y={0} width={frame.widthMm} height={frame.heightMm} fill="none" stroke="#5b8dee" strokeWidth={1.2 / view.pixelsPerMm} />

          {result?.segments.map((seg, i) => (
            <polyline
              key={i}
              points={seg.points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke={seg.type === "cut" ? "#ff6b6b" : "#5b8dee"}
              strokeWidth={(seg.type === "cut" ? 0.4 : 0.25) / view.pixelsPerMm}
              strokeDasharray={seg.type === "travel" ? `${2 / view.pixelsPerMm} ${1.5 / view.pixelsPerMm}` : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>
      </svg>

      <svg className="canvas-overlay">
        <g>
          <line x1={origin.x - originSize} y1={origin.y - originSize} x2={origin.x + originSize} y2={origin.y + originSize} stroke="#ff4d4f" strokeWidth={2} strokeLinecap="round" />
          <line x1={origin.x - originSize} y1={origin.y + originSize} x2={origin.x + originSize} y2={origin.y - originSize} stroke="#ff4d4f" strokeWidth={2} strokeLinecap="round" />
        </g>

        {currentPos &&
          (() => {
            const p = toScreen(currentPos.x, currentPos.y);
            const running = jobStatus === "running";
            return (
              <g className={`cutter-marker${running ? " running" : ""}`}>
                <circle className="cutter-marker-ring" cx={p.x} cy={p.y} r={9} fill="none" stroke="#39d98a" strokeWidth={2} />
                <circle cx={p.x} cy={p.y} r={3} fill="#39d98a" />
              </g>
            );
          })()}
      </svg>

      <div className="gcode-legend">
        <span className="legend-swatch cut" /> Cut (G1)
        <span className="legend-swatch travel" /> Travel (G0)
      </div>

      {currentPos && (
        <div className="cutter-pos-readout">
          <span className={`status-dot ${jobStatus === "running" ? "on" : "off"}`} />
          Cutter: X{currentPos.x.toFixed(2)} Y{currentPos.y.toFixed(2)}
        </div>
      )}

      {!result && (
        <div className="canvas-hint">No G-code generated yet. Use "Generate G-code" in the G-code tab on the right.</div>
      )}
      {result && (
        <div className="canvas-hint">
          {result.pathCount} paths &middot; {result.estimatedLengthMm.toFixed(0)} mm cut &middot; scroll to zoom, drag to pan
        </div>
      )}
    </div>
  );
}
