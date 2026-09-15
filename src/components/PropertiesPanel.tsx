import { useState } from "react";
import { useDesignStore } from "../store/designStore";
import { useFramePresetsStore } from "../store/framePresetsStore";

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

export function PropertiesPanel() {
  const frame = useDesignStore((s) => s.frame);
  const setFrame = useDesignStore((s) => s.setFrame);
  const items = useDesignStore((s) => s.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const updateTransform = useDesignStore((s) => s.updateTransform);

  const presets = useFramePresetsStore((s) => s.presets);
  const savePreset = useFramePresetsStore((s) => s.savePreset);
  const deletePreset = useFramePresetsStore((s) => s.deletePreset);
  const [presetName, setPresetName] = useState("");

  const item = items.find((i) => i.id === selectedId) ?? null;

  const onSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    savePreset(name, frame.widthMm, frame.heightMm);
    setPresetName("");
  };

  return (
    <div className="panel">
      <h3>Cutting Frame</h3>
      <p className="muted small">
        Origin (0,0) is the bottom-left corner. This size is remembered automatically and reloads
        the next time you open the app.
      </p>
      <div className="field-grid">
        <NumberField label="Width (mm)" value={frame.widthMm} min={1} onChange={(v) => setFrame({ widthMm: v })} />
        <NumberField label="Height (mm)" value={frame.heightMm} min={1} onChange={(v) => setFrame({ heightMm: v })} />
      </div>

      <div className="btn-row">
        <input
          type="text"
          placeholder="Preset name (e.g. Cricut 12x12)"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSavePreset()}
        />
        <button className="btn small" onClick={onSavePreset} disabled={!presetName.trim()}>
          Save as preset
        </button>
      </div>

      {presets.length > 0 && (
        <ul className="preset-list">
          {presets.map((p) => (
            <li key={p.id} className="preset-item">
              <button className="preset-load-btn" onClick={() => setFrame({ widthMm: p.widthMm, heightMm: p.heightMm })}>
                {p.name}
                <span className="muted small"> &nbsp;{p.widthMm}&times;{p.heightMm}mm</span>
              </button>
              <button className="icon-toggle danger" title="Delete preset" onClick={() => deletePreset(p.id)}>
                {"\u2715"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Selected Item</h3>
      {!item && <p className="muted">Select an item on the canvas to edit its placement.</p>}
      {item && (
        <>
          <div className="field-grid">
            <NumberField label="X (mm)" value={item.transform.x} onChange={(v) => updateTransform(item.id, { x: v })} />
            <NumberField label="Y (mm)" value={item.transform.y} onChange={(v) => updateTransform(item.id, { y: v })} />
            <NumberField
              label="Width (mm)"
              value={item.naturalWidthMm * item.transform.scaleX}
              min={0.1}
              onChange={(v) => updateTransform(item.id, { scaleX: v / item.naturalWidthMm })}
            />
            <NumberField
              label="Height (mm)"
              value={item.naturalHeightMm * item.transform.scaleY}
              min={0.1}
              onChange={(v) => updateTransform(item.id, { scaleY: v / item.naturalHeightMm })}
            />
            <NumberField label="Rotation (deg)" value={item.transform.rotation} step={1} onChange={(v) => updateTransform(item.id, { rotation: v })} />
          </div>
          <button
            className="btn small"
            onClick={() => {
              const w = item.naturalWidthMm * item.transform.scaleX;
              const h = item.naturalHeightMm * item.transform.scaleY;
              updateTransform(item.id, {
                x: (useDesignStore.getState().frame.widthMm - w) / 2,
                y: (useDesignStore.getState().frame.heightMm - h) / 2,
              });
            }}
          >
            Center on frame
          </button>
        </>
      )}
    </div>
  );
}
