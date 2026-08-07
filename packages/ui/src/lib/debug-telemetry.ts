import { createSignal } from "solid-js"
import { serverEvents } from "./server-events"
import type { WorkspaceEventTransportStatus } from "./event-transport"

// Debug-only telemetry for the mobile reconnect-recovery overlay (Ctrl+Shift+D).
// Deliberately lives on its own branch (debug/mobile-overlay), never merged
// upstream: it exists purely to make the SSE disconnect/reconnect + foreground
// refresh lifecycle observable on a phone, where there is no devtools console
// unless the device is tethered for remote debugging.
//
// Kept in ONE small module so it survives future `git merge upstream/dev` /
// `git rebase` cycles on this branch as a single conflict-free unit, instead
// of being scattered (and previously, being an untracked file that was lost
// entirely because it was never committed anywhere).

export type DebugEventCategory = "sse" | "refresh" | "session"

export interface DebugTelemetryEvent {
  id: number
  timestamp: number
  category: DebugEventCategory
  message: string
  data?: Record<string, unknown>
}

const MAX_EVENTS = 100
let nextId = 1

const [events, setEvents] = createSignal<DebugTelemetryEvent[]>([])
const [visible, setVisible] = createSignal(false)
const [sseStatus, setSseStatus] = createSignal<WorkspaceEventTransportStatus>("connecting")

export function pushDebugEvent(category: DebugEventCategory, message: string, data?: Record<string, unknown>): void {
  setEvents((prev) => {
    const next = [...prev, { id: nextId++, timestamp: Date.now(), category, message, data }]
    return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
  })
}

export function clearDebugEvents(): void {
  setEvents([])
}

export function debugEvents(): DebugTelemetryEvent[] {
  return events()
}

export function isDebugOverlayVisible(): boolean {
  return visible()
}

export function toggleDebugOverlay(): void {
  setVisible((prev) => !prev)
}

export function debugSseStatus(): WorkspaceEventTransportStatus {
  return sseStatus()
}

// Single always-on subscription: records every transport transition
// automatically regardless of whether the overlay has ever been opened, so
// opening it after a reconnect still shows what happened.
serverEvents.onTransportStatus((status) => {
  setSseStatus(status)
  pushDebugEvent("sse", `transport -> ${status}`)
})
