import { createMemo, For, Show } from "solid-js"
import {
  debugEvents,
  debugSseStatus,
  clearDebugEvents,
  isDebugOverlayVisible,
  toggleDebugOverlay,
  type DebugTelemetryEvent,
} from "../lib/debug-telemetry"
import { instances } from "../stores/instances"
import { activeAppTab } from "../stores/app-tabs"
import { activeSessionId } from "../stores/sessions"
import { getSessionStatus } from "../stores/session-status"
import { messageStoreBus } from "../stores/message-v2/bus"

// Debug-only panel (Ctrl+Shift+D) for verifying the mobile SSE
// disconnect/reconnect + foreground-refresh recovery path on a phone, where
// there is normally no devtools console available. Lives ONLY on the
// debug/mobile-overlay branch — never merged upstream — so it is free to be
// pragmatic (hardcoded English labels, inline styles) rather than following
// the full production styling/i18n conventions.

function formatClock(timestamp: number): string {
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`
}

function categoryColor(category: DebugTelemetryEvent["category"]): string {
  if (category === "sse") return "#60a5fa"
  if (category === "refresh") return "#f59e0b"
  return "#34d399"
}

function statusColor(status: string): string {
  if (status === "connected") return "#22c55e"
  if (status === "disconnected") return "#ef4444"
  return "#f59e0b" // connecting
}

export function DebugMobileOverlay() {
  const activeInstance = createMemo(() => {
    const tab = activeAppTab()
    return tab?.kind === "instance" ? instances().get(tab.instance.id) : undefined
  })
  const activeSession = createMemo(() => {
    const instance = activeInstance()
    if (!instance) return null
    return activeSessionId().get(instance.id) || null
  })
  const sessionSummary = createMemo(() => {
    const instance = activeInstance()
    const sessionId = activeSession()
    if (!instance || !sessionId || sessionId === "info") return null
    const store = messageStoreBus.getOrCreate(instance.id)
    const messageIds = store.getSessionMessageIds(sessionId)
    const pending = messageIds.filter((id) => {
      const record = store.getMessage(id)
      return record?.isEphemeral && record.status === "sending"
    }).length
    return {
      instanceId: instance.id,
      sessionId,
      status: getSessionStatus(instance.id, sessionId),
      messageCount: messageIds.length,
      pendingSends: pending,
    }
  })

  return (
    <Show when={isDebugOverlayVisible()}>
      <div
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "999999",
          background: "rgba(0,0,0,0.88)",
          color: "#e5e7eb",
          "font-family": "monospace",
          "font-size": "12px",
          padding: "10px",
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
          "overflow-y": "auto",
        }}
      >
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <strong>DEBUG — mobile reconnect</strong>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => clearDebugEvents()}
              style={{ background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", padding: "4px 8px" }}
            >
              clear
            </button>
            <button
              onClick={() => toggleDebugOverlay()}
              style={{ background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151", padding: "4px 8px" }}
            >
              close
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <span>SSE:</span>
          <span style={{ color: statusColor(debugSseStatus()), "font-weight": "bold" }}>{debugSseStatus()}</span>
        </div>

        <Show when={sessionSummary()} fallback={<div style={{ color: "#9ca3af" }}>no active session</div>}>
          {(s) => (
            <div style={{ border: "1px solid #374151", padding: "6px" }}>
              <div>instance: {s().instanceId}</div>
              <div>session: {s().sessionId}</div>
              <div>status: {s().status}</div>
              <div>messages: {s().messageCount}</div>
              <div style={{ color: s().pendingSends > 0 ? "#f59e0b" : "#9ca3af" }}>pending sends: {s().pendingSends}</div>
            </div>
          )}
        </Show>

        <div style={{ "flex": "1", "overflow-y": "auto", "border-top": "1px solid #374151", "padding-top": "6px" }}>
          <For each={[...debugEvents()].reverse()}>
            {(event) => (
              <div style={{ "margin-bottom": "3px" }}>
                <span style={{ color: "#6b7280" }}>{formatClock(event.timestamp)}</span>{" "}
                <span style={{ color: categoryColor(event.category) }}>[{event.category}]</span>{" "}
                <span>{event.message}</span>
                <Show when={event.data}>
                  <span style={{ color: "#6b7280" }}> {JSON.stringify(event.data)}</span>
                </Show>
              </div>
            )}
          </For>
          <Show when={debugEvents().length === 0}>
            <div style={{ color: "#6b7280" }}>no events yet — background the app and reopen to test reconnect</div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
