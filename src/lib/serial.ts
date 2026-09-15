export type SerialLineHandler = (line: string) => void;
/**
 * "lost" is a distinct, more specific case of the connection dropping unexpectedly (as opposed
 * to the user explicitly disconnecting, or a one-off write/command error) - flaky USB-serial
 * adapters (common with GRBL controllers on macOS) can drop out mid-job, and callers use this to
 * trigger auto-reconnect instead of just giving up.
 */
export type SerialStatusHandler = (status: "connected" | "disconnected" | "lost" | "error", detail?: string) => void;

/** True for the "NetworkError: The device has been lost." family of errors Web Serial throws
 *  when the underlying USB device disappears (unplugged, OS power-managed it away, flaky
 *  driver, etc.) - as opposed to a plain protocol/logic error. */
export function isDeviceLostError(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const message = String((err as { message?: unknown } | undefined)?.message ?? err ?? "");
  return name === "NetworkError" || /device has been lost/i.test(message) || /the device has been lost/i.test(message);
}

/**
 * Thin wrapper around the Web Serial API providing line-buffered reads and writes,
 * plus a simple "wait for acknowledgement" primitive used when streaming a G-code job.
 */
export class SerialConnection {
  private port: SerialPort | null = null;
  /** Kept even after a disconnect/loss so reconnect() can try reopening the same physical port. */
  private lastPort: SerialPort | null = null;
  private lastBaudRate = 115200;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readBuffer = "";
  private closing = false;

  onLine: SerialLineHandler | null = null;
  onStatus: SerialStatusHandler | null = null;

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  static async requestPort(): Promise<SerialPort> {
    return navigator.serial.requestPort();
  }

  static async getAuthorizedPorts(): Promise<SerialPort[]> {
    return navigator.serial.getPorts();
  }

  get isOpen(): boolean {
    return this.port !== null;
  }

  async connect(port: SerialPort, baudRate: number): Promise<void> {
    this.closing = false;
    await port.open({ baudRate });
    this.port = port;
    this.lastPort = port;
    this.lastBaudRate = baudRate;
    if (port.writable) {
      this.writer = port.writable.getWriter();
    }
    this.onStatus?.("connected");
    void this.readLoop();
  }

  /** Attempts to reopen the most recently used port at the same baud rate - used for automatic
   *  reconnection after the device is lost mid-session. Throws if there's no prior port or the
   *  device still isn't reachable (caller is expected to retry with backoff). */
  async reconnect(): Promise<void> {
    if (!this.lastPort) throw new Error("No previous port to reconnect to.");
    await this.connect(this.lastPort, this.lastBaudRate);
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.onStatus?.("disconnected");
  }

  async writeRaw(text: string): Promise<void> {
    if (!this.writer) throw new Error("Serial port is not connected.");
    const encoder = new TextEncoder();
    try {
      await this.writer.write(encoder.encode(text));
    } catch (err) {
      if (isDeviceLostError(err)) {
        this.port = null;
        this.onStatus?.("lost", "Device has been lost.");
      }
      throw err;
    }
  }

  async writeLine(text: string): Promise<void> {
    await this.writeRaw(text.endsWith("\n") ? text : text + "\n");
  }

  private async readLoop(): Promise<void> {
    if (!this.port?.readable) return;
    const decoder = new TextDecoderStream();
    const streamClosed = this.port.readable
      .pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>)
      .catch(() => {
        /* pipe errors are surfaced via the reader.read() rejection below */
      });
    const reader = decoder.readable.getReader();
    this.reader = reader as unknown as ReadableStreamDefaultReader<Uint8Array>;

    let readError: unknown = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.pushChunk(value);
      }
    } catch (err) {
      readError = err;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      await streamClosed;
      if (!this.closing) {
        this.port = null;
        if (readError && isDeviceLostError(readError)) {
          this.onStatus?.("lost", "Device has been lost.");
        } else if (readError) {
          this.onStatus?.("error", String((readError as { message?: unknown })?.message ?? readError));
        } else {
          this.onStatus?.("disconnected");
        }
      }
    }
  }

  private pushChunk(chunk: string): void {
    this.readBuffer += chunk;
    const parts = this.readBuffer.split(/\r?\n/);
    this.readBuffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length > 0) this.onLine?.(line);
    }
  }
}

/**
 * Streams G-code lines to a connection, optionally waiting for an acknowledgement
 * (e.g. GRBL/Marlin style "ok") after each line before sending the next.
 *
 * Returns "lost" (rather than throwing) if the connection drops mid-send, so callers can offer
 * to resume from `startIndex` once reconnected instead of the whole job dying with an unhandled
 * rejection.
 */
export interface SendJobOptions {
  waitForAck: boolean;
  ackPattern: RegExp;
  ackTimeoutMs: number;
  interLineDelayMs: number;
  /** Line index to start at - used to resume a job that previously got interrupted. */
  startIndex?: number;
  onProgress: (index: number, total: number, line: string) => void;
  isAborted: () => boolean;
  isPaused: () => boolean;
  registerAckWaiter: (waiter: (line: string) => boolean) => () => void;
}

export async function sendGcodeJob(
  conn: SerialConnection,
  lines: string[],
  opts: SendJobOptions
): Promise<"done" | "stopped" | "lost"> {
  const total = lines.length;
  for (let i = opts.startIndex ?? 0; i < total; i++) {
    while (opts.isPaused()) {
      await sleep(100);
      if (opts.isAborted()) return "stopped";
    }
    if (opts.isAborted()) return "stopped";

    const line = lines[i];
    // Skip blank/comment-only lines quickly but still report progress.
    const trimmed = line.trim();
    opts.onProgress(i, total, line);
    if (trimmed.length === 0) continue;

    try {
      if (opts.waitForAck) {
        const ackPromise = new Promise<boolean>((resolve) => {
          let resolved = false;
          const unregister = opts.registerAckWaiter((incoming) => {
            if (opts.ackPattern.test(incoming)) {
              if (!resolved) {
                resolved = true;
                resolve(true);
              }
              return true;
            }
            return false;
          });
          window.setTimeout(() => {
            if (!resolved) {
              resolved = true;
              unregister();
              resolve(false);
            }
          }, opts.ackTimeoutMs);
        });
        await conn.writeLine(line);
        await ackPromise;
      } else {
        await conn.writeLine(line);
        if (opts.interLineDelayMs > 0) await sleep(opts.interLineDelayMs);
      }
    } catch (err) {
      if (isDeviceLostError(err)) return "lost";
      throw err;
    }
  }
  return "done";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
