import { useState } from "react";
import { useSerialStore } from "../store/serialStore";
import { SerialConfigModal } from "./SerialConfigModal";

export function SerialStatusBar() {
  const connected = useSerialStore((s) => s.connected);
  const baudRate = useSerialStore((s) => s.baudRate);
  const supported = useSerialStore((s) => s.supported);
  const [open, setOpen] = useState(false);

  return (
    <div className="serial-status-bar">
      <span className={`status-dot ${connected ? "on" : "off"}`} />
      <span className="status-text">
        {!supported ? "Web Serial unsupported" : connected ? `Connected @ ${baudRate} baud` : "Not connected"}
      </span>
      <button className="btn small" onClick={() => setOpen(true)}>
        Serial Settings
      </button>
      {open && <SerialConfigModal onClose={() => setOpen(false)} />}
    </div>
  );
}
