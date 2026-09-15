import { useEffect, useRef, useState } from "react";
import { useSerialStore } from "../store/serialStore";

export function ConsolePanel() {
  const logs = useSerialStore((s) => s.logs);
  const connected = useSerialStore((s) => s.connected);
  const sendCommand = useSerialStore((s) => s.sendCommand);
  const clearLogs = useSerialStore((s) => s.clearLogs);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [logs.length]);

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

  return (
    <div className="panel console-panel">
      <div className="panel-header-row">
        <h3>Serial Console</h3>
        <button className="btn small" onClick={clearLogs}>
          Clear
        </button>
      </div>
      <div className="console-log" ref={listRef}>
        {logs.map((l) => (
          <div key={l.id} className={`console-line dir-${l.dir}`}>
            <span className="console-ts">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="console-dir">{l.dir === "tx" ? ">" : l.dir === "rx" ? "<" : "*"}</span>
            <span className="console-text">{l.text}</span>
          </div>
        ))}
        {logs.length === 0 && <p className="muted">No activity yet.</p>}
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
