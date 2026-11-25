import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../store/playerStore";

interface DiscordSyncSnapshot {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  durationSec: number;
  positionSec: number;
  artworkUrl: string;
  sentAtMs: number;
}

const SEEK_DRIFT_THRESHOLD_SEC = 2.5;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useDiscordPresence() {
  const enabled = usePlayerStore(
    (s) => s.preferences.discordRichPresenceEnabled,
  );
  const lastSnapshotRef = useRef<DiscordSyncSnapshot | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    if (!enabled) {
      lastSnapshotRef.current = null;
      void invoke("clear_discord_activity").catch(() => {});
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      void invoke("init_discord_rpc", { clientId: null }).catch(() => {});
    }

    const syncNow = () => {
      const state = usePlayerStore.getState();
      if (!state.preferences.discordRichPresenceEnabled) return;

      const track = state.currentTrack;
      if (
        !track ||
        state.playbackStatus === "idle" ||
        state.playbackStatus === "error"
      ) {
        if (lastSnapshotRef.current !== null) {
          lastSnapshotRef.current = null;
          void invoke("clear_discord_activity").catch(() => {});
        }
        return;
      }

      const isPlaying = state.playbackStatus === "playing";
      const rawDuration =
        state.duration > 0 ? state.duration : track.durationSeconds;
      const durationSec =
        Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
      const positionSec =
        Number.isFinite(state.progress) && state.progress > 0
          ? state.progress
          : 0;
      const artworkUrl =
        track.cover && !track.cover.startsWith("data:") ? track.cover : "";
      const album = track.album || "IPPOS";
      const nowMs = Date.now();

      const prev = lastSnapshotRef.current;
      const metadataChanged =
        !prev ||
        prev.trackId !== track.id ||
        prev.title !== track.title ||
        prev.artist !== track.artist ||
        prev.album !== album ||
        prev.isPlaying !== isPlaying ||
        prev.artworkUrl !== artworkUrl ||
        Math.abs(prev.durationSec - durationSec) >= 1.0;

      let seekDrifted = false;
      if (!metadataChanged && prev && isPlaying) {
        const elapsedSec = Math.max(0, (nowMs - prev.sentAtMs) / 1000);
        const expectedPos = prev.positionSec + elapsedSec;
        seekDrifted = Math.abs(positionSec - expectedPos) > SEEK_DRIFT_THRESHOLD_SEC;
      }

      if (!metadataChanged && !seekDrifted) {
        return;
      }

      lastSnapshotRef.current = {
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        album,
        isPlaying,
        durationSec,
        positionSec,
        artworkUrl,
        sentAtMs: nowMs,
      };

      void invoke("set_discord_activity", {
        payload: {
          title: track.title,
          artist: track.artist,
          album,
          isPlaying,
          positionSec,
          durationSec,
          artworkUrl,
        },
      }).catch(() => {});
    };

    syncNow();
    const unsubscribe = usePlayerStore.subscribe(syncNow);
    return () => {
      unsubscribe();
    };
  }, [enabled]);
}
