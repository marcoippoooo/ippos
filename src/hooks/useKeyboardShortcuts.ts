import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";

const SEARCH_INPUT_ID = "ippos-search-input";
const VOLUME_STEP = 0.05;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if ((target as HTMLElement).isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"], [contenteditable=""]'));
}

function isInteractiveControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "A") {
    return true;
  }
  return Boolean(
    target.closest('button, a, [role="button"], [role="slider"], [role="switch"]'),
  );
}

function hasBlockingModalOpen(
  state: ReturnType<typeof usePlayerStore.getState>,
): boolean {
  if (
    state.isSleepTimerOpen ||
    state.isCreatePlaylistModalOpen ||
    state.contextMenuTrack !== null
  ) {
    return true;
  }
  return Boolean(
    document.querySelector('[role="dialog"][aria-modal="true"]:not([data-now-playing="true"])'),
  );
}

function focusSearchInput(): void {
  const tryFocus = () => {
    const input = document.getElementById(SEARCH_INPUT_ID) as
      | HTMLInputElement
      | null;
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  };

  if (!tryFocus()) {
    window.requestAnimationFrame(() => {
      tryFocus();
    });
  }
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      const state = usePlayerStore.getState();
      const keyLower = e.key.toLowerCase();
      const hasPrimaryModifier = e.metaKey || e.ctrlKey;

      // 1. Escape: chiusura ordinata di modali, overlay, focus ricerca e coda
      if (e.key === "Escape") {
        if (state.isCreatePlaylistModalOpen) {
          return;
        }
        if (state.contextMenuTrack !== null) {
          return;
        }
        if (state.isSleepTimerOpen) {
          e.preventDefault();
          state.closeSleepTimer();
          return;
        }
        if (state.isNowPlayingOpen) {
          e.preventDefault();
          state.closeNowPlaying();
          return;
        }
        if (state.isCinemaMode) {
          e.preventDefault();
          state.setCinemaMode(false);
          return;
        }
        const activeEl = document.activeElement;
        if (activeEl instanceof HTMLElement && activeEl.id === SEARCH_INPUT_ID) {
          e.preventDefault();
          if (state.searchQuery.length > 0 || state.activeView === "search") {
            state.clearSearch();
          }
          activeEl.blur();
          return;
        }
        if (state.isQueueOpen) {
          e.preventDefault();
          state.setQueueOpen(false);
          return;
        }
        if (state.activeView === "search" || state.searchQuery.length > 0) {
          e.preventDefault();
          state.clearSearch();
        }
        return;
      }

      // 2. Cmd+K / Cmd+F: focus immediato sulla barra di ricerca
      if (
        hasPrimaryModifier &&
        !e.altKey &&
        !e.shiftKey &&
        (keyLower === "k" || keyLower === "f")
      ) {
        e.preventDefault();
        state.openSearchView();
        focusSearchInput();
        return;
      }

      // 3. Cmd+L: toggle rapido vista Testi
      if (hasPrimaryModifier && !e.altKey && !e.shiftKey && keyLower === "l") {
        e.preventDefault();
        state.toggleLyricsView();
        return;
      }

      // 4. Cmd+Destra / Cmd+Sinistra: traccia successiva / precedente (fuori dagli input)
      if (
        hasPrimaryModifier &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "ArrowRight" || e.key === "ArrowLeft")
      ) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        if (e.key === "ArrowRight") {
          state.playNext();
        } else {
          state.playPrevious();
        }
        return;
      }

      // 5. Cmd/Alt + Su/Giu: volume +/- 5%
      if (
        (hasPrimaryModifier || e.altKey) &&
        !e.shiftKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const currentVol = state.isMuted ? 0 : state.volume;
        const delta = e.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP;
        const nextVol = Math.max(
          0,
          Math.min(1, Math.round((currentVol + delta) * 100) / 100),
        );
        state.setVolume(nextVol);
        return;
      }

      // 6. Tasti singoli (Spazio, M): esclusi input editabili, modali e controlli focalizzati
      if (isEditableTarget(e.target) || hasBlockingModalOpen(state)) {
        return;
      }

      if (e.code === "Space" && !hasPrimaryModifier && !e.altKey) {
        if (isInteractiveControl(e.target)) return;
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (!state.currentTrack) return;
        e.preventDefault();
        state.togglePlay();
        return;
      }

      if (keyLower === "m" && !hasPrimaryModifier && !e.altKey && !e.repeat) {
        e.preventDefault();
        state.toggleMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
