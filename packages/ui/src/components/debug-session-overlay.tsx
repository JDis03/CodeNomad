import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { serverEvents } from "../lib/server-events"
import { sseManager } from "../lib/sse-manager"
import { setForegroundRefreshDebugListener } from "../lib/hooks/use-foreground-refresh"
import { setPerfListener } from "../lib/perf"
import { Copy, Check, X, Minimize2, Maximize2, RefreshCw } from "lucide-solid"

type LogEntry = {
  id: number
  ts: number
  type: "ping" | "pong" | "event" | "transport" | "visibility" | "reconnect" | "connection-lost" | "error" | "refresh" | "perf"
  message: string
  detail?: string
  build?: string
}

// Kept generous on purpose: a single mobile background/foreground test can
// span tens of minutes of ~15s pings plus disconnect/reconnect/refresh
// entries, and the whole point of persisting is to keep enough history to
// compare a fix across test runs -- not just the last minute.
const MAX_LOG_ENTRIES = 400
const STORAGE_KEY = "codenomad:debug-sse-log"
let nextLogId = 1

// The debug overlay's log used to live only in Solid component state, so a
// mobile browser killing a backgrounded tab (very common, and exactly the
// scenario we're testing) silently wiped the evidence needed to tell
// whether a fix improved or regressed things. Persisting to localStorage
// (write-through on every entry, restored on mount) means the log survives
// tab kills and page reloads -- the tester can still export it afterward
// even if the tab never came back to the foreground on its own.
function loadPersistedLogs(): LogEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const maxId = parsed.reduce((max: number, entry: LogEntry) => Math.max(max, entry.id ?? 0), 0)
    nextLogId = maxId + 1
    return parsed
  } catch {
    return []
  }
}

function persistLogs(entries: LogEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or unavailable (e.g. private browsing) -- logging
    // continues in-memory for the current session, we just lose durability.
  }
}

// Identifies which deployed build produced a given log entry, read from the
// module script the browser actually loaded (the same `main-<hash>.js` name
// used to confirm a deploy). Lets us tell, when comparing two exported logs,
// whether they came from before or after a given fix was deployed.
function detectBuildId(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/main-"]') ?? document.querySelector<HTMLScriptElement>('script[src*="/main-"]')
  const src = script?.getAttribute("src")
  if (!src) return "unknown"
  const match = src.match(/main-[^./]+\.js/)
  return match ? match[0] : src
}

const DebugSessionOverlay: Component = () => {
  const buildId = detectBuildId()
  const [visible, setVisible] = createSignal(false)
  const [minimized, setMinimized] = createSignal(false)
  const [position, setPosition] = createSignal({ x: 20, y: 20 })
  const [copiedId, setCopiedId] = createSignal<string | null>(null)
  const [logs, setLogs] = createSignal<LogEntry[]>(loadPersistedLogs())
  const [lastPingAt, setLastPingAt] = createSignal<number | null>(null)
  const [lastEventAt, setLastEventAt] = createSignal<number | null>(null)
  const [transportStatus, setTransportStatus] = createSignal<string>("connecting")
  const [connectionStatuses, setConnectionStatuses] = createSignal<Map<string, string>>(new Map())

  const addLog = (type: LogEntry["type"], message: string, detail?: string) => {
    setLogs((prev) => {
      const next = [...prev, { id: nextLogId++, ts: Date.now(), type, message, detail, build: buildId }]
      const trimmed = next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
      persistLogs(trimmed)
      return trimmed
    })
  }

  const clearLogs = () => {
    setLogs([])
    persistLogs([])
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const formatTime = (ts: number | null) => {
    if (!ts) return "never"
    const diff = Date.now() - ts
    if (diff < 1000) return "just now"
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
    return `${Math.floor(diff / 1000)}s ago (${new Date(ts).toLocaleTimeString()})`
  }

  const forceReconnect = () => {
    addLog("reconnect", "Manual reconnect requested")
    serverEvents.restart("manual reconnect from debug overlay")
  }

  onMount(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault()
        setVisible(!visible())
        if (!visible()) {
          setMinimized(false)
        }
      }
    }
    window.addEventListener("keydown", handleKeyPress)

    const handleVisibility = () => {
      const state = document.visibilityState
      const hiddenTime = document.hidden ? Date.now() : undefined
      addLog("visibility", `Page became ${state}`, hiddenTime ? `hidden at ${new Date(hiddenTime).toLocaleTimeString()}` : undefined)
    }
    document.addEventListener("visibilitychange", handleVisibility)

    const unsubscribeTransport = serverEvents.onTransportStatus((status) => {
      setTransportStatus(status)
      addLog("transport", `Transport status: ${status}`)
    })

    const unsubscribeOpen = serverEvents.onOpen(() => {
      addLog("transport", "Events stream opened")
    })

    setForegroundRefreshDebugListener((event) => {
      const messages: Record<typeof event, string> = {
        "disconnected":    "Hook detectó disconnect — esperando reconnect",
        "reconnected":     "Hook detectó reconnect — wasDisconnected=true",
        "refresh-start":   "Refresh iniciado: fetchSessions + loadMessages",
        "refresh-done":    "Refresh completado",
        "refresh-skip":    "Connected pero wasDisconnected=false — sin refresh",
      }
      addLog("refresh", messages[event])
    })

    setPerfListener((m) => {
      const duration = m.durationMs >= 1000 ? `${(m.durationMs / 1000).toFixed(2)}s` : `${Math.round(m.durationMs)}ms`
      addLog("perf", `${m.label}: ${duration}${m.extra ? ` (${m.extra})` : ""}`)
    })

    const originalOnPingReceived = sseManager.onPingReceived
    sseManager.onPingReceived = (ts) => {
      originalOnPingReceived?.(ts)
      setLastPingAt(Date.now())
      addLog("ping", `Ping received${ts ? ` (server ts: ${ts})` : ""}`)
    }

    const originalOnMessageUpdate = sseManager.onMessageUpdate
    sseManager.onMessageUpdate = (instanceId, event) => {
      originalOnMessageUpdate?.(instanceId, event)
      setLastEventAt(Date.now())
      addLog("event", `message.updated`, event.id)
    }

    const originalOnConnectionLost = sseManager.onConnectionLost
    sseManager.onConnectionLost = (instanceId, reason) => {
      originalOnConnectionLost?.(instanceId, reason)
      addLog("connection-lost", `Connection lost: ${instanceId.substring(0, 8)}...`, reason)
    }

    // Track instance connection statuses
    const statusInterval = setInterval(() => {
      const map = new Map<string, string>()
      for (const [id, status] of sseManager.getStatuses().entries()) {
        map.set(id, status ?? "unknown")
      }
      setConnectionStatuses(map)
    }, 1000)

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyPress)
      document.removeEventListener("visibilitychange", handleVisibility)
      unsubscribeTransport()
      unsubscribeOpen()
      clearInterval(statusInterval)
      sseManager.onPingReceived = originalOnPingReceived
      sseManager.onMessageUpdate = originalOnMessageUpdate
      sseManager.onConnectionLost = originalOnConnectionLost
      setForegroundRefreshDebugListener(null)
    })
  })

  const logColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "error":
      case "connection-lost":
        return "#ff5555"
      case "reconnect":
        return "#ffaa00"
      case "refresh":
        return "#ff77ff"
      case "perf":
        return "#ff6600"
      case "ping":
        return "#55ff55"
      case "event":
        return "#aaaaff"
      case "visibility":
        return "#ffff55"
      case "transport":
        return "#55ffff"
      default:
        return "#cccccc"
    }
  }

  return (
    <>
      {visible() && (
        <div
          style={{
            position: "fixed",
            top: `${position().y}px`,
            left: `${position().x}px`,
            "background-color": "rgba(0, 0, 0, 0.95)",
            color: "#00ff00",
            "border-radius": "8px",
            "font-family": "monospace",
            "font-size": "12px",
            "z-index": 99999,
            "max-width": minimized() ? "300px" : "520px",
            "max-height": minimized() ? "auto" : "70vh",
            display: "flex",
            "flex-direction": "column",
            border: "2px solid #00ff00",
            "box-shadow": "0 4px 20px rgba(0, 255, 0, 0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              padding: minimized() ? "8px" : "12px 16px",
              "background-color": "rgba(0, 0, 0, 0.98)",
              "border-bottom": minimized() ? "none" : "1px solid #00ff00",
              "border-radius": "8px 8px 0 0",
              "flex-shrink": "0",
            }}
          >
            <div style={{ "font-weight": "bold", color: "#ffff00", display: "flex", "align-items": "center", gap: "8px" }}>
              🔌 SSE DEBUG
            </div>
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Show when={!minimized()}>
                <button
                  onClick={() => copyToClipboard(JSON.stringify(logs(), null, 2), "logs")}
                  style={{
                    background: copiedId() === "logs" ? "#00ff00" : "rgba(0, 255, 0, 0.2)",
                    border: "1px solid #00ff00",
                    color: copiedId() === "logs" ? "#000" : "#00ff00",
                    padding: "4px 8px",
                    "border-radius": "4px",
                    cursor: "pointer",
                    display: "flex",
                    "align-items": "center",
                    gap: "4px",
                    "font-size": "11px",
                  }}
                  title="Copiar logs"
                >
                  <Show when={copiedId() === "logs"} fallback={<Copy size={14} />}>
                    <Check size={14} />
                  </Show>
                  Copy
                </button>
                <button
                  onClick={forceReconnect}
                  style={{
                    background: "rgba(0, 150, 255, 0.2)",
                    border: "1px solid #0096ff",
                    color: "#0096ff",
                    padding: "4px 8px",
                    "border-radius": "4px",
                    cursor: "pointer",
                    display: "flex",
                    "align-items": "center",
                    gap: "4px",
                    "font-size": "11px",
                  }}
                  title="Forzar reconexión SSE"
                >
                  <RefreshCw size={14} />
                  Reconnect
                </button>
                <button
                  onClick={clearLogs}
                  style={{
                    background: "rgba(255, 100, 0, 0.15)",
                    border: "1px solid #ff6400",
                    color: "#ff9955",
                    padding: "4px 8px",
                    "border-radius": "4px",
                    cursor: "pointer",
                    "font-size": "11px",
                  }}
                  title="Borrar logs (también del almacenamiento persistido)"
                >
                  Clear
                </button>
              </Show>
              <button
                onClick={() => setMinimized(!minimized())}
                style={{
                  background: "rgba(255, 255, 0, 0.2)",
                  border: "1px solid #ffff00",
                  color: "#ffff00",
                  padding: "4px",
                  "border-radius": "4px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                }}
                title={minimized() ? "Maximizar" : "Minimizar"}
              >
                <Show when={minimized()} fallback={<Minimize2 size={14} />}>
                  <Maximize2 size={14} />
                </Show>
              </button>
              <button
                onClick={() => setVisible(false)}
                style={{
                  background: "rgba(255, 0, 0, 0.2)",
                  border: "1px solid #ff0000",
                  color: "#ff0000",
                  padding: "4px",
                  "border-radius": "4px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                }}
                title="Cerrar (Ctrl+Shift+D)"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <Show when={!minimized()}>
            <div
              style={{
                padding: "12px 16px",
                "overflow-y": "auto",
                "overflow-x": "hidden",
                "flex-grow": "1",
                "min-height": "0",
                "max-height": "50vh",
              }}
            >
              <div style={{ "margin-bottom": "12px", padding: "8px", "background-color": "rgba(255, 255, 255, 0.08)", "border-radius": "4px" }}>
                <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "4px" }}>
                  <span>Build:</span>
                  <span style={{ color: "#aaaaff", "font-size": "10px" }}>{buildId}</span>
                </div>
                <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "4px" }}>
                  <span>Persisted:</span>
                  <span style={{ color: "#888", "font-size": "10px" }}>localStorage · sobrevive a cierre de tab</span>
                </div>
                <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "4px" }}>
                  <span>Transport:</span>
                  <span style={{ color: transportStatus() === "connected" ? "#55ff55" : transportStatus() === "connecting" ? "#ffaa00" : "#ff5555", "font-weight": "bold" }}>
                    {transportStatus()}
                  </span>
                </div>
                <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "4px" }}>
                  <span>Last ping:</span>
                  <span>{formatTime(lastPingAt())}</span>
                </div>
                <div style={{ display: "flex", "justify-content": "space-between" }}>
                  <span>Last event:</span>
                  <span>{formatTime(lastEventAt())}</span>
                </div>
                <Show when={connectionStatuses().size > 0}>
                  <div style={{ "margin-top": "8px", "border-top": "1px solid rgba(0,255,0,0.2)", "padding-top": "8px" }}>
                    <div style={{ "margin-bottom": "4px", "font-weight": "bold" }}>Instance statuses:</div>
                    <For each={Array.from(connectionStatuses().entries())}>
                      {([id, status]) => (
                        <div style={{ display: "flex", "justify-content": "space-between", "font-size": "11px" }}>
                          <span>{id.substring(0, 10)}...</span>
                          <span style={{ color: status === "connected" ? "#55ff55" : "#ffaa00" }}>{status}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div style={{ "font-weight": "bold", "margin-bottom": "6px" }}>Log ({logs().length}):</div>
              <For each={logs()}>
                {(entry) => (
                  <div style={{ "margin-bottom": "4px", "font-size": "11px", "line-height": "1.4" }}>
                    <span style={{ color: "#888" }}>{new Date(entry.ts).toLocaleTimeString()} </span>
                    <span style={{ color: logColor(entry.type), "font-weight": "bold" }}>[{entry.type}]</span>
                    <span style={{ color: "#ccc" }}> {entry.message}</span>
                    <Show when={entry.detail}>
                      <span style={{ color: "#888" }}> — {entry.detail}</span>
                    </Show>
                    <Show when={entry.build && entry.build !== buildId}>
                      <span style={{ color: "#ff9955", "font-size": "9px" }}> [{entry.build}]</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </>
  )
}

export default DebugSessionOverlay
