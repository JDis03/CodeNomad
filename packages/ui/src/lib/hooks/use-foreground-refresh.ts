import { onCleanup, onMount } from "solid-js"
import { getLogger } from "../logger"
import { serverEvents } from "../server-events"

const log = getLogger("foreground-refresh")

// Module-level flag — survives Solid reactive cycles, guaranteed not to reset
let wasDisconnected = false

// Debug callback: overlay subscribes here to log refresh events
let debugListener: ((event: "disconnected" | "reconnected" | "refresh-start" | "refresh-done" | "refresh-skip") => void) | null = null

export function setForegroundRefreshDebugListener(
  listener: typeof debugListener
): void {
  debugListener = listener
}

function notify(event: Parameters<NonNullable<typeof debugListener>>[0]) {
  debugListener?.(event)
}

interface ForegroundRefreshOptions {
  onRefresh: () => void | Promise<void>
}

export function useForegroundRefresh(options: ForegroundRefreshOptions): void {
  onMount(() => {
    const unsubscribe = serverEvents.onTransportStatus((status) => {
      if (status === "disconnected") {
        wasDisconnected = true
        notify("disconnected")
        log.info("SSE transport disconnected — will refresh on reconnect")
        return
      }

      if (status === "connected") {
        if (!wasDisconnected) {
          notify("refresh-skip")
          log.info("SSE connected but wasDisconnected=false — skipping refresh")
          return
        }
        wasDisconnected = false
        notify("reconnected")
        log.info("SSE transport reconnected — refreshing session state")
        notify("refresh-start")
        void Promise.resolve(options.onRefresh())
          .then(() => {
            notify("refresh-done")
            log.info("Foreground refresh complete")
          })
          .catch((error) => {
            log.error("Foreground refresh failed", error)
          })
      }
    })

    onCleanup(() => unsubscribe())
  })
}
