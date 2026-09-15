export type SerialLineHandler = (line: string) => void;
export type SerialStatusHandler = (status: "connected" | "disconnected" | "error", detail?: string) => void;

/**
 * Thin wrapper around the Web Serial API providing line-buffered reads and writes,
 * plus a simple "wait for acknowledgement" primitive used when streaming a G-code job.
 */
export class SerialConnection {
  private port: SerialPort | null = null;
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
    if (port.writable) {
      this.writer = port.writable.getWriter();
    }
    this.onStatus?.("connected");
    this.readLoop().catch((err) => {
      if (!this.closing) {
        this.onStatus?.("error", String(err?.message ?? err));
      }
    });
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
    await this.writer.write(encoder.encode(text));
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
      /* pipe errors are surfaced via reader errors below */
    });
    const reader = decoder.readable.getReader();
    this.reader = reader as unknown as ReadableStreamDefaultReader<Uint8Array>;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.pushChunk(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      await streamClosed;
      if (!this.closing) {
        this.onStatus?.("disconnected");
        this.port = null;
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
 */
export interface SendJobOptions {
  waitForAck: boolean;
  ackPattern: RegExp;
  ackTimeoutMs: number;
  interLineDelayMs: number;
  onProgress: (index: number, total: number, line: string) => void;
  isAborted: () => boolean;
  isPaused: () => boolean;
  registerAckWaiter: (waiter: (line: string) => boolean) => () => void;
}

export async function sendGcodeJob(
  conn: SerialConnection,
  lines: string[],
  opts: SendJobOptions
): Promise<"done" | "stopped"> {
  const total = lines.length;
  for (let i = 0; i < total; i++) {
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
  }
  return "done";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
