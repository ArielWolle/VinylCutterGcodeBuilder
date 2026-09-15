import { useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { CanvasArea } from "./components/CanvasArea";
import { GcodePreviewPanel } from "./components/GcodePreviewPanel";
import { LayersPanel } from "./components/LayersPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { MachineSettingsPanel } from "./components/MachineSettingsPanel";
import { GCodePanel } from "./components/GCodePanel";
import { ConsolePanel } from "./components/ConsolePanel";
import { SerialStatusBar } from "./components/SerialStatusBar";
import { useSvgFileImport } from "./hooks/useSvgFileImport";
import { useUiStore } from "./store/uiStore";

type RightTab = "design" | "machine" | "gcode" | "console";

const TABS: { id: RightTab; label: string }[] = [
  { id: "design", label: "Design" },
  { id: "machine", label: "Machine" },
  { id: "gcode", label: "G-code" },
  { id: "console", label: "Console" },
];

export default function App() {
  const [tab, setTab] = useState<RightTab>("design");
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepth = useRef(0);
  const importFiles = useSvgFileImport();
  const mainView = useUiStore((s) => s.mainView);
  const setMainView = useUiStore((s) => s.setMainView);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    // Required so the browser allows dropping instead of opening the file.
    e.preventDefault();
    if (hasFiles(e)) e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    await importFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="app-root"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="app-header">
        <h1>Vinyl Cutter G-code Builder</h1>
        <SerialStatusBar />
      </header>

      <div className="app-body">
        <aside className="left-sidebar">
          <Toolbar />
          <LayersPanel />
        </aside>

        <main className="canvas-container">
          <nav className="main-tab-bar">
            <button className={`main-tab ${mainView === "design" ? "active" : ""}`} onClick={() => setMainView("design")}>
              Design
            </button>
            <button className={`main-tab ${mainView === "gcode" ? "active" : ""}`} onClick={() => setMainView("gcode")}>
              G-code
            </button>
          </nav>
          <div className="canvas-container-body">
            {mainView === "design" ? <CanvasArea /> : <GcodePreviewPanel />}
          </div>
        </main>

        <aside className="right-sidebar">
          <nav className="tab-bar">
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="tab-content">
            {tab === "design" && <PropertiesPanel />}
            {tab === "machine" && <MachineSettingsPanel />}
            {tab === "gcode" && <GCodePanel />}
            {tab === "console" && <ConsolePanel />}
          </div>
        </aside>
      </div>

      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">Drop SVG file(s) to import</div>
        </div>
      )}
    </div>
  );
}

function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}
