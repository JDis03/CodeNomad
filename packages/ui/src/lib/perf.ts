// Tiny pub/sub for perf measurements we want visible in the debug overlay
// without coupling the measured code (session-api, instance-store, ...) to
// the overlay component itself. Fire-and-forget: if no listener is attached
// (production, or overlay not mounted), this is a no-op and costs nothing.

type PerfMeasurement = {
  label: string
  durationMs: number
  extra?: string
}

let perfListener: ((m: PerfMeasurement) => void) | null = null

export function setPerfListener(listener: typeof perfListener): void {
  perfListener = listener
}

export function reportPerf(measurement: PerfMeasurement): void {
  perfListener?.(measurement)
}

// Wrap a sync block and report how long it took. Use for the synchronous
// (main-thread-blocking) phases where a freeze would actually come from.
export function measureSync<T>(label: string, fn: () => T, extra?: string): T {
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    reportPerf({ label, durationMs: performance.now() - t0, extra })
  }
}
