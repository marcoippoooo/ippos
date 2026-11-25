import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePlayerStore } from "../store/playerStore";
import { createListenerBag } from "../utils/tauriListeners";

export function useTraySync() {
  const trackTitle = usePlayerStore((s) => s.currentTrack?.title ?? null);
  const trackArtist = usePlayerStore((s) => s.currentTrack?.artist ?? null);
  const isPlaying = usePlayerStore((s) => s.playbackStatus === "playing");

  // Registra i listener dei comandi dal menu della System Tray e comportamento chiusura finestra
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    const bag = createListenerBag();
    bag.add(
      listen("tray:toggle-play", () => {
        usePlayerStore.getState().togglePlay();
      }),
    );
    bag.add(
      listen("tray:next", () => {
        usePlayerStore.getState().playNext();
      }),
    );
    bag.add(
      listen("tray:previous", () => {
        usePlayerStore.getState().playPrevious();
      }),
    );
    bag.add(
      getCurrentWindow().onCloseRequested(() => {
        const state = usePlayerStore.getState();
        if (state.preferences.closeBehavior === "quit") {
          state.pausePlayback();
        }
      }),
    );

    return () => {
      bag.dispose();
    };
  }, []);

  // Sincronizza brano corrente e stato Play/Pausa nel menu bar tray
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    void invoke("update_tray_state", {
      title: trackTitle,
      artist: trackArtist,
      isPlaying,
    }).catch(() => {
      // Ignora errori transitori allo startup/shutdown
    });
  }, [trackTitle, trackArtist, isPlaying]);
}
