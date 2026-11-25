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
  const preferences = usePlayerStore((s) => s.preferences);
  const volume = usePlayerStore((s) => s.volume);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const hydrateLibrary = usePlayerStore((s) => s.hydrateLibrary);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedLibrary().then((data) => {
      if (!cancelled) {
        hydrateLibrary(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hydrateLibrary]);

  useEffect(() => {
    if (!libraryHydrated) return;
    scheduleLibrarySave({
      likedTracks,
      recentTracks,
      playlists,
      playStats,
      preferences,
      settings: {
        volume,
        shuffle,
        repeat,
      },
    });
  }, [
    libraryHydrated,
    likedTracks,
    recentTracks,
    playlists,
    playStats,
    preferences,
    volume,
    shuffle,
    repeat,
  ]);
}
