import { keyboardRegistry } from "../keyboard-registry"
import { toggleDebugOverlay } from "../debug-telemetry"

export function registerDebugOverlayShortcut(): void {
  keyboardRegistry.register({
    id: "debug-overlay-toggle",
    key: "d",
    modifiers: { ctrl: true, shift: true },
    handler: () => toggleDebugOverlay(),
    description: "toggle mobile debug overlay",
    context: "global",
  })
}
