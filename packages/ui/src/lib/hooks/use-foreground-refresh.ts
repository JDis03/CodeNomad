import { onCleanup, onMount } from "solid-js"
import { getLogger } from "../logger"

const log = getLogger("foreground-refresh")

const MIN_BACKGROUND_MS = 3000

interface ForegroundRefreshOptions {
  onRefresh: () => void | Promise<void>
}

/**
 * Calls `onRefresh` when the page returns to the foreground after being
 * hidden for at least MIN_BACKGROUND_MS milliseconds.
 *
 * This is used to recover from stale tool/message state after the mobile
 * browser suspends the page in the background (e.g. user switches apps).
 */
export function useForegroundRefresh(options: ForegroundRefreshOptions): void {
  onMount(() => {
    let hiddenAt: number | null = null

    const handleVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now()
        return
      }

      if (hiddenAt === null) return

      const elapsed = Date.now() - hiddenAt
      hiddenAt = null

      if (elapsed < MIN_BACKGROUND_MS) {
        log.info("Foreground return: skipping refresh (was hidden too briefly)", { elapsedMs: elapsed })
        return
      }

      log.info("Foreground return: refreshing session state", { elapsedMs: elapsed })
      void Promise.resolve(options.onRefresh()).catch((error) => {
        log.error("Foreground refresh failed", error)
      })
    }

    document.addEventListener("visibilitychange", handleVisibility)
    onCleanup(() => document.removeEventListener("visibilitychange", handleVisibility))
  })
}
