import { useEffect, useState } from "react";
import { audioEngine } from "../services/audioEngine";
import { usePlayerStore } from "../store/playerStore";

export function formatSleepCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export function formatStopTime(targetEpochMs: number): string {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(targetEpochMs));
}

/**
 * Motore temporale per lo Sleep Timer con supporto opzionale a:
 * - "Finisci il brano corrente" (finishCurrentSong)
 * - "Fade out negli ultimi 10 secondi" (fadeOut non distruttivo sul volume utente)
 */
export function useSleepTimer() {
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  const fadeSeconds = usePlayerStore(
    (s) => s.preferences.sleepTimerFadeSeconds,
  );

  useEffect(() => {
    if (!sleepTimer.active || !sleepTimer.endsAt) {
      audioEngine.resetFade();
      return;
    }

    let timerId: number | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const state = usePlayerStore.getState();
      const timer = state.sleepTimer;
      if (!timer.active || !timer.endsAt) {
        audioEngine.resetFade();
        return;
      }

      const fadeWindowSec = Math.max(1, state.preferences.sleepTimerFadeSeconds);
      const fadeWindowMs = fadeWindowSec * 1000;
      let nextDelayMs = 500;

      if (!timer.waitingForTrackEnd) {
        const remainingMs = timer.endsAt - Date.now();
        if (remainingMs <= 0) {
          if (timer.finishCurrentSong && state.isPlaying && state.currentTrack) {
            state.setSleepTimerWaitingForTrackEnd();
          } else {
            state.completeSleepTimer();
            return;
          }
        } else if (
          !timer.finishCurrentSong &&
          timer.fadeOut &&
          remainingMs <= fadeWindowMs
        ) {
          const ratio = Math.max(0, Math.min(1, remainingMs / fadeWindowMs));
          audioEngine.setFadeMultiplier(ratio * ratio);
          nextDelayMs = 60;
        } else {
          audioEngine.resetFade();
          if (
            !timer.finishCurrentSong &&
            timer.fadeOut &&
            remainingMs <= fadeWindowMs + 1000
          ) {
            nextDelayMs = 100;
          }
        }
      } else {
        if (!state.currentTrack) {
          state.completeSleepTimer();
          return;
        }
        if (timer.fadeOut && state.isPlaying) {
          const duration =
            state.duration > 0
              ? state.duration
              : state.currentTrack.durationSeconds > 0
                ? state.currentTrack.durationSeconds
                : audioEngine.getDuration();
          const current = audioEngine.getCurrentTime();
          const remainingSec =
            duration > 0 ? duration - current : Number.POSITIVE_INFINITY;

          if (remainingSec <= fadeWindowSec && remainingSec >= 0) {
            const ratio = Math.max(
              0,
              Math.min(1, remainingSec / fadeWindowSec),
            );
            audioEngine.setFadeMultiplier(ratio * ratio);
            nextDelayMs = 60;
          } else {
            audioEngine.resetFade();
            if (remainingSec <= fadeWindowSec + 1.5) {
              nextDelayMs = 150;
            }
          }
        } else {
          audioEngine.resetFade();
        }
      }

      if (!cancelled) {
        timerId = window.setTimeout(tick, nextDelayMs);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    sleepTimer.active,
    sleepTimer.endsAt,
    sleepTimer.finishCurrentSong,
    sleepTimer.fadeOut,
    sleepTimer.waitingForTrackEnd,
    fadeSeconds,
  ]);
}

export function useSleepTimerDisplay() {
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sleepTimer.active || sleepTimer.waitingForTrackEnd) return;
    setNow(Date.now());
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [sleepTimer.active, sleepTimer.waitingForTrackEnd, sleepTimer.endsAt]);

  const remainingMs =
    sleepTimer.active && sleepTimer.endsAt
      ? Math.max(0, sleepTimer.endsAt - now)
      : 0;

  return {
    isActive: sleepTimer.active,
    waitingForTrackEnd: sleepTimer.waitingForTrackEnd,
    remainingMs,
    label: sleepTimer.waitingForTrackEnd
      ? "Fine brano"
      : formatSleepCountdown(remainingMs),
  };
}
