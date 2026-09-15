import { create } from "zustand";
import { SerialConnection, sendGcodeJob } from "../lib/serial";
import type { JobStatus, LogEntry } from "../types";

export const COMMON_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000];

interface KnownPort {
  port: SerialPort;
  label: string;
}

interface SerialState {
  connection: SerialConnection;
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  baudRate: number;
  selectedPort: SerialPort | null;
  knownPorts: KnownPort[];
  logs: LogEntry[];
  ackWaiters: ((line: string) => boolean)[];
  /** True once we've seen a GRBL alarm/unlock-required message on this connection. */
  needsUnlock: boolean;

  job: {
    status: JobStatus;
    currentLine: number;
    totalLines: number;
    lines: string[];
    waitForAck: boolean;
    ackTimeoutMs: number;
    interLineDelayMs: number;
    startedAt: number | null;
    /** Machine-space (mm) position implied by the last G0/G1 X/Y sent, tracked modally (an axis
     *  not mentioned in a line keeps its previous value) so the G-code preview can show a live
     *  "where's the cutter right now" marker while a job is running. */
    currentPos: { x: number; y: number } | null;
  };
  jobAbort: boolean;
  jobPaused: boolean;

  setBaudRate: (baud: number) => void;
  refreshKnownPorts: () => Promise<void>;
  requestPort: () => Promise<void>;
  selectPort: (port: SerialPort) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendCommand: (text: string) => Promise<void>;
  clearLogs: () => void;

  startJob: (lines: string[], opts?: { waitForAck?: boolean; ackTimeoutMs?: number; interLineDelayMs?: number }) => Promise<void>;
  pauseJob: () => void;
  resumeJob: () => void;
  stopJob: () => void;
}

/** Matches GRBL's startup alarm-state hint, e.g. "[MSG:'$H'|'$X' to unlock]", and generic "ALARM:" lines. */
const GRBL_UNLOCK_HINT_RE = /\$x.*unlock|alarm/i;
const GRBL_UNLOCKED_RE = /\bunlocked\b|\bidle\b/i;

const X_RE = /X(-?[0-9]*\.?[0-9]+)/i;
const Y_RE = /Y(-?[0-9]*\.?[0-9]+)/i;

/** Parses X/Y out of a G-code line, keeping any axis not mentioned at its previous value
 *  (G-code motion is modal - X100 alone doesn't change Y). Returns null if the line has no
 *  recognizable X or Y and there's no previous position to carry forward. */
function updatePositionFromLine(line: string, prev: { x: number; y: number } | null): { x: number; y: number } | null {
  const xm = X_RE.exec(line);
  const ym = Y_RE.exec(line);
  if (!xm && !ym) return prev;
  const x = xm ? parseFloat(xm[1]) : prev?.x ?? 0;
  const y = ym ? parseFloat(ym[1]) : prev?.y ?? 0;
  return { x, y };
}

let logIdCounter = 1;

function portLabel(port: SerialPort, idx: number): string {
  const info = port.getInfo?.() ?? {};
  const vid = info.usbVendorId !== undefined ? info.usbVendorId.toString(16).padStart(4, "0") : "????";
  const pid = info.usbProductId !== undefined ? info.usbProductId.toString(16).padStart(4, "0") : "????";
  return `Port ${idx + 1} (VID:${vid} PID:${pid})`;
}

export const useSerialStore = create<SerialState>((set, get) => {
  const connection = new SerialConnection();

  connection.onStatus = (status, detail) => {
    if (status === "connected") {
      set({ connected: true, connecting: false });
      pushLog("info", "Connected.");
    } else if (status === "disconnected") {
      set({ connected: false, connecting: false, needsUnlock: false });
      pushLog("info", "Disconnected.");
    } else if (status === "error") {
      set({ connected: false, connecting: false });
      pushLog("error", `Serial error: ${detail ?? "unknown"}`);
    }
  };

  connection.onLine = (line) => {
    pushLog("rx", line);
    const waiters = get().ackWaiters;
    if (waiters.length > 0) {
      const remaining = waiters.filter((w) => !w(line));
      if (remaining.length !== waiters.length) set({ ackWaiters: remaining });
    }
    if (GRBL_UNLOCK_HINT_RE.test(line)) {
      set({ needsUnlock: true });
    } else if (GRBL_UNLOCKED_RE.test(line) && get().needsUnlock) {
      set({ needsUnlock: false });
    }
  };

  function pushLog(dir: LogEntry["dir"], text: string) {
    set((s) => ({
      logs: [...s.logs.slice(-999), { id: logIdCounter++, ts: Date.now(), dir, text }],
    }));
  }

  return {
    connection,
    supported: SerialConnection.isSupported(),
    connected: false,
    connecting: false,
    baudRate: 115200,
    selectedPort: null,
    knownPorts: [],
    logs: [],
    ackWaiters: [],
    needsUnlock: false,
    job: {
      status: "idle",
      currentLine: 0,
      totalLines: 0,
      lines: [],
      waitForAck: true,
      ackTimeoutMs: 4000,
      interLineDelayMs: 30,
      startedAt: null,
      currentPos: null,
    },
    jobAbort: false,
    jobPaused: false,

    setBaudRate: (baud) => set({ baudRate: baud }),

    refreshKnownPorts: async () => {
      if (!SerialConnection.isSupported()) return;
      const ports = await SerialConnection.getAuthorizedPorts();
      set({ knownPorts: ports.map((port, idx) => ({ port, label: portLabel(port, idx) })) });
    },

    requestPort: async () => {
      if (!SerialConnection.isSupported()) return;
      try {
        const port = await SerialConnection.requestPort();
        await get().refreshKnownPorts();
        set({ selectedPort: port });
      } catch (err: any) {
        if (err?.name !== "NotFoundError") {
          pushLog("error", `Port request failed: ${err?.message ?? err}`);
        }
      }
    },

    selectPort: (port) => set({ selectedPort: port }),

    connect: async () => {
      const { selectedPort, baudRate } = get();
      if (!selectedPort) {
        pushLog("error", "No port selected.");
        return;
      }
      set({ connecting: true });
      try {
        await connection.connect(selectedPort, baudRate);
      } catch (err: any) {
        set({ connecting: false });
        pushLog("error", `Connect failed: ${err?.message ?? err}`);
      }
    },

    disconnect: async () => {
      await connection.disconnect();
    },

    sendCommand: async (text: string) => {
      if (!connection.isOpen) {
        pushLog("error", "Not connected.");
        return;
      }
      pushLog("tx", text);
      try {
        await connection.writeLine(text);
      } catch (err: any) {
        pushLog("error", `Write failed: ${err?.message ?? err}`);
      }
    },

    clearLogs: () => set({ logs: [] }),

    startJob: async (lines, opts) => {
      if (!connection.isOpen) {
        pushLog("error", "Not connected.");
        return;
      }
      if (get().needsUnlock) {
        pushLog("error", "Refusing to send: controller is locked/in an alarm state. Unlock it first ($X).");
        return;
      }
      const waitForAck = opts?.waitForAck ?? get().job.waitForAck;
      const ackTimeoutMs = opts?.ackTimeoutMs ?? get().job.ackTimeoutMs;
      const interLineDelayMs = opts?.interLineDelayMs ?? get().job.interLineDelayMs;

      set({
        jobAbort: false,
        jobPaused: false,
        job: {
          ...get().job,
          status: "running",
          currentLine: 0,
          totalLines: lines.length,
          lines,
          waitForAck,
          ackTimeoutMs,
          interLineDelayMs,
          startedAt: Date.now(),
          currentPos: null,
        },
      });
      pushLog("info", `Job started: ${lines.length} lines.`);

      const result = await sendGcodeJob(connection, lines, {
        waitForAck,
        ackPattern: /ok|error/i,
        ackTimeoutMs,
        interLineDelayMs,
        onProgress: (index, total, line) => {
          set((s) => ({
            job: { ...s.job, currentLine: index, totalLines: total, currentPos: updatePositionFromLine(line, s.job.currentPos) },
          }));
          pushLog("tx", line);
        },
        isAborted: () => get().jobAbort,
        isPaused: () => get().jobPaused,
        registerAckWaiter: (waiter) => {
          set((s) => ({ ackWaiters: [...s.ackWaiters, waiter] }));
          return () => set((s) => ({ ackWaiters: s.ackWaiters.filter((w) => w !== waiter) }));
        },
      });

      set((s) => ({ job: { ...s.job, status: result === "done" ? "done" : "stopped" } }));
      pushLog("info", result === "done" ? "Job complete." : "Job stopped.");
    },

    pauseJob: () => {
      set({ jobPaused: true, job: { ...get().job, status: "paused" } });
    },
    resumeJob: () => {
      set({ jobPaused: false, job: { ...get().job, status: "running" } });
    },
    stopJob: () => {
      set({ jobAbort: true, jobPaused: false });
    },
  };
});
