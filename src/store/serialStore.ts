import { create } from "zustand";
import { SerialConnection, sendGcodeJob } from "../lib/serial";
import { setKeepAwake } from "../lib/wakeLock";
import type { JobStatus, LogEntry } from "../types";

export const COMMON_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000];

const RECONNECT_MAX_ATTEMPTS = 6;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

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
  /** True while automatically retrying a dropped connection (see attemptReconnect). */
  reconnecting: boolean;
  reconnectAttempt: number;

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
  /** Sends a GRBL-style "?" real-time status query and waits (briefly) for a matching
   *  "<...|MPos:x,y,z|...>" or WPos response. Returns null on timeout/no response. */
  queryPosition: () => Promise<{ x: number; y: number; z: number } | null>;
  /** Jogs one axis by a relative distance (mm) using a G91/G0/G90 sequence. */
  jogAxis: (axis: "X" | "Y", distanceMm: number) => Promise<void>;

  startJob: (
    lines: string[],
    opts?: { waitForAck?: boolean; ackTimeoutMs?: number; interLineDelayMs?: number; startIndex?: number }
  ) => Promise<void>;
  pauseJob: () => void;
  /** Resumes a job paused mid-send, or restarts sending from where a "lost" job left off after
   *  the connection has been reconnected. */
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  let reconnectToken = 0;

  async function attemptReconnect() {
    const myToken = ++reconnectToken;
    set({ reconnecting: true, reconnectAttempt: 0 });
    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (reconnectToken !== myToken) return; // superseded by a newer attempt or manual action
      set({ reconnectAttempt: attempt });
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
      pushLog("info", `Reconnecting (attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS}) in ${Math.round(delay / 1000)}s\u2026`);
      await sleep(delay);
      if (reconnectToken !== myToken) return;
      try {
        await connection.reconnect();
        set({ reconnecting: false, reconnectAttempt: 0 });
        pushLog(
          "info",
          get().job.status === "lost"
            ? "Reconnected. Click Resume to continue the job from where it left off."
            : "Reconnected."
        );
        return;
      } catch (err: any) {
        pushLog("error", `Reconnect attempt ${attempt} failed: ${err?.message ?? err}`);
      }
    }
    if (reconnectToken === myToken) {
      set({ reconnecting: false });
      pushLog("error", "Could not reconnect automatically. Check the cable/port and connect manually.");
    }
  }

  connection.onStatus = (status, detail) => {
    if (status === "connected") {
      set({ connected: true, connecting: false });
      pushLog("info", "Connected.");
    } else if (status === "disconnected") {
      set({ connected: false, connecting: false, needsUnlock: false });
      pushLog("info", "Disconnected.");
    } else if (status === "lost") {
      set({ connected: false, connecting: false });
      pushLog("error", `Device connection lost${detail ? `: ${detail}` : ""}. This is a known flaky-USB-serial-adapter issue, especially on macOS.`);
      // Preserve the job (lines + current position) so it can be resumed after reconnecting,
      // instead of losing progress.
      const jobStatus = get().job.status;
      if (jobStatus === "running" || jobStatus === "paused") {
        set((s) => ({ job: { ...s.job, status: "lost" } }));
        void setKeepAwake(false);
      }
      void attemptReconnect();
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
    reconnecting: false,
    reconnectAttempt: 0,
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
      reconnectToken++; // cancel any in-flight auto-reconnect - the user is taking manual control
      set({ connecting: true, reconnecting: false });
      try {
        await connection.connect(selectedPort, baudRate);
      } catch (err: any) {
        set({ connecting: false });
        pushLog("error", `Connect failed: ${err?.message ?? err}`);
      }
    },

    disconnect: async () => {
      reconnectToken++; // cancel any in-flight auto-reconnect
      set({ reconnecting: false });
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

    queryPosition: async () => {
      if (!connection.isOpen) return null;
      const re = /(?:MPos|WPos):(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/;
      return new Promise((resolve) => {
        let resolved = false;
        const waiter = (line: string): boolean => {
          const m = re.exec(line);
          if (!m) return false;
          if (!resolved) {
            resolved = true;
            resolve({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
          }
          return true;
        };
        set((s) => ({ ackWaiters: [...s.ackWaiters, waiter] }));
        connection.writeRaw("?").catch(() => {
          /* surfaced via the timeout below if it never responds */
        });
        window.setTimeout(() => {
          if (!resolved) {
            resolved = true;
            set((s) => ({ ackWaiters: s.ackWaiters.filter((w) => w !== waiter) }));
            resolve(null);
          }
        }, 2000);
      });
    },

    jogAxis: async (axis, distanceMm) => {
      if (!connection.isOpen) return;
      const send = get().sendCommand;
      await send("G91");
      await send(`G0 ${axis}${distanceMm}`);
      await send("G90");
    },

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
      const startIndex = opts?.startIndex ?? 0;

      set({
        jobAbort: false,
        jobPaused: false,
        job: {
          ...get().job,
          status: "running",
          currentLine: startIndex,
          totalLines: lines.length,
          lines,
          waitForAck,
          ackTimeoutMs,
          interLineDelayMs,
          startedAt: Date.now(),
          currentPos: startIndex > 0 ? get().job.currentPos : null,
        },
      });
      pushLog("info", startIndex > 0 ? `Resuming job from line ${startIndex + 1}.` : `Job started: ${lines.length} lines.`);
      // Keep the screen (and machine) awake while commands are actively streaming out, the same
      // way a video player does during playback - a long cut job shouldn't get interrupted by
      // the OS putting the display/computer to sleep.
      void setKeepAwake(true);

      let result: "done" | "stopped" | "lost";
      try {
        result = await sendGcodeJob(connection, lines, {
          waitForAck,
          ackPattern: /ok|error/i,
          ackTimeoutMs,
          interLineDelayMs,
          startIndex,
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
      } catch (err: any) {
        // Should be unreachable (sendGcodeJob catches device-lost errors internally), but never
        // let a job failure become an unhandled rejection that silently breaks the app.
        pushLog("error", `Job failed unexpectedly: ${err?.message ?? err}`);
        result = "stopped";
      }

      if (result === "lost") {
        // connection.onStatus("lost") already flips job.status to "lost" and kicks off
        // auto-reconnect; nothing further to do here.
        return;
      }

      set((s) => ({ job: { ...s.job, status: result === "done" ? "done" : "stopped" } }));
      pushLog("info", result === "done" ? "Job complete." : "Job stopped.");
      void setKeepAwake(false);
    },

    pauseJob: () => {
      set({ jobPaused: true, job: { ...get().job, status: "paused" } });
      void setKeepAwake(false);
    },
    resumeJob: () => {
      const job = get().job;
      if (job.status === "lost") {
        // The original send loop already exited when the connection dropped - restart it from
        // where it left off rather than just flipping a "paused" flag on a dead loop.
        void get().startJob(job.lines, {
          waitForAck: job.waitForAck,
          ackTimeoutMs: job.ackTimeoutMs,
          interLineDelayMs: job.interLineDelayMs,
          startIndex: job.currentLine,
        });
        return;
      }
      set({ jobPaused: false, job: { ...get().job, status: "running" } });
      void setKeepAwake(true);
    },
    stopJob: () => {
      set({ jobAbort: true, jobPaused: false });
    },
  };
});
