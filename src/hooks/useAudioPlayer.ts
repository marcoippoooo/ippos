import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { audioEngine } from "../services/audioEngine";
import {
  invalidateAudioStreamCache,
  resolveAudioStream,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";

export function useAudioPlayer() {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const playRequestId = usePlayerStore((s) => s.playRequestId);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const nextQueueTrackId = usePlayerStore((s) => s.queue[0]?.id ?? null);
  const preloadNextTrack = usePlayerStore(
    (s) => s.preferences.preloadNextTrack,
  );
  const lowDataMode = usePlayerStore((s) => s.preferences.lowDataMode);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);

  const loadSeqRef = useRef(0);
  const retriedRequestIdsRef = useRef<Set<number>>(new Set());

  // 1. Listener degli eventi nativi di HTMLAudioElement
  useEffect(() => {
    const audio = audioEngine.getElement();

    const onLoadStart = () => {
      const state = usePlayerStore.getState();
      if (state.currentTrack) {
        state.setPlaybackState({ playbackStatus: "loading", playbackError: null });
      }
    };

    const onWaiting = () => {
      const state = usePlayerStore.getState();
      if (state.currentTrack && state.isPlaying) {
        state.setPlaybackState({ playbackStatus: "loading" });
      }
    };

    const onLoadedMetadata = () => {
      const state = usePlayerStore.getState();
      if (
        state.currentTrack &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        state.syncTrackDuration(state.currentTrack.id, audio.duration, "audio");
      }
    };

    const onPlaying = () => {
      usePlayerStore.getState().setPlaybackState({
        playbackStatus: "playing",
        isPlaying: true,
        playbackError: null,
      });
    };

    const onPause = () => {
      const state = usePlayerStore.getState();
      if (!audio.ended && state.playbackStatus !== "loading") {
        state.setPlaybackState({
          playbackStatus: "paused",
          isPlaying: false,
        });
      }
    };

    const onTimeUpdate = () => {
      const state = usePlayerStore.getState();
      const rawCurrent =
        Number.isFinite(audio.currentTime) && audio.currentTime >= 0
          ? audio.currentTime
          : 0;
      const effectiveDuration =
        state.duration > 0
          ? state.duration
          : (state.currentTrack?.durationSeconds ?? 0);
      const current =
        effectiveDuration > 0
          ? Math.min(rawCurrent, effectiveDuration)
          : rawCurrent;
      const buffered = audioEngine.getBufferedEnd(current);
      state.setPlaybackState({
        progress: current,
        buffered,
      });
    };

    const onProgress = () => {
      const buffered = audioEngine.getBufferedEnd(audio.currentTime);
      usePlayerStore.getState().setPlaybackState({ buffered });
    };

    const onEnded = () => {
      usePlayerStore.getState().handleTrackEnded();
    };

    const onError = () => {
      if (!audioEngine.hasSource()) return;
      const state = usePlayerStore.getState();
      const track = state.currentTrack;
      if (!track) return;

      // Primo fallimento su questa richiesta: invalida la cache URL e ritenta una volta
      if (!retriedRequestIdsRef.current.has(state.playRequestId)) {
        retriedRequestIdsRef.current.add(state.playRequestId);
        invalidateAudioStreamCache(track.id);
        state.retryPlayback();
        return;
      }

      state.setPlaybackState({
        isPlaying: false,
        playbackStatus: "error",
        playbackError: "Impossibile riprodurre lo stream audio di questo brano.",
      });
    };

    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onLoadedMetadata);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onLoadedMetadata);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  // 2. Risoluzione stream + registrazione proxy Rust + avvio riproduzione
  useEffect(() => {
    if (!currentTrackId || playRequestId === 0) {
      return;
    }

    const seq = ++loadSeqRef.current;
    const forceRefresh = retriedRequestIdsRef.current.has(playRequestId);
    for (const id of retriedRequestIdsRef.current) {
      if (id < playRequestId - 10) {
        retriedRequestIdsRef.current.delete(id);
      }
    }

    const startPlayback = async () => {
      try {
        const resolved = await resolveAudioStream(currentTrackId, {
          forceRefresh,
        });
        if (loadSeqRef.current !== seq) return;

        usePlayerStore.getState().setCurrentStreamDetails({
          videoId: currentTrackId,
          mimeType: resolved.mimeType,
          codec: resolved.codec,
          bitrate: resolved.bitrate,
          itag: resolved.itag,
          sampleRate: resolved.sampleRate,
          audioChannels: resolved.audioChannels,
          audioQuality: resolved.audioQuality,
          contentLength: resolved.contentLength,
          durationSeconds: resolved.durationSeconds,
          clientUsed: resolved.clientUsed,
        });

        if (resolved.durationSeconds > 0) {
          usePlayerStore
            .getState()
            .syncTrackDuration(
              currentTrackId,
              resolved.durationSeconds,
              "stream",
            );
        }

        const proxyUrl = await invoke<string>("register_audio_stream", {
          url: resolved.url,
          userAgent: resolved.userAgent,
          contentType: resolved.mimeType,
        });
        if (loadSeqRef.current !== seq) return;

        await audioEngine.loadAndPlay(proxyUrl);
      } catch (err: unknown) {
        if (loadSeqRef.current !== seq) return;
        const message =
          err instanceof Error
            ? err.message
            : "Errore durante l'avvio dello stream audio.";
        usePlayerStore.getState().setPlaybackState({
          isPlaying: false,
          playbackStatus: "error",
          playbackError: message,
        });
      }
    };

    void startPlayback();

    return () => {
      loadSeqRef.current += 1;
    };
  }, [currentTrackId, playRequestId]);

  // 3. Sincronizza volume e mute sull'HTMLAudioElement
  useEffect(() => {
    audioEngine.setVolume(volume, isMuted);
  }, [volume, isMuted]);

  // 4. Preload opzionale della traccia successiva in coda
  useEffect(() => {
    if (
      !currentTrackId ||
      playbackStatus !== "playing" ||
      !preloadNextTrack ||
      lowDataMode ||
      !nextQueueTrackId
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void resolveAudioStream(nextQueueTrackId).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    currentTrackId,
    playbackStatus,
    nextQueueTrackId,
    preloadNextTrack,
    lowDataMode,
  ]);
}
