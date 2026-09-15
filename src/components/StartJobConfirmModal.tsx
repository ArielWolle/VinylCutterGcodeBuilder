import { useEffect, useState } from "react";
import { useSerialStore } from "../store/serialStore";

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown right before a job starts sending, so the user double-checks the blade/pen is actually
 * where they expect the job to begin. X usually has a home switch/limit; Y on a roll-fed vinyl
 * cutter typically has unlimited travel and no fixed home, so instead of "Home Y" this offers
 * jog controls to manually move Y to the desired starting position.
 */
export function StartJobConfirmModal({ onConfirm, onCancel }: Props) {
  const queryPosition = useSerialStore((s) => s.queryPosition);
  const sendCommand = useSerialStore((s) => s.sendCommand);
  const jogAxis = useSerialStore((s) => s.jogAxis);
  const [pos, setPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [jogStep, setJogStep] = useState(10);

  const refresh = async () => {
    setChecking(true);
    const p = await queryPosition();
    setPos(p);
    setChecking(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Check Cutter Position</h3>
          <button className="btn icon-btn" onClick={onCancel}>
            {"\u2715"}
          </button>
        </div>

        <p className="muted small">
          Before starting, confirm the blade/pen is positioned where you expect this job to begin.
          X usually has a home switch; Y on most roll-fed vinyl cutters has unlimited travel with
          no fixed home, so jog it to your starting position instead.
        </p>

        <div className="field">
          <span>Current position</span>
          <div className="btn-row">
            <span className="muted small">
              {checking
                ? "Checking\u2026"
                : pos
                ? `X${pos.x.toFixed(2)}  Y${pos.y.toFixed(2)}  Z${pos.z.toFixed(2)}`
                : "Unknown (no status response from controller)"}
            </span>
            <button className="btn small" onClick={refresh} disabled={checking}>
              Refresh
            </button>
          </div>
        </div>

        <div className="field">
          <span>X axis</span>
          <div className="btn-row">
            <button className="btn small" onClick={() => sendCommand("$H")}>
              Home X ($H)
            </button>
          </div>
        </div>

        <div className="field">
          <span>Y axis (no home - unlimited travel, jog instead)</span>
          <div className="btn-row">
            <input
              type="number"
              value={jogStep}
              min={0.1}
              step={1}
              onChange={(e) => setJogStep(parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
            <span className="muted small">mm</span>
            <button className="btn small" onClick={() => jogAxis("Y", -jogStep)}>
              {"\u2190"} Y-
            </button>
            <button className="btn small" onClick={() => jogAxis("Y", jogStep)}>
              Y+ {"\u2192"}
            </button>
          </div>
        </div>

        <div className="btn-row">
          <button className="btn primary" onClick={onConfirm}>
            Position looks good &mdash; Start Job
          </button>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
