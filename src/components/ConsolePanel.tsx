import { useEffect, useRef, useState } from "react";
import { useSerialStore } from "../store/serialStore";

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m ${sec}s`;
  return `${h}h ${min}m`;
}

export function ConsolePanel() {
  const logs = useSerialStore((s) => s.logs);
  const connected = useSerialStore((s) => s.connected);
  const sendCommand = useSerialStore((s) => s.sendCommand);
  const clearLogs = useSerialStore((s) => s.clearLogs);
  const needsUnlock = useSerialStore((s) => s.needsUnlock);
  const job = useSerialStore((s) => s.job);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const [, forceTick] = useState(0);

  // Newest messages are shown at the top, so scroll to the top when new ones arrive.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [logs.length]);

  // Re-render periodically while a job is running so the elapsed/ETA readout keeps ticking.
  useEffect(() => {
    if (job.status !== "running") return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [job.status]);

  const submit = () => {
    const text = cmd.trim();
    if (!text) return;
    sendCommand(text);
    setHistory((h) => [...h, text]);
    setHistoryIdx(-1);
    setCmd("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setCmd(history[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx < 0) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx >= history.length) {
        setHistoryIdx(-1);
        setCmd("");
      } else {
        setHistoryIdx(nextIdx);
        setCmd(history[nextIdx]);
      }
    }
  };

  const jobRunning = job.status === "running" || job.status === "paused";
  let elapsedSec = 0;
  let etaSec: number | null = null;
  let percent = 0;
  if (jobRunning && job.startedAt && job.totalLines > 0) {
    elapsedSec = (Date.now() - job.startedAt) / 1000;
    percent = (job.currentLine / job.totalLines) * 100;
    if (job.currentLine > 0) {
      const estTotalSec = elapsedSec * (job.totalLines / job.currentLine);
      etaSec = Math.max(estTotalSec - elapsedSec, 0);
    }
  }

  return (
    <div className="panel console-panel">
      <div className="panel-header-row">
        <h3>Serial Console</h3>
        <button className="btn small" onClick={clearLogs}>
          Clear
        </button>
      </div>

      {needsUnlock && (
        <div className="unlock-banner">
          <span>Controller reports an alarm/lock state and needs unlocking before it will move.</span>
          <div className="btn-row">
            <button className="btn small" onClick={() => sendCommand("$X")}>
              Unlock ($X)
            </button>
            <button className="btn small" onClick={() => sendCommand("$H")}>
              Home ($H)
            </button>
          </div>
        </div>
      )}

      {jobRunning && (
        <div className="job-progress-banner">
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${job.totalLines ? (job.currentLine / job.totalLines) * 100 : 0}%` }} />
          </div>
          <div className="job-progress-stats">
            <span>
              Line {job.currentLine + 1}/{job.totalLines} ({percent.toFixed(0)}%)
            </span>
            <span>Elapsed {formatDuration(elapsedSec)}</span>
            <span>ETA {etaSec === null ? "calculating\u2026" : formatDuration(etaSec)}</span>
          </div>
        </div>
      )}

      <div className="console-log" ref={listRef}>
        {logs.length === 0 && <p className="muted">No activity yet.</p>}
        {logs
          .slice()
          .reverse()
          .map((l) => (
            <div key={l.id} className={`console-line dir-${l.dir}`}>
              <span className="console-ts">{new Date(l.ts).toLocaleTimeString()}</span>
              <span className="console-dir">{l.dir === "tx" ? ">" : l.dir === "rx" ? "<" : "*"}</span>
              <span className="console-text">{l.text}</span>
            </div>
          ))}
      </div>
      <div className="console-input-row">
        <input
          type="text"
          placeholder={connected ? "Type a command and press Enter\u2026" : "Connect to a device to send commands"}
          value={cmd}
          disabled={!connected}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn" disabled={!connected} onClick={submit}>
          Send
        </button>
      </div>
    </div>
  );
}
