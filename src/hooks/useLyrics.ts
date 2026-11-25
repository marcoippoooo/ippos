import { useCallback, useEffect, useState } from "react";
import { fetchLyricsForTrack } from "../services/lyricsService";
import { usePlayerStore } from "../store/playerStore";
import { AsyncStatus, LyricsData } from "../types/music";

interface UseLyricsResult {
  status: AsyncStatus;
  data: LyricsData | null;
  error: string | null;
  retry: () => void;
}

export function useLyrics(): UseLyricsResult {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const duration = usePlayerStore((s) => s.duration);
  const lyricsProviderPriority = usePlayerStore(
    (s) => s.preferences.lyricsProviderPriority,
  );
  const trackId = currentTrack?.id ?? null;

  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [data, setData] = useState<LyricsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!currentTrack || !trackId) {
      setStatus("idle");
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setData(null);
    setError(null);

    const effectiveDuration =
      currentTrack.durationSeconds > 0 ? currentTrack.durationSeconds : duration;

    void fetchLyricsForTrack(
      currentTrack,
      effectiveDuration,
      lyricsProviderPriority,
    )
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Errore durante il caricamento del testo.",
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [trackId, lyricsProviderPriority, retryNonce]);

  return { status, data, error, retry };
}
