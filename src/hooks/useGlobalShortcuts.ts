import { useEffect } from "react";
import {
  isRegistered,
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { usePlayerStore } from "../store/playerStore";

type GlobalActionKey = "togglePlay" | "next" | "previous";

interface ShortcutBinding {
  combo: string;
  actionKey: GlobalActionKey;
  backgroundOnly?: boolean;
  action: () => void;
}

const DEBOUNCE_WINDOW_MS = 250;

const SHORTCUTS: ShortcutBinding[] = [
  {
    combo: "Alt+Shift+Space",
    actionKey: "togglePlay",
    action: () => usePlayerStore.getState().togglePlay(),
  },
  {
    combo: "Alt+Shift+Right",
    actionKey: "next",
    action: () => usePlayerStore.getState().playNext(),
  },
  {
    combo: "Alt+Shift+Left",
    actionKey: "previous",
    action: () => usePlayerStore.getState().playPrevious(),
  },
  // Tasti multimediali macOS (F7/F8/F9 / Media keys): attivi in background per evitare doppie invocazioni con MPRemoteCommandCenter / shortcut locali
  {
    combo: "MediaPlayPause",
    actionKey: "togglePlay",
    backgroundOnly: true,
    action: () => usePlayerStore.getState().togglePlay(),
  },
  {
    combo: "MediaTrackNext",
    actionKey: "next",
    backgroundOnly: true,
    action: () => usePlayerStore.getState().playNext(),
  },
  {
    combo: "MediaTrackPrevious",
    actionKey: "previous",
    backgroundOnly: true,
    action: () => usePlayerStore.getState().playPrevious(),
  },
];

export function useGlobalShortcuts() {
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let disposed = false;
    const registeredCombos: string[] = [];
    const lastActionTimestamps = new Map<GlobalActionKey, number>();

    const registerAll = async () => {
      for (const binding of SHORTCUTS) {
        if (disposed) break;
        try {
          const alreadyRegistered = await isRegistered(binding.combo).catch(
            () => false,
          );
          if (disposed || alreadyRegistered) continue;

          await register(binding.combo, (event) => {
            if (event.state !== "Pressed") return;
            if (binding.backgroundOnly && document.hasFocus()) {
              return;
            }
            const now = Date.now();
            const prev = lastActionTimestamps.get(binding.actionKey) ?? 0;
            if (now - prev < DEBOUNCE_WINDOW_MS) {
              return;
            }
            lastActionTimestamps.set(binding.actionKey, now);
            binding.action();
          });

          if (disposed) {
            await unregister(binding.combo).catch(() => {});
          } else {
            registeredCombos.push(binding.combo);
          }
        } catch {
          // Conflitto con un'altra app o combinazione occupata: non bloccare le altre
        }
      }
    };

    void registerAll();

    return () => {
      disposed = true;
      while (registeredCombos.length > 0) {
        const combo = registeredCombos.pop();
        if (combo) {
          void unregister(combo).catch(() => {});
        }
      }
    };
  }, []);
}
