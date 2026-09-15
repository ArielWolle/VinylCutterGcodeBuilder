import { useState } from "react";
import { useDesignStore } from "../store/designStore";
import { useMachineStore } from "../store/machineStore";
import { useSerialStore } from "../store/serialStore";
import { useGcodeStore } from "../store/gcodeStore";
import { useUiStore } from "../store/uiStore";
import { estimateJobTimeSeconds, generateGcode } from "../lib/gcode";

export function GCodePanel() {
  const frame = useDesignStore((s) => s.frame);
  const items = useDesignStore((s) => s.items);
  const settings = useMachineStore((s) => s.settings);
  const connected = useSerialStore((s) => s.connected);
  const jobStatus = useSerialStore((s) => s.job.status);
  const jobCurrentLine = useSerialStore((s) => s.job.currentLine);
  const jobTotalLines = useSerialStore((s) => s.job.totalLines);
  const startJob = useSerialStore((s) => s.startJob);
  const pauseJob = useSerialStore((s) => s.pauseJob);
  const resumeJob = useSerialStore((s) => s.resumeJob);
  const stopJob = useSerialStore((s) => s.stopJob);

  const result = useGcodeStore((s) => s.result);
  const setResult = useGcodeStore((s) => s.setResult);
  const setMainView = useUiStore((s) => s.setMainView);
  const [waitForAck, setWaitForAck] = useState(true);

  const canGenerate = items.some((i) => i.visible);

  const regenerate = () => {
    const res = generateGcode(items, frame, settings);
    setResult(res);
    // Jump to the G-code toolpath view so the user immediately sees what was generated.
    setMainView("gcode");
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cut.gcode";
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendToMachine = async () => {
    if (!result) return;
    await startJob(result.lines, { waitForAck });
  };

  const jobRunning = jobStatus === "running" || jobStatus === "paused";

  return (
    <div className="panel">
      <h3>G-code</h3>
      <button className="btn primary" onClick={regenerate} disabled={!canGenerate}>
        Generate G-code
      </button>
      {!canGenerate && <p className="muted small">Import and place at least one visible SVG first.</p>}

      {result && (
        <>
          <div className="stat-row">
            <span>{result.pathCount} paths</span>
            <span>{result.lines.length} lines</span>
            <span>{result.estimatedLengthMm.toFixed(0)} mm cut</span>
            <span>~{Math.ceil(estimateJobTimeSeconds(result, settings) / 60)} min</span>
          </div>
          <textarea className="gcode-preview" readOnly rows={12} value={result.text} />
          <div className="btn-row">
            <button className="btn" onClick={download}>
              Download .gcode
            </button>
          </div>

          <h3>Send to Machine</h3>
          <label className="checkbox-field">
            <input type="checkbox" checked={waitForAck} onChange={(e) => setWaitForAck(e.target.checked)} />
            <span>Wait for "ok" acknowledgement between lines</span>
          </label>
          {!jobRunning ? (
            <button className="btn primary" onClick={sendToMachine} disabled={!connected}>
              {connected ? "Send G-code over serial" : "Connect a serial device first"}
            </button>
          ) : (
            <div className="job-controls">
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${jobTotalLines ? (jobCurrentLine / jobTotalLines) * 100 : 0}%` }} />
              </div>
              <span className="muted small">
                Line {jobCurrentLine + 1} / {jobTotalLines} &mdash; {jobStatus}
              </span>
              <div className="btn-row">
                {jobStatus === "running" ? (
                  <button className="btn" onClick={pauseJob}>
                    Pause
                  </button>
                ) : (
                  <button className="btn" onClick={resumeJob}>
                    Resume
                  </button>
                )}
                <button className="btn danger" onClick={stopJob}>
                  Stop
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
