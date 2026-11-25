import { useCallback, useEffect, useRef } from "react";
import {
  fetchExploreFeed,
  fetchHomeFeed,
  formatNetworkError,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { HomeMoodFilter } from "../types/music";

export function useYTMusicFeeds() {
  const activeView = usePlayerStore((s) => s.activeView);
  const authHydrated = usePlayerStore((s) => s.authHydrated);
  const homeStatus = usePlayerStore((s) => s.homeStatus);
  const exploreStatus = usePlayerStore((s) => s.exploreStatus);
  const setHomeFeedState = usePlayerStore((s) => s.setHomeFeedState);
  const setExploreFeedState = usePlayerStore((s) => s.setExploreFeedState);
  const homeReqSeqRef = useRef(0);

  const loadHome = useCallback(
    async (filterOverride?: HomeMoodFilter, forceRefresh = false) => {
      const targetFilter = filterOverride ?? usePlayerStore.getState().homeFilter;
      const reqId = ++homeReqSeqRef.current;

      setHomeFeedState({
        homeFilter: targetFilter,
        homeStatus: "loading",
        homeError: null,
      });

      try {
        const data = await fetchHomeFeed(targetFilter, { forceRefresh });
        if (reqId !== homeReqSeqRef.current) return;
        setHomeFeedState({
          homeFilter: targetFilter,
          homeSections: data.sections,
          homePlaylists: data.playlists,
          homeStatus: "success",
          homeError: null,
        });
      } catch (err: unknown) {
        if (reqId !== homeReqSeqRef.current) return;
        setHomeFeedState({
          homeFilter: targetFilter,
          homeStatus: "error",
          homeError: formatNetworkError(err),
        });
      }
    },
    [setHomeFeedState],
  );

  const selectHomeFilter = useCallback(
    (filter: HomeMoodFilter) => {
      void loadHome(filter, false);
    },
    [loadHome],
  );

  const reloadHome = useCallback(
    () => loadHome(undefined, true),
    [loadHome],
  );

  const loadExplore = useCallback(async () => {
    setExploreFeedState({ exploreStatus: "loading", exploreError: null });
    try {
      const sections = await fetchExploreFeed();
      setExploreFeedState({
        exploreSections: sections,
        exploreStatus: "success",
        exploreError: null,
      });
    } catch (err: unknown) {
      setExploreFeedState({
        exploreStatus: "error",
        exploreError: formatNetworkError(err),
      });
    }
  }, [setExploreFeedState]);

  useEffect(() => {
    if (authHydrated && homeStatus === "idle") {
      void loadHome(undefined, false);
    }
  }, [authHydrated, homeStatus, loadHome]);

  useEffect(() => {
    if (authHydrated && activeView === "explore" && exploreStatus === "idle") {
      void loadExplore();
    }
  }, [authHydrated, activeView, exploreStatus, loadExplore]);

  return {
    reloadHome,
    selectHomeFilter,
    reloadExplore: loadExplore,
  };
}
