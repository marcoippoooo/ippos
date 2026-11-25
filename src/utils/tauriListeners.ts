import { UnlistenFn } from "@tauri-apps/api/event";

export interface ListenerBag {
  add: (promise: Promise<UnlistenFn>) => void;
  dispose: () => void;
}

/**
 * Traccia i listener asincroni di Tauri (`listen`, `onCloseRequested`, ecc.)
 * garantendo il cleanup immediato anche se la Promise si risolve dopo lo smontaggio.
 */
export function createListenerBag(): ListenerBag {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  const safeUnlisten = (fn: UnlistenFn) => {
    try {
      fn();
    } catch {
      // Ignora errori di cleanup durante lo shutdown/smontaggio
    }
  };

  return {
    add(promise) {
      promise
        .then((fn) => {
          if (disposed) {
            safeUnlisten(fn);
          } else {
            unlisteners.push(fn);
          }
        })
        .catch(() => {
          // Non propagare fallimenti transitori di registrazione listener
        });
    },
    dispose() {
      disposed = true;
      while (unlisteners.length > 0) {
        const fn = unlisteners.pop();
        if (fn) {
          safeUnlisten(fn);
        }
      }
    },
  };
}
