// Minimal ambient type declarations for the Screen Wake Lock API (not in the default TS DOM lib).

interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: "screen";
  release(): Promise<void>;
}

interface WakeLock {
  request(type: "screen"): Promise<WakeLockSentinel>;
}

interface Navigator {
  readonly wakeLock?: WakeLock;
}
