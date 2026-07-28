import { onCleanup, onMount } from "solid-js"
import { getLogger } from "../logger"
import { serverEvents } from "../server-events"

const log = getLogger("foreground-refresh")

interface ForegroundRefreshOptions {
  onRefresh: () => void | Promise<void>
}

/**
 * Calls `onRefresh` when the SSE transport reconnects after a real
 * disconnection. This is the reliable signal that we missed events
 * while the connection was down (e.g. mobile browser suspended the tab).
 *
 * We intentionally do NOT fire on every visibilitychange because the
 * SSE connection can survive short background trips, and a force-reload
 * while a message is in-flight clears the sending state and confuses
 * the UI.
 */
export function useForegroundRefresh(options: ForegroundRefreshOptions): void {
  onMount(() => {
    let wasDisconnected = false

    const unsubscribe = serverEvents.onTransportStatus((status) => {
      if (status === "disconnected") {
        wasDisconnected = true
        log.info("SSE transport disconnected — will refresh on reconnect")
        return
      }

      if (status === "connected" && wasDisconnected) {
        wasDisconnected = false
        log.info("SSE transport reconnected — refreshing session state")
        void Promise.resolve(options.onRefresh()).catch((error) => {
          log.error("Foreground refresh failed", error)
        })
      }
    })

    onCleanup(() => unsubscribe())
  })
}
