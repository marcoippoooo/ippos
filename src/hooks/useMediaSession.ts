import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "../store/playerStore";
import { createListenerBag } from "../utils/tauriListeners";

interface PlayerCommandPayload {
  command: string;
  position?: number;
}

interface MediaMetadataPayload {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  currentTime: number;
  playbackState: "playing" | "paused" | "stopped";
  artworkUrl: string;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
}

type SyncSnapshot = MediaMetadataPayload & { sentAtMs: number };

const PROGRESS_THROTTLE_MS = 1000;
const PROGRESS_MIN_DELTA_SEC = 0.25;
const SEEK_DRIFT_THRESHOLD_PLAYING_SEC = 1.5;
const SEEK_DRIFT_THRESHOLD_PAUSED_SEC = 0.5;
const DURATION_DELTA_THRESHOLD_SEC = 0.5;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function buildMetadataFromStore(): MediaMetadataPayload {
  const state = usePlayerStore.getState();
  const track = state.currentTrack;

  let playbackState: MediaMetadataPayload["playbackState"];
  if (!track || state.playbackStatus === "idle" || state.playbackStatus === "error") {
    playbackState = "stopped";
  } else if (state.playbackStatus === "playing") {
    playbackState = "playing";
  } else {
    playbackState = "paused";
  }

  const rawDuration =
    state.duration > 0 ? state.duration : (track?.durationSeconds ?? 0);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const currentTime =
    Number.isFinite(state.progress) && state.progress > 0 ? state.progress : 0;
  const artworkUrl =
    track?.cover && !track.cover.startsWith("data:") ? track.cover : "";

  return {
    trackId: track?.id ?? "",
    title: track?.title ?? "",
    artist: track?.artist ?? "",
    album: track?.album || (track ? "IPPOS" : ""),
    duration,
    currentTime,
    playbackState,
    artworkUrl,
    shuffle: state.shuffle,
    repeat: state.repeat,
  };
}

function shouldSendMetadataUpdate(
  next: MediaMetadataPayload,
  prev: SyncSnapshot | null,
  nowMs: number,
): boolean {
  if (!prev) return true;

  const coreChanged =
    next.trackId !== prev.trackId ||
    next.title !== prev.title ||
    next.artist !== prev.artist ||
    next.album !== prev.album ||
    next.artworkUrl !== prev.artworkUrl ||
    next.playbackState !== prev.playbackState ||
    next.shuffle !== prev.shuffle ||
    next.repeat !== prev.repeat ||
    Math.abs(next.duration - prev.duration) >= DURATION_DELTA_THRESHOLD_SEC;

  if (coreChanged) {
    return true;
  }

  if (next.playbackState === "stopped") {
    return false;
  }

  const elapsedWallSec = Math.max(0, (nowMs - prev.sentAtMs) / 1000);
  if (next.playbackState === "playing") {
    const expectedTime = prev.currentTime + elapsedWallSec;
    if (
      Math.abs(next.currentTime - expectedTime) >
      SEEK_DRIFT_THRESHOLD_PLAYING_SEC
    ) {
      return true;
    }

    return (
      nowMs - prev.sentAtMs >= PROGRESS_THROTTLE_MS &&
      Math.abs(next.currentTime - prev.currentTime) >= PROGRESS_MIN_DELTA_SEC
    );
  }

  return (
    Math.abs(next.currentTime - prev.currentTime) >=
    SEEK_DRIFT_THRESHOLD_PAUSED_SEC
  );
}

export function useMediaSession() {
  const isTauri = isTauriRuntime();

  // In Tauri su macOS disabilitiamo gli hook navigator.mediaSession di WebKit
  // così da non generare re-render su `progress` né conflitti con MPNowPlayingInfoCenter nativo.
  const currentTrack = usePlayerStore((s) => (isTauri ? null : s.currentTrack));
  const playbackStatus = usePlayerStore((s) =>
    isTauri ? "idle" : s.playbackStatus,
  );
  const progress = usePlayerStore((s) => (isTauri ? 0 : s.progress));
  const duration = usePlayerStore((s) => (isTauri ? 0 : s.duration));

  // 1a. Tauri macOS: ascolto comandi remoti nativi (NSDistributedNotificationCenter + MPRemoteCommandCenter)
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const bag = createListenerBag();
    bag.add(
      listen<PlayerCommandPayload>("player:command", (event) => {
        const payload = event.payload;
        if (!payload?.command) return;

        const store = usePlayerStore.getState();
        switch (payload.command) {
          case "play":
            store.resumePlayback();
            break;
          case "pause":
            store.pausePlayback();
            break;
          case "togglePlayPause":
            store.togglePlay();
            break;
          case "next":
            store.playNext();
            break;
          case "previous":
            store.playPrevious();
            break;
          case "seekTo":
            if (
              typeof payload.position === "number" &&
              Number.isFinite(payload.position)
            ) {
              store.seekTo(payload.position);
            }
            break;
          case "toggleShuffle":
            store.toggleShuffle();
            break;
          case "toggleRepeat":
            store.cycleRepeat();
            break;
          default:
            break;
        }
      }),
    );

    return () => {
      bag.dispose();
    };
  }, []);

  // 1b. Tauri macOS: push immediato su cambi traccia/stato/seek + throttling (1s) sul progresso temporale
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let lastSent: SyncSnapshot | null = null;

    const pushIfNeeded = () => {
      const next = buildMetadataFromStore();
      const nowMs = Date.now();
      if (!shouldSendMetadataUpdate(next, lastSent, nowMs)) {
        return;
      }

      lastSent = { ...next, sentAtMs: nowMs };
      void invoke("update_media_metadata", { payload: next }).catch(() => {
        // Non bloccare il player se la finestra è in fase di chiusura
      });
    };

    pushIfNeeded();
    const unsubscribe = usePlayerStore.subscribe(pushIfNeeded);

    return () => {
      unsubscribe();
    };
  }, []);

  // 2. Fallback WebKit navigator.mediaSession (attivo solo fuori dal runtime Tauri)
  useEffect(() => {
    if (isTauriRuntime() || !("mediaSession" in navigator)) return;

    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album || "IPPOS",
      artwork: [
        {
          src: currentTrack.cover,
          sizes: "544x544",
          type: "image/jpeg",
        },
      ],
    });
  }, [currentTrack]);

  useEffect(() => {
    if (isTauriRuntime() || !("mediaSession" in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.playbackState = "none";
      return;
    }
    navigator.mediaSession.playbackState =
      playbackStatus === "playing" ? "playing" : "paused";
  }, [currentTrack, playbackStatus]);

  useEffect(() => {
    if (isTauriRuntime() || !("mediaSession" in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    if (!currentTrack || !Number.isFinite(duration) || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.max(0, Math.min(duration, progress)),
      });
    } catch {
      // Alcuni stati transitori durante lo swap di traccia possono lanciare TypeError
    }
  }, [currentTrack, duration, progress]);

  useEffect(() => {
    if (isTauriRuntime() || !("mediaSession" in navigator)) return;

    const handlers: Array<
      [MediaSessionAction, MediaSessionActionHandler | null]
    > = [
      ["play", () => usePlayerStore.getState().resumePlayback()],
      ["pause", () => usePlayerStore.getState().pausePlayback()],
      ["previoustrack", () => usePlayerStore.getState().playPrevious()],
      ["nexttrack", () => usePlayerStore.getState().playNext()],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") {
            usePlayerStore.getState().seekTo(details.seekTime);
          }
        },
      ],
      [
        "seekbackward",
        (details) => {
          const offset = details.seekOffset ?? 10;
          const current = usePlayerStore.getState().progress;
          usePlayerStore.getState().seekTo(Math.max(0, current - offset));
        },
      ],
      [
        "seekforward",
        (details) => {
          const offset = details.seekOffset ?? 10;
          const current = usePlayerStore.getState().progress;
          usePlayerStore.getState().seekTo(current + offset);
        },
      ],
      ["stop", () => usePlayerStore.getState().pausePlayback()],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Azione non supportata
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore cleanup
        }
      }
    };
  }, []);
}
