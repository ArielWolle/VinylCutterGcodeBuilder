import { useRef } from "react";
import { useDesignStore } from "../store/designStore";
import { useSvgFileImport } from "../hooks/useSvgFileImport";
import type { EditorTool } from "../types";

const TOOLS: { id: EditorTool; label: string; icon: string }[] = [
  { id: "select", label: "Select / Move", icon: "\u2196" },
  { id: "pan", label: "Pan", icon: "\u270B" },
  { id: "measure", label: "Measure", icon: "\u21F2" },
];

export function Toolbar() {
  const tool = useDesignStore((s) => s.tool);
  const setTool = useDesignStore((s) => s.setTool);
  const importing = useDesignStore((s) => s.importing);
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const frame = useDesignStore((s) => s.frame);
  const clearMeasure = useDesignStore((s) => s.clearMeasure);
  const fileInput = useRef<HTMLInputElement>(null);
  const importFiles = useSvgFileImport();

  const onFiles = async (files: FileList | null) => {
    await importFiles(files);
    if (fileInput.current) fileInput.current.value = "";
  };

  const fitToFrame = () => {
    const el = document.querySelector(".canvas-svg") as SVGSVGElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 40;
    const scale = Math.min((rect.width - margin) / frame.widthMm, (rect.height - margin) / frame.heightMm);
    const pixelsPerMm = Math.max(Math.min(scale, 40), 0.2);
    const panX = (rect.width - frame.widthMm * pixelsPerMm) / 2;
    const panY = (rect.height - frame.heightMm * pixelsPerMm) / 2;
    setView({ pixelsPerMm, panX, panY });
  };

  return (
    <div className="toolbar">
      <input
        ref={fileInput}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        style={{ display: "none" }}
        onChange={(e) => onFiles(e.target.files)}
      />
      <button className="btn primary" disabled={importing} onClick={() => fileInput.current?.click()}>
        {importing ? "Importing\u2026" : "Import SVG"}
      </button>

      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`btn icon-btn ${tool === t.id ? "active" : ""}`}
            title={t.label}
            onClick={() => {
              setTool(t.id);
              if (t.id !== "measure") clearMeasure();
            }}
          >
            {t.icon}
          </button>
        ))}
        {tool === "measure" && (
          <button className="btn" onClick={clearMeasure}>
            Clear measurement
          </button>
        )}
      </div>

      <div className="toolbar-group">
        <button className="btn icon-btn" title="Zoom out" onClick={() => setView({ pixelsPerMm: Math.max(view.pixelsPerMm / 1.25, 0.2) })}>
          -
        </button>
        <span className="zoom-label">{view.pixelsPerMm.toFixed(2)} px/mm</span>
        <button className="btn icon-btn" title="Zoom in" onClick={() => setView({ pixelsPerMm: Math.min(view.pixelsPerMm * 1.25, 40) })}>
          +
        </button>
        <button className="btn" onClick={fitToFrame}>
          Fit
        </button>
      </div>
    </div>
  );
}
