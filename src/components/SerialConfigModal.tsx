import { useEffect } from "react";
import { COMMON_BAUD_RATES, useSerialStore } from "../store/serialStore";

export function SerialConfigModal({ onClose }: { onClose: () => void }) {
  const supported = useSerialStore((s) => s.supported);
  const knownPorts = useSerialStore((s) => s.knownPorts);
  const selectedPort = useSerialStore((s) => s.selectedPort);
  const baudRate = useSerialStore((s) => s.baudRate);
  const connected = useSerialStore((s) => s.connected);
  const connecting = useSerialStore((s) => s.connecting);
  const refreshKnownPorts = useSerialStore((s) => s.refreshKnownPorts);
  const requestPort = useSerialStore((s) => s.requestPort);
  const selectPort = useSerialStore((s) => s.selectPort);
  const setBaudRate = useSerialStore((s) => s.setBaudRate);
  const connect = useSerialStore((s) => s.connect);
  const disconnect = useSerialStore((s) => s.disconnect);

  useEffect(() => {
    refreshKnownPorts();
  }, [refreshKnownPorts]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Serial Connection</h3>
          <button className="btn icon-btn" onClick={onClose}>
            {"\u2715"}
          </button>
        </div>

        {!supported && (
          <p className="warning">
            The Web Serial API is not available in this browser. Use a Chromium-based browser
            (Chrome/Edge) served over HTTPS or localhost.
          </p>
        )}

        {supported && (
          <>
            <div className="field">
              <span>COM Port</span>
              <div className="btn-row">
                <select
                  value={selectedPort ? knownPorts.findIndex((p) => p.port === selectedPort) : -1}
                  onChange={(e) => {
                    const idx = parseInt(e.target.value, 10);
                    if (idx >= 0) selectPort(knownPorts[idx].port);
                  }}
                >
                  <option value={-1} disabled>
                    Select a port&hellip;
                  </option>
                  {knownPorts.map((kp, idx) => (
                    <option key={idx} value={idx}>
                      {kp.label}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={requestPort}>
                  + Add new port
                </button>
              </div>
              <p className="muted small">
                Browsers only expose ports you've explicitly granted access to. Click "Add new
                port" to open the OS device picker and choose your cutter's COM port.
              </p>
            </div>

            <label className="field">
              <span>Baud Rate</span>
              <select value={baudRate} onChange={(e) => setBaudRate(parseInt(e.target.value, 10))}>
                {COMMON_BAUD_RATES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <div className="btn-row">
              {!connected ? (
                <button className="btn primary" disabled={!selectedPort || connecting} onClick={connect}>
                  {connecting ? "Connecting\u2026" : "Connect"}
                </button>
              ) : (
                <button className="btn danger" onClick={disconnect}>
                  Disconnect
                </button>
              )}
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
