import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import {
  loadPersistedLibrary,
  scheduleLibrarySave,
} from "../services/libraryStorage";
import { usePlayerStore } from "../store/playerStore";

export function useLibraryPersistence() {
  const libraryHydrated = usePlayerStore((s) => s.libraryHydrated);
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const recentTracks = usePlayerStore((s) => s.recentTracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const playStats = usePlayerStore((s) => s.playStats);
  const downloadedTrackIds = usePlayerStore((s) => s.downloadedTrackIds);
  const preferences = usePlayerStore((s) => s.preferences);
  const volume = usePlayerStore((s) => s.volume);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const autoplayEnabled = usePlayerStore((s) => s.autoplayEnabled);
  const hydrateLibrary = usePlayerStore((s) => s.hydrateLibrary);
  const setDownloadedTrackIds = usePlayerStore((s) => s.setDownloadedTrackIds);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedLibrary().then(async (data) => {
      if (cancelled) return;
      hydrateLibrary(data);
      try {
        const diskIds = await invoke<string[]>("list_cached_audio_ids");
        if (!cancelled && Array.isArray(diskIds)) {
          setDownloadedTrackIds(diskIds);
        }
      } catch {
        // Ignore outside Tauri runtime
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hydrateLibrary, setDownloadedTrackIds]);

  useEffect(() => {
    if (!libraryHydrated) return;
    scheduleLibrarySave({
      likedTracks,
      recentTracks,
      playlists,
      playStats,
      downloadedTrackIds,
      preferences,
      settings: {
        volume,
        shuffle,
        repeat,
        autoplayEnabled,
      },
    });
  }, [
    libraryHydrated,
    likedTracks,
    recentTracks,
    playlists,
    playStats,
    downloadedTrackIds,
    preferences,
    volume,
    shuffle,
    repeat,
    autoplayEnabled,
  ]);
}
