import { useMachineStore } from "../store/machineStore";
import type { CutMode, HeadActuationMode } from "../types";

export function MachineSettingsPanel() {
  const settings = useMachineStore((s) => s.settings);
  const updateSettings = useMachineStore((s) => s.updateSettings);
  const resetDefaults = useMachineStore((s) => s.resetDefaults);

  return (
    <div className="panel">
      <h3>Tool Mode</h3>
      <div className="segmented">
        {(["cut", "draw"] as CutMode[]).map((mode) => (
          <button key={mode} className={`segment ${settings.cutMode === mode ? "active" : ""}`} onClick={() => updateSettings({ cutMode: mode })}>
            {mode === "cut" ? "Cut (drag-knife)" : "Draw (pen / foil)"}
          </button>
        ))}
      </div>
      <p className="muted small">
        {settings.cutMode === "cut"
          ? "Settings tuned for cutting materials out with a swivelling drag-knife."
          : "Settings tuned for drawing with a pen, marker, or foil stamping tool (no blade offset applied)."}
      </p>

      <h3>Speeds</h3>
      <div className="field-grid">
        <label className="field">
          <span>Work speed (mm/min)</span>
          <input
            type="number"
            value={settings.feedRateCutMmMin}
            onChange={(e) => updateSettings({ feedRateCutMmMin: parseFloat(e.target.value) || 0 })}
          />
        </label>
        <label className="field">
          <span>Travel speed (mm/min)</span>
          <input
            type="number"
            value={settings.feedRateTravelMmMin}
            onChange={(e) => updateSettings({ feedRateTravelMmMin: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </div>

      <h3>Head Actuation</h3>
      <p className="muted small">
        Choose whether cutter engage/disengage is done via Z-height moves, or via explicit spindle
        on/off G-codes (M03/M05 by default) &mdash; mirroring the converter.py Z&rarr;M03/M05 mapping.
      </p>
      <div className="segmented">
        {(["z", "spindle"] as HeadActuationMode[]).map((mode) => (
          <button
            key={mode}
            className={`segment ${settings.headActuation === mode ? "active" : ""}`}
            onClick={() => updateSettings({ headActuation: mode })}
          >
            {mode === "z" ? "Z-height toggle" : "Spindle M-codes"}
          </button>
        ))}
      </div>

      {settings.headActuation === "z" ? (
        <div className="field-grid">
          <label className="field">
            <span>Work Z (head down, mm)</span>
            <input type="number" step={0.1} value={settings.zDown} onChange={(e) => updateSettings({ zDown: parseFloat(e.target.value) || 0 })} />
          </label>
          <label className="field">
            <span>Travel Z (head up, mm)</span>
            <input type="number" step={0.1} value={settings.zUp} onChange={(e) => updateSettings({ zUp: parseFloat(e.target.value) || 0 })} />
          </label>
          <label className="field">
            <span>Safe Z (start/end, mm)</span>
            <input type="number" step={0.5} value={settings.safeZ} onChange={(e) => updateSettings({ safeZ: parseFloat(e.target.value) || 0 })} />
          </label>
        </div>
      ) : (
        <div className="field-grid">
          <label className="field">
            <span>Head-on code</span>
            <input type="text" value={settings.spindleOnCode} onChange={(e) => updateSettings({ spindleOnCode: e.target.value })} />
          </label>
          <label className="field">
            <span>Head-off code</span>
            <input type="text" value={settings.spindleOffCode} onChange={(e) => updateSettings({ spindleOffCode: e.target.value })} />
          </label>
        </div>
      )}

      <h3>Processing</h3>
      <div className="field-grid">
        <label className="field">
          <span>Number of passes</span>
          <input
            type="number"
            min={1}
            step={1}
            value={settings.passes}
            onChange={(e) => updateSettings({ passes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          />
        </label>
        <label className="field">
          <span>Z offset per pass (mm)</span>
          <input
            type="number"
            step={0.05}
            disabled={settings.headActuation !== "z"}
            value={settings.passHeightDeltaMm}
            onChange={(e) => updateSettings({ passHeightDeltaMm: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={settings.optimizeToolpath} onChange={(e) => updateSettings({ optimizeToolpath: e.target.checked })} />
        <span>
          Optimize toolpath &mdash; reorders cuts for shorter travel and, in Cut mode, aligns entry
          points to reduce blade swivels.
        </span>
      </label>

      {settings.cutMode === "cut" && (
        <>
          <h3>Blade Settings</h3>
          <div className="field-grid">
            <label className="field">
              <span>Tool (blade) diameter (mm)</span>
              <input
                type="number"
                step={0.05}
                value={settings.toolDiameterMm}
                onChange={(e) => updateSettings({ toolDiameterMm: parseFloat(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>Overcut (mm)</span>
              <input
                type="number"
                step={0.1}
                value={settings.overcutMm}
                onChange={(e) => updateSettings({ overcutMm: parseFloat(e.target.value) || 0 })}
              />
            </label>
          </div>
          <p className="muted small">
            Tool diameter compensates for the swivelling part of a drag-knife blade by adding a
            small arc at sharp corners so the blade fully reorients instead of tearing the
            material. Overcut extends closed cuts slightly past their start point to guarantee a
            clean separation. Recommended overcut ~0.5-1mm.
          </p>
        </>
      )}

      <h3>Origin &amp; Axes</h3>
      <div className="field-grid">
        <label className="field">
          <span>X offset (mm)</span>
          <input type="number" value={settings.originOffsetX} onChange={(e) => updateSettings({ originOffsetX: parseFloat(e.target.value) || 0 })} />
        </label>
        <label className="field">
          <span>Y offset (mm)</span>
          <input type="number" value={settings.originOffsetY} onChange={(e) => updateSettings({ originOffsetY: parseFloat(e.target.value) || 0 })} />
        </label>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={settings.invertY} onChange={(e) => updateSettings({ invertY: e.target.checked })} />
        <span>
          Invert Y &mdash; the cutting frame already uses a Y-up, bottom-left origin (0,0) matching
          most machines, so this is usually off. Enable it only if your machine actually expects
          Y-down / top-left coordinates.
        </span>
      </label>

      <h3>Start / End G-code</h3>
      <label className="field">
        <span>Start</span>
        <textarea rows={3} value={settings.startGcode} onChange={(e) => updateSettings({ startGcode: e.target.value })} />
      </label>
      <label className="field">
        <span>End</span>
        <textarea rows={3} value={settings.endGcode} onChange={(e) => updateSettings({ endGcode: e.target.value })} />
      </label>

      <button className="btn small" onClick={resetDefaults}>
        Reset to defaults
      </button>
    </div>
  );
}
