/**
 * Wraps the Screen Wake Lock API to keep the display (and by extension the machine) from
 * sleeping while a G-code job is actively being sent - the same mechanism a video player uses to
 * stay awake during playback. The browser automatically releases the lock whenever the tab is
 * hidden, so we track whether it *should* be held and transparently re-acquire it once the tab
 * becomes visible again (e.g. the user tabs away mid-job and comes back).
 */

let sentinel: WakeLockSentinel | null = null;
let shouldHold = false;

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.wakeLock;
}

async function acquire(): Promise<void> {
  if (!isWakeLockSupported()) return;
  try {
    sentinel = await navigator.wakeLock!.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    // Can fail if the document isn't visible/focused yet - visibilitychange handler below will
    // retry once it is.
    sentinel = null;
  }
}

function onVisibilityChange(): void {
  if (shouldHold && document.visibilityState === "visible" && !sentinel) {
    void acquire();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", onVisibilityChange);
}

/** Call with `true` while a job is actively sending, `false` once it pauses/stops/finishes. */
export async function setKeepAwake(hold: boolean): Promise<void> {
  shouldHold = hold;
  if (hold) {
    if (!sentinel) await acquire();
  } else if (sentinel) {
    const s = sentinel;
    sentinel = null;
    try {
      await s.release();
    } catch {
      /* already released */
    }
  }
}
