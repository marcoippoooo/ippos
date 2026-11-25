import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { audioEngine } from "../services/audioEngine";
import {
  getRadioTracks,
  invalidateAudioStreamCache,
  resolveAudioStream,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { Track } from "../types/music";
import { isPlausibleAudioDuration } from "../utils/formatTime";

export function useAudioPlayer() {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const playRequestId = usePlayerStore((s) => s.playRequestId);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const nextQueueTrackId = usePlayerStore((s) => s.queue[0]?.id ?? null);
  const preloadNextTrack = usePlayerStore(
    (s) => s.preferences.preloadNextTrack,
  );
  const crossfadeSeconds = usePlayerStore(
    (s) => s.preferences.crossfadeSeconds,
  );
  const lowDataMode = usePlayerStore((s) => s.preferences.lowDataMode);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);

  const loadSeqRef = useRef(0);
  const retriedRequestIdsRef = useRef<Set<number>>(new Set());
  const lastEndedAtRef = useRef(0);
  const crossfadeClaimedRequestIdRef = useRef<number | null>(null);
  const crossfadeTriggeredReqIdRef = useRef<number | null>(null);
  const crossfadeRadioCacheRef = useRef<{
    reqId: number;
    tracks: Track[];
  } | null>(null);
  const crossfadeRadioLoadingReqIdRef = useRef<number | null>(null);

  // 1. Listener degli eventi dei deck audio (solo deck attivo) + motore crossfade
  useEffect(() => {
    const startCrossfadeTransition = async (
      sourcePlayRequestId: number,
      sourceTrackId: string,
      mode: "queue" | "repeat_all" | "radio",
      nextTrack: Track,
      radioList?: Track[],
    ) => {
      const fadeDurationSetting =
        usePlayerStore.getState().preferences.crossfadeSeconds;
      if (fadeDurationSetting <= 0) return;

      try {
        let proxyUrl: string | null = null;
        let resolved: Awaited<ReturnType<typeof resolveAudioStream>> | null =
          null;

        if (
          usePlayerStore.getState().downloadedTrackIds.includes(nextTrack.id)
        ) {
          try {
            const cachedOnDisk = await invoke<boolean>("is_audio_cached", {
              videoId: nextTrack.id,
            });
            if (cachedOnDisk) {
              proxyUrl = await invoke<string>("register_audio_stream", {
                videoId: nextTrack.id,
                url: null,
                contentType: "audio/mp4",
              });
            }
          } catch {
            proxyUrl = null;
          }
        }

        if (!proxyUrl) {
          resolved = await resolveAudioStream(nextTrack.id);
        }

        const latest = usePlayerStore.getState();
        if (
          latest.playRequestId !== sourcePlayRequestId ||
          latest.currentTrack?.id !== sourceTrackId ||
          !latest.isPlaying ||
          latest.playbackStatus !== "playing" ||
          latest.preferences.crossfadeSeconds <= 0 ||
          latest.repeat === "one" ||
          latest.sleepTimer.waitingForTrackEnd
        ) {
          return;
        }

        const effectiveDuration =
          latest.duration > 0
            ? latest.duration
            : latest.currentTrack.durationSeconds > 0
              ? latest.currentTrack.durationSeconds
              : audioEngine.getDuration();
        const remainingNow =
          effectiveDuration > 0
            ? effectiveDuration - audioEngine.getCurrentTime()
            : fadeDurationSetting;
        if (remainingNow <= 0.35) {
          return;
        }

        if (!proxyUrl && resolved) {
          proxyUrl = await invoke<string>("register_audio_stream", {
            videoId: nextTrack.id,
            url: resolved.url,
            userAgent: resolved.userAgent,
            contentType: resolved.mimeType,
          });
        }
        if (!proxyUrl) return;

        const postProxy = usePlayerStore.getState();
        if (
          postProxy.playRequestId !== sourcePlayRequestId ||
          postProxy.currentTrack?.id !== sourceTrackId ||
          !postProxy.isPlaying ||
          postProxy.playbackStatus !== "playing"
        ) {
          return;
        }

        const remainingAfterProxy =
          effectiveDuration > 0
            ? effectiveDuration - audioEngine.getCurrentTime()
            : postProxy.preferences.crossfadeSeconds;
        const actualFade = Math.max(
          0.5,
          Math.min(postProxy.preferences.crossfadeSeconds, remainingAfterProxy - 0.15),
        );
        if (remainingAfterProxy <= 0.35) {
          return;
        }

        const targetPlayReqId = postProxy.playRequestId + 1;
        crossfadeClaimedRequestIdRef.current = targetPlayReqId;

        await audioEngine.crossfadeTo(proxyUrl, actualFade);

        const afterCrossfade = usePlayerStore.getState();
        if (
          afterCrossfade.playRequestId !== sourcePlayRequestId ||
          afterCrossfade.currentTrack?.id !== sourceTrackId
        ) {
          crossfadeClaimedRequestIdRef.current = null;
          return;
        }

        if (mode === "radio" && radioList && radioList.length > 0) {
          afterCrossfade.playTrack(radioList[0], radioList);
        } else {
          afterCrossfade.playNext();
        }

        if (resolved) {
          usePlayerStore.getState().setCurrentStreamDetails({
            videoId: nextTrack.id,
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
                nextTrack.id,
                resolved.durationSeconds,
                "stream",
              );
          }
        } else {
          usePlayerStore.getState().setCurrentStreamDetails({
            videoId: nextTrack.id,
            mimeType: "audio/mp4",
            codec: "mp4a.40.2 (Offline)",
            bitrate: 0,
            audioQuality: "AUDIO_QUALITY_HIGH",
            durationSeconds:
              nextTrack.durationSeconds > 0 ? nextTrack.durationSeconds : 0,
            clientUsed: "LOCAL_CACHE",
          });
        }
      } catch {
        crossfadeClaimedRequestIdRef.current = null;
      }
    };

    const unsubscribe = audioEngine.subscribeEvents({
      onLoadStart: () => {
        const state = usePlayerStore.getState();
        if (state.currentTrack) {
          state.setPlaybackState({
            playbackStatus: "loading",
            playbackError: null,
          });
        }
      },

      onWaiting: () => {
        const state = usePlayerStore.getState();
        if (state.currentTrack && state.isPlaying) {
          state.setPlaybackState({ playbackStatus: "loading" });
        }
      },

      onLoadedMetadata: (audioDuration) => {
        const state = usePlayerStore.getState();
        if (
          state.currentTrack &&
          Number.isFinite(audioDuration) &&
          audioDuration > 0
        ) {
          state.syncTrackDuration(
            state.currentTrack.id,
            audioDuration,
            "audio",
          );
        }
      },

      onPlaying: () => {
        usePlayerStore.getState().setPlaybackState({
          playbackStatus: "playing",
          isPlaying: true,
          playbackError: null,
        });
      },

      onPause: (ended) => {
        const state = usePlayerStore.getState();
        if (!ended && state.playbackStatus !== "loading") {
          state.setPlaybackState({
            playbackStatus: "paused",
            isPlaying: false,
          });
        }
      },

      onEnded: () => {
        const now = Date.now();
        if (now - lastEndedAtRef.current < 800) {
          return;
        }
        lastEndedAtRef.current = now;
        usePlayerStore.getState().handleTrackEnded();
      },

      onTimeUpdate: (rawCurrent, audioDuration) => {
        const state = usePlayerStore.getState();
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

        // Safety net per bug AVFoundation macOS (durata 2x su fMP4 DASH): forza fine brano se oltrepassa la durata reale.
        if (
          state.isPlaying &&
          state.playbackStatus === "playing" &&
          effectiveDuration > 0 &&
          audioDuration > effectiveDuration * 1.4 &&
          !isPlausibleAudioDuration(audioDuration, effectiveDuration) &&
          rawCurrent >= effectiveDuration + 1.0
        ) {
          audioEngine.pause();
          const now = Date.now();
          if (now - lastEndedAtRef.current >= 800) {
            lastEndedAtRef.current = now;
            state.handleTrackEnded();
          }
          return;
        }

        // Logica Crossfade / transizione sfumata anticipata
        const fadeSec = state.preferences.crossfadeSeconds;
        if (
          fadeSec <= 0 ||
          !state.currentTrack ||
          !state.isPlaying ||
          state.playbackStatus !== "playing" ||
          state.repeat === "one" ||
          state.sleepTimer.waitingForTrackEnd ||
          effectiveDuration <= fadeSec * 2 + 2
        ) {
          return;
        }

        const remaining = effectiveDuration - rawCurrent;
        if (
          crossfadeTriggeredReqIdRef.current === state.playRequestId &&
          remaining > fadeSec + 1.5
        ) {
          crossfadeTriggeredReqIdRef.current = null;
        }

        if (
          state.queue.length === 0 &&
          state.repeat === "off" &&
          state.autoplayEnabled &&
          remaining <= fadeSec + 4 &&
          remaining > 0.5 &&
          crossfadeRadioCacheRef.current?.reqId !== state.playRequestId &&
          crossfadeRadioLoadingReqIdRef.current !== state.playRequestId
        ) {
          const reqId = state.playRequestId;
          const trackId = state.currentTrack.id;
          const historySnapshot = state.history;
          crossfadeRadioLoadingReqIdRef.current = reqId;
          void getRadioTracks(trackId)
            .then((tracks) => {
              const recentIds = new Set(
                historySnapshot.slice(0, 12).map((t) => t.id),
              );
              recentIds.add(trackId);
              const fresh = tracks.filter((t) => !recentIds.has(t.id));
              const candidates =
                fresh.length > 0
                  ? fresh
                  : tracks.filter((t) => t.id !== trackId);
              if (usePlayerStore.getState().playRequestId === reqId) {
                crossfadeRadioCacheRef.current = { reqId, tracks: candidates };
              }
            })
            .catch(() => {})
            .finally(() => {
              if (crossfadeRadioLoadingReqIdRef.current === reqId) {
                crossfadeRadioLoadingReqIdRef.current = null;
              }
            });
        }

        if (
          remaining > fadeSec ||
          remaining <= 0.35 ||
          crossfadeTriggeredReqIdRef.current === state.playRequestId
        ) {
          return;
        }

        let mode: "queue" | "repeat_all" | "radio" | null = null;
        let nextTrack: Track | null = null;
        let radioList: Track[] | undefined;

        if (state.queue.length > 0) {
          mode = "queue";
          nextTrack = state.queue[0];
        } else if (
          !state.shuffle &&
          state.repeat === "all" &&
          state.playbackContext.length > 1
        ) {
          mode = "repeat_all";
          nextTrack = state.playbackContext[0];
        } else if (
          state.repeat === "off" &&
          state.autoplayEnabled &&
          crossfadeRadioCacheRef.current?.reqId === state.playRequestId &&
          crossfadeRadioCacheRef.current.tracks.length > 0
        ) {
          mode = "radio";
          radioList = crossfadeRadioCacheRef.current.tracks;
          nextTrack = radioList[0];
        }

        if (!mode || !nextTrack) {
          return;
        }

        crossfadeTriggeredReqIdRef.current = state.playRequestId;
        void startCrossfadeTransition(
          state.playRequestId,
          state.currentTrack.id,
          mode,
          nextTrack,
          radioList,
        );
      },

      onProgress: (buffered) => {
        usePlayerStore.getState().setPlaybackState({ buffered });
      },

      onError: () => {
        if (!audioEngine.hasSource()) return;
        const state = usePlayerStore.getState();
        const track = state.currentTrack;
        if (!track) return;

        // Primo fallimento su questa richiesta: invalida la cache URL e ritenta una volta sul prossimo playRequestId
        if (!retriedRequestIdsRef.current.has(state.playRequestId)) {
          const nextReqId = state.playRequestId + 1;
          retriedRequestIdsRef.current.add(nextReqId);
          invalidateAudioStreamCache(track.id);
          state.retryPlayback();
          return;
        }

        state.setPlaybackState({
          isPlaying: false,
          playbackStatus: "error",
          playbackError:
            "Impossibile riprodurre lo stream audio di questo brano.",
        });
      },
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 2. Risoluzione stream + registrazione proxy Rust + avvio riproduzione
  useEffect(() => {
    if (!currentTrackId || playRequestId === 0) {
      return;
    }

    lastEndedAtRef.current = 0;

    if (crossfadeClaimedRequestIdRef.current === playRequestId) {
      crossfadeClaimedRequestIdRef.current = null;
      if (!audioEngine.isPaused()) {
        usePlayerStore.getState().setPlaybackState({
          playbackStatus: "playing",
          isPlaying: true,
          playbackError: null,
        });
      }
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
        let proxyUrl: string | null = null;
        const trackSnapshot = usePlayerStore.getState().currentTrack;
        const isLocallyCached =
          !forceRefresh &&
          usePlayerStore
            .getState()
            .downloadedTrackIds.includes(currentTrackId);

        if (isLocallyCached) {
          try {
            const cachedOnDisk = await invoke<boolean>("is_audio_cached", {
              videoId: currentTrackId,
            });
            if (loadSeqRef.current !== seq) return;
            if (cachedOnDisk) {
              proxyUrl = await invoke<string>("register_audio_stream", {
                videoId: currentTrackId,
                url: null,
                contentType: "audio/mp4",
              });
              if (loadSeqRef.current !== seq) return;

              usePlayerStore.getState().setCurrentStreamDetails({
                videoId: currentTrackId,
                mimeType: "audio/mp4",
                codec: "mp4a.40.2 (Offline)",
                bitrate: 0,
                audioQuality: "AUDIO_QUALITY_HIGH",
                durationSeconds:
                  trackSnapshot?.durationSeconds &&
                  trackSnapshot.durationSeconds > 0
                    ? trackSnapshot.durationSeconds
                    : 0,
                clientUsed: "LOCAL_CACHE",
              });
            }
          } catch {
            proxyUrl = null;
          }
        }

        if (!proxyUrl) {
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

          proxyUrl = await invoke<string>("register_audio_stream", {
            videoId: currentTrackId,
            url: resolved.url,
            userAgent: resolved.userAgent,
            contentType: resolved.mimeType,
          });
          if (loadSeqRef.current !== seq) return;
        }

        if (!usePlayerStore.getState().isPlaying) {
          audioEngine.loadSource(proxyUrl);
          usePlayerStore.getState().setPlaybackState({
            playbackStatus: "paused",
            playbackError: null,
          });
          return;
        }

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

  // 3. Sincronizza volume e mute sul motore audio
  useEffect(() => {
    audioEngine.setVolume(volume, isMuted);
  }, [volume, isMuted]);

  // 4. Preload opzionale della traccia successiva in coda (o obbligatorio con crossfade attivo)
  useEffect(() => {
    if (
      !currentTrackId ||
      playbackStatus !== "playing" ||
      (!preloadNextTrack && crossfadeSeconds <= 0) ||
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
    crossfadeSeconds,
    lowDataMode,
  ]);
}
