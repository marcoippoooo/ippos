import { useEffect, useRef } from "react";
import { formatNetworkError, searchYTMusicCatalog } from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { SearchFilter } from "../types/music";

const SEARCH_DEBOUNCE_MS = 400;

export function useYTMusicSearch() {
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const searchFilter = usePlayerStore((s) => s.searchFilter);
  const searchNonce = usePlayerStore((s) => s.searchNonce);
  const setSearchState = usePlayerStore((s) => s.setSearchState);

  const requestIdRef = useRef(0);
  const prevFilterRef = useRef<SearchFilter>(searchFilter);
  const prevNonceRef = useRef<number>(searchNonce);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const filterChanged = prevFilterRef.current !== searchFilter;
    const nonceChanged = prevNonceRef.current !== searchNonce;
    prevFilterRef.current = searchFilter;
    prevNonceRef.current = searchNonce;

    if (!trimmed) {
      requestIdRef.current += 1;
      setSearchState({
        searchResults: [],
        searchArtists: [],
        searchStatus: "idle",
        searchError: null,
      });
      return;
    }

    const requestId = ++requestIdRef.current;
    const delayMs = filterChanged || nonceChanged ? 0 : SEARCH_DEBOUNCE_MS;

    setSearchState({
      searchStatus: "loading",
      searchError: null,
    });

    const timer = window.setTimeout(async () => {
      try {
        const { tracks, artists } = await searchYTMusicCatalog(
          trimmed,
          searchFilter,
        );
        if (requestIdRef.current !== requestId) return;
        setSearchState({
          searchResults: tracks,
          searchArtists: artists,
          searchStatus: "success",
          searchError: null,
        });
      } catch (err: unknown) {
        if (requestIdRef.current !== requestId) return;
        setSearchState({
          searchResults: [],
          searchArtists: [],
          searchStatus: "error",
          searchError: formatNetworkError(err),
        });
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery, searchFilter, searchNonce, setSearchState]);
}
