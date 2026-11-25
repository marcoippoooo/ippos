import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { audioEngine, EQUALIZER_PRESETS } from "../services/audioEngine";
import { clearAuthSession } from "../services/authStorage";
import { DEFAULT_THEME_PALETTE } from "../services/colorExtractor";
import {
  DEFAULT_APP_PREFERENCES,
  PersistedLibrary,
  sanitizeEqualizer,
} from "../services/libraryStorage";
import {
  addTrackToRemotePlaylist,
  clearRemotePlaylistCache,
  createRemotePlaylist,
  fetchRemotePlaylists,
  formatNetworkError,
  getRadioTracks,
  invalidateAudioStreamCache,
  isAuthExpiredError,
  removeTrackFromRemotePlaylist,
  resolveAudioStream,
  seedRemotePlaylistCache,
  setPlaybackAndContentConfig,
  setPreferredAudioFormat,
  setYTMusicAuthCookie,
} from "../services/ytmusic";
import {
  formatTime,
  isPlausibleAudioDuration,
  sanitizeDurationSeconds,
} from "../utils/formatTime";
import { useToastStore } from "./toastStore";
import {
  AppPreferences,
  ArtistSummary,
  AsyncStatus,
  AuthStatus,
  AuthUser,
  CreatePlaylistParams,
  CreatePlaylistResult,
  EqualizerBands,
  EqualizerConfig,
  EqualizerPresetId,
  FeedSection,
  HomeMoodFilter,
  HomePlaylist,
  LibraryTab,
  PlaybackStatus,
  RemotePlaylist,
  RepeatMode,
  SearchFilter,
  SelectedArtist,
  SleepTimerState,
  StreamTechnicalDetails,
  ThemePalette,
  Track,
  TrackPlayStat,
  UserPlaylist,
  ViewMode,
} from "../types/music";

const MAX_RECENT_TRACKS = 50;
const MAX_PLAY_STATS = 200;
const RECENTLY_CREATED_REMOTE_TTL_MS = 90_000;

let inFlightRemotePlaylistsRefresh: Promise<void> | null = null;
let remoteSyncGeneration = 0;
let autoplayRequestGen = 0;
const recentlyCreatedRemotePlaylists = new Map<
  string,
  { playlist: RemotePlaylist; createdAt: number }
>();

function normalizePlaylistKey(playlistId: string): string {
  return playlistId.trim().replace(/^VL/, "");
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function removeFirstById(tracks: Track[], id: string): Track[] {
  const idx = tracks.findIndex((t) => t.id === id);
  if (idx < 0) return tracks;
  return [...tracks.slice(0, idx), ...tracks.slice(idx + 1)];
}

function restoreOriginalOrder(
  currentQueue: Track[],
  originalQueue: Track[],
): Track[] {
  const remainingCounts = new Map<string, number>();
  for (const t of currentQueue) {
    remainingCounts.set(t.id, (remainingCounts.get(t.id) ?? 0) + 1);
  }

  const ordered: Track[] = [];
  for (const t of originalQueue) {
    const count = remainingCounts.get(t.id) ?? 0;
    if (count > 0) {
      ordered.push(t);
      remainingCounts.set(t.id, count - 1);
    }
  }

  for (const t of currentQueue) {
    const count = remainingCounts.get(t.id) ?? 0;
    if (count > 0) {
      ordered.push(t);
      remainingCounts.set(t.id, count - 1);
    }
  }

  return ordered;
}

function patchTrackDuration(
  track: Track,
  videoId: string,
  formatted: string,
  rounded: number,
  overwriteExisting: boolean,
): Track {
  if (track.id !== videoId) return track;
  const needsUpdate =
    !track.duration ||
    track.durationSeconds <= 0 ||
    (overwriteExisting && track.durationSeconds !== rounded);
  if (!needsUpdate) return track;
  return {
    ...track,
    duration: formatted,
    durationSeconds: rounded,
  };
}

function recordRecentTrack(recentTracks: Track[], track: Track): Track[] {
  return [track, ...recentTracks.filter((t) => t.id !== track.id)].slice(
    0,
    MAX_RECENT_TRACKS,
  );
}

function recordPlayStat(
  playStats: Record<string, TrackPlayStat>,
  track: Track,
): Record<string, TrackPlayStat> {
  const now = Date.now();
  const existing = playStats[track.id];
  const prevTimestamps = existing?.playTimestamps ?? (existing?.lastPlayedAt ? [existing.lastPlayedAt] : []);
  const nextEntry: TrackPlayStat = {
    track,
    playCount: (existing?.playCount ?? 0) + 1,
    lastPlayedAt: now,
    playTimestamps: [...prevTimestamps, now].slice(-60),
  };
  const next = {
    ...playStats,
    [track.id]: nextEntry,
  };

  const keys = Object.keys(next);
  if (keys.length <= MAX_PLAY_STATS) {
    return next;
  }

  const trimmed = Object.values(next)
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, MAX_PLAY_STATS);
  const compacted: Record<string, TrackPlayStat> = {};
  for (const item of trimmed) {
    compacted[item.track.id] = item;
  }
  return compacted;
}

function createPlaylistId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const EQ_LOCAL_STORAGE_KEY = "ippos.equalizer.v1";

function loadEqualizerFromLocalStorage(): EqualizerConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EQ_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeEqualizer(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveEqualizerToLocalStorage(config: EqualizerConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EQ_LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
}

interface PlayerState {
  currentTrack: Track | null;
  currentStreamDetails: StreamTechnicalDetails | null;
  isPlaying: boolean;
  playbackStatus: PlaybackStatus;
  playbackError: string | null;
  volume: number;
  isMuted: boolean;
  progress: number;
  duration: number;
  buffered: number;
  playRequestId: number;
  queue: Track[];
  originalQueue: Track[] | null;
  playbackContext: Track[];
  history: Track[];
  likedTracks: Track[];
  recentTracks: Track[];
  playlists: UserPlaylist[];
  playStats: Record<string, TrackPlayStat>;
  downloadedTrackIds: string[];
  downloadingTrackIds: Record<string, boolean>;
  offlineCacheRevision: number;
  libraryHydrated: boolean;
  activeView: ViewMode;
  previousViewBeforeArtist: ViewMode;
  previousViewBeforeLyrics: ViewMode;
  previousViewBeforeSearch: ViewMode;
  selectedArtist: SelectedArtist | null;
  libraryTab: LibraryTab;
  isQueueOpen: boolean;
  isNowPlayingOpen: boolean;
  isCinemaMode: boolean;
  isSleepTimerOpen: boolean;
  isCreatePlaylistModalOpen: boolean;
  createPlaylistInitialTrack: Track | null;
  contextMenuTrack: Track | null;
  trackLyricsOffsets: Record<string, number>;
  sleepTimer: SleepTimerState;
  preferences: AppPreferences;
  shuffle: boolean;
  repeat: RepeatMode;
  autoplayEnabled: boolean;
  autoplayLoading: boolean;
  themePalette: ThemePalette;

  searchQuery: string;
  searchFilter: SearchFilter;
  searchResults: Track[];
  searchArtists: ArtistSummary[];
  searchStatus: AsyncStatus;
  searchError: string | null;
  searchNonce: number;

  homeFilter: HomeMoodFilter;
  homeSections: FeedSection[];
  homePlaylists: HomePlaylist[];
  homeStatus: AsyncStatus;
  homeError: string | null;

  exploreSections: FeedSection[];
  exploreStatus: AsyncStatus;
  exploreError: string | null;

  authStatus: AuthStatus;
  authUser: AuthUser | null;
  authHydrated: boolean;
  authNotice: string | null;
  remotePlaylists: RemotePlaylist[];
  remotePlaylistsStatus: AsyncStatus;
  remotePlaylistsError: string | null;
  remotePlaylistTrackIds: Record<string, string[]>;
  remotePlaylistMutatingKeys: Record<string, boolean>;

  playTrack: (track: Track, contextTracks?: Track[]) => void;
  togglePlay: () => void;
  resumePlayback: () => void;
  pausePlayback: () => void;
  retryPlayback: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  seekTo: (sec: number) => void;
  playNext: () => void;
  playPrevious: () => void;
  handleTrackEnded: () => void;
  toggleLike: (track: Track) => void;
  addToQueue: (track: Track) => void;
  enqueueNext: (track: Track) => void;
  addTracksToQueue: (tracks: Track[], sourceLabel?: string) => void;
  setQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  playFromQueue: (index: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleAutoplay: () => void;
  setAutoplayEnabled: (enabled: boolean) => void;
  setActiveView: (view: ViewMode) => void;
  toggleLyricsView: () => void;
  openSearchView: () => void;
  openArtist: (artist: SelectedArtist) => void;
  closeArtistView: () => void;
  setLibraryTab: (tab: LibraryTab) => void;
  toggleQueue: () => void;
  setQueueOpen: (open: boolean) => void;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  toggleCinemaMode: () => void;
  setCinemaMode: (open: boolean) => void;
  adjustTrackLyricsOffset: (trackId: string, deltaSec: number) => void;
  resetTrackLyricsOffset: (trackId: string) => void;
  openSleepTimer: () => void;
  closeSleepTimer: () => void;
  openCreatePlaylistModal: (initialTrack?: Track | null) => void;
  closeCreatePlaylistModal: () => void;
  openTrackMenu: (track: Track) => void;
  closeTrackMenu: () => void;
  startSleepTimer: (opts: {
    minutes: number;
    finishCurrentSong: boolean;
    fadeOut: boolean;
  }) => void;
  cancelSleepTimer: () => void;
  setSleepTimerWaitingForTrackEnd: () => void;
  completeSleepTimer: () => void;
  setCurrentStreamDetails: (details: StreamTechnicalDetails | null) => void;
  updatePreferences: (partial: Partial<AppPreferences>) => void;
  setEqualizerEnabled: (enabled: boolean) => void;
  setEqualizerPreset: (preset: Exclude<EqualizerPresetId, "custom">) => void;
  setEqualizerBand: (bandIndex: number, gainDb: number) => void;
  resetEqualizer: () => void;
  setThemePalette: (palette: ThemePalette) => void;

  hydrateLibrary: (data: PersistedLibrary) => void;
  setDownloadedTrackIds: (ids: string[]) => void;
  downloadTrack: (track: Track) => Promise<boolean>;
  removeDownloadedTrack: (videoId: string) => Promise<boolean>;
  clearAllDownloadedTracks: () => Promise<void>;
  clearRecentTracks: () => void;
  clearPlayStats: () => void;
  createPlaylist: (
    params: CreatePlaylistParams,
  ) => Promise<CreatePlaylistResult | null>;
  deletePlaylist: (playlistId: string) => void;
  renamePlaylist: (playlistId: string, name: string) => void;
  addTrackToPlaylist: (
    playlistId: string,
    track: Track,
    options?: { allowDuplicate?: boolean },
  ) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;

  setPlaybackState: (partial: {
    isPlaying?: boolean;
    playbackStatus?: PlaybackStatus;
    playbackError?: string | null;
    progress?: number;
    duration?: number;
    buffered?: number;
  }) => void;
  syncTrackDuration: (
    videoId: string,
    durationSeconds: number,
    source?: "metadata" | "stream" | "audio",
  ) => void;

  setSearchQuery: (q: string) => void;
  setSearchFilter: (filter: SearchFilter) => void;
  triggerSearchNow: () => void;
  clearSearch: () => void;
  setSearchState: (partial: {
    searchResults?: Track[];
    searchArtists?: ArtistSummary[];
    searchStatus?: AsyncStatus;
    searchError?: string | null;
  }) => void;
  setHomeFilter: (filter: HomeMoodFilter) => void;
  setHomeFeedState: (partial: {
    homeFilter?: HomeMoodFilter;
    homeSections?: FeedSection[];
    homePlaylists?: HomePlaylist[];
    homeStatus?: AsyncStatus;
    homeError?: string | null;
  }) => void;
  setExploreFeedState: (partial: {
    exploreSections?: FeedSection[];
    exploreStatus?: AsyncStatus;
    exploreError?: string | null;
  }) => void;

  setAuthState: (partial: {
    authStatus?: AuthStatus;
    authUser?: AuthUser | null;
    authHydrated?: boolean;
    authNotice?: string | null;
  }) => void;
  setAuthNotice: (notice: string | null) => void;
  setRemotePlaylistsState: (partial: {
    remotePlaylists?: RemotePlaylist[];
    remotePlaylistsStatus?: AsyncStatus;
    remotePlaylistsError?: string | null;
  }) => void;
  setRemotePlaylistTrackIds: (playlistId: string, trackIds: string[]) => void;
  refreshRemotePlaylists: (options?: { silent?: boolean }) => Promise<void>;
  addTrackToRemotePlaylistOptimistic: (
    playlist: RemotePlaylist,
    track: Track,
    options?: { allowDuplicate?: boolean },
  ) => Promise<boolean>;
  removeTrackFromRemotePlaylistOptimistic: (
    playlist: RemotePlaylist,
    track: Track,
  ) => Promise<boolean>;
  createRemotePlaylistAndAddTrack: (
    title: string,
    track: Track,
  ) => Promise<boolean>;
  resetAuthToGuest: (notice?: string | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  const initialEqualizer =
    loadEqualizerFromLocalStorage() ?? DEFAULT_APP_PREFERENCES.equalizer;
  audioEngine.applyEqualizerConfig(initialEqualizer);

  const restartCurrentTrack = () => {
    const { currentTrack, playRequestId } = get();
    if (!currentTrack) return;

    audioEngine.resetFade();
    set({
      progress: 0,
      isPlaying: true,
      playbackStatus: "loading",
      playbackError: null,
    });

    void audioEngine.restart().then((ok) => {
      const latest = get();
      if (
        latest.currentTrack?.id !== currentTrack.id ||
        latest.playRequestId !== playRequestId ||
        !latest.isPlaying
      ) {
        return;
      }

      if (ok) {
        set({
          playbackStatus: "playing",
          isPlaying: true,
          playbackError: null,
        });
      } else {
        invalidateAudioStreamCache(currentTrack.id);
        latest.retryPlayback();
      }
    });
  };

  return {
  currentTrack: null,
  currentStreamDetails: null,
  isPlaying: false,
  playbackStatus: "idle",
  playbackError: null,
  volume: 0.8,
  isMuted: false,
  progress: 0,
  duration: 0,
  buffered: 0,
  playRequestId: 0,
  queue: [],
  originalQueue: null,
  playbackContext: [],
  history: [],
  likedTracks: [],
  recentTracks: [],
  playlists: [],
  playStats: {},
  downloadedTrackIds: [],
  downloadingTrackIds: {},
  offlineCacheRevision: 0,
  libraryHydrated: false,
  activeView: "home",
  previousViewBeforeArtist: "home",
  previousViewBeforeLyrics: "home",
  previousViewBeforeSearch: "home",
  selectedArtist: null,
  libraryTab: "overview",
  isQueueOpen: false,
  isNowPlayingOpen: false,
  isCinemaMode: false,
  isSleepTimerOpen: false,
  isCreatePlaylistModalOpen: false,
  createPlaylistInitialTrack: null,
  contextMenuTrack: null,
  trackLyricsOffsets: {},
  sleepTimer: {
    active: false,
    endsAt: null,
    durationMinutes: 30,
    finishCurrentSong: false,
    fadeOut: true,
    waitingForTrackEnd: false,
  },
  preferences: {
    ...DEFAULT_APP_PREFERENCES,
    equalizer: initialEqualizer,
  },
  shuffle: false,
  repeat: "off",
  autoplayEnabled: true,
  autoplayLoading: false,
  themePalette: DEFAULT_THEME_PALETTE,

  searchQuery: "",
  searchFilter: "song",
  searchResults: [],
  searchArtists: [],
  searchStatus: "idle",
  searchError: null,
  searchNonce: 0,

  homeFilter: "all",
  homeSections: [],
  homePlaylists: [],
  homeStatus: "idle",
  homeError: null,

  exploreSections: [],
  exploreStatus: "idle",
  exploreError: null,

  authStatus: "guest",
  authUser: null,
  authHydrated: false,
  authNotice: null,
  remotePlaylists: [],
  remotePlaylistsStatus: "idle",
  remotePlaylistsError: null,
  remotePlaylistTrackIds: {},
  remotePlaylistMutatingKeys: {},

  playTrack: (track, contextTracks) => {
    autoplayRequestGen += 1;
    const {
      currentTrack,
      history,
      recentTracks,
      playStats,
      playbackStatus,
      playRequestId,
      shuffle,
      queue,
      originalQueue,
      playbackContext,
      preferences,
    } = get();
    if (get().autoplayLoading) {
      set({ autoplayLoading: false });
    }
    if (currentTrack?.id === track.id && playbackStatus !== "error") {
      if (audioEngine.isEnded()) {
        if (contextTracks && contextTracks.length > 0) {
          const idx = contextTracks.findIndex((t) => t.id === track.id);
          const nextPlaybackContext =
            idx >= 0 ? [...contextTracks] : [track, ...contextTracks];
          const orderedRest =
            idx >= 0
              ? shuffle
                ? [
                    ...contextTracks.slice(idx + 1),
                    ...contextTracks.slice(0, idx),
                  ]
                : contextTracks.slice(idx + 1)
              : contextTracks.filter((t) => t.id !== track.id);

          set({
            playbackContext: nextPlaybackContext,
            originalQueue: shuffle ? orderedRest : null,
            queue: shuffle ? shuffleArray(orderedRest) : orderedRest,
          });
        }
        restartCurrentTrack();
        return;
      }
      get().togglePlay();
      return;
    }

    const nextHistory =
      currentTrack && currentTrack.id !== track.id
        ? [currentTrack, ...history.filter((t) => t.id !== currentTrack.id)].slice(
            0,
            30,
          )
        : history;

    let nextQueue = queue;
    let nextOriginalQueue = originalQueue;
    let nextPlaybackContext = playbackContext;

    if (contextTracks && contextTracks.length > 0) {
      const idx = contextTracks.findIndex((t) => t.id === track.id);
      nextPlaybackContext =
        idx >= 0 ? [...contextTracks] : [track, ...contextTracks];
      const orderedRest =
        idx >= 0
          ? shuffle
            ? [
                ...contextTracks.slice(idx + 1),
                ...contextTracks.slice(0, idx),
              ]
            : contextTracks.slice(idx + 1)
          : contextTracks.filter((t) => t.id !== track.id);

      if (shuffle) {
        nextOriginalQueue = orderedRest;
        nextQueue = shuffleArray(orderedRest);
      } else {
        nextOriginalQueue = null;
        nextQueue = orderedRest;
      }
    } else if (!playbackContext.some((t) => t.id === track.id)) {
      nextPlaybackContext = [track, ...queue];
    }

    audioEngine.resetFade();
    set({
      currentTrack: track,
      currentStreamDetails: null,
      queue: nextQueue,
      originalQueue: nextOriginalQueue,
      playbackContext: nextPlaybackContext,
      history: nextHistory,
      recentTracks: preferences.saveListeningHistory
        ? recordRecentTrack(recentTracks, track)
        : recentTracks,
      playStats: preferences.saveListeningHistory
        ? recordPlayStat(playStats, track)
        : playStats,
      progress: 0,
      buffered: 0,
      duration: sanitizeDurationSeconds(track.durationSeconds),
      playbackStatus: "loading",
      playbackError: null,
      isPlaying: true,
      playRequestId: playRequestId + 1,
    });
  },

  togglePlay: () => {
    const { currentTrack, playbackStatus, isPlaying } = get();
    if (!currentTrack) return;

    if (playbackStatus === "error") {
      get().retryPlayback();
      return;
    }

    if (isPlaying || playbackStatus === "playing") {
      get().pausePlayback();
    } else {
      get().resumePlayback();
    }
  },

  resumePlayback: () => {
    const { currentTrack, playbackStatus, playRequestId } = get();
    if (!currentTrack) return;

    audioEngine.resetFade();

    if (playbackStatus === "error" || !audioEngine.hasSource()) {
      set({
        playbackStatus: "loading",
        playbackError: null,
        isPlaying: true,
        playRequestId: playRequestId + 1,
      });
      return;
    }

    if (audioEngine.isEnded()) {
      audioEngine.seek(0);
      set({ progress: 0 });
    }

    set({ isPlaying: true, playbackError: null });
    void audioEngine.play().catch((err: unknown) => {
      const latest = get();
      if (latest.currentTrack && latest.playbackStatus !== "error") {
        invalidateAudioStreamCache(latest.currentTrack.id);
        latest.retryPlayback();
        return;
      }
      set({
        isPlaying: false,
        playbackStatus: "error",
        playbackError:
          err instanceof Error
            ? err.message
            : "Impossibile riprendere la riproduzione audio.",
      });
    });
  },

  pausePlayback: () => {
    autoplayRequestGen += 1;
    audioEngine.pause();
    audioEngine.resetFade();
    set((state) => ({
      autoplayLoading: false,
      isPlaying: false,
      playbackStatus:
        state.playbackStatus === "loading" ? "paused" : state.playbackStatus,
    }));
  },

  retryPlayback: () => {
    const { currentTrack, playRequestId } = get();
    if (!currentTrack) return;
    audioEngine.resetFade();
    set({
      playbackStatus: "loading",
      playbackError: null,
      currentStreamDetails: null,
      isPlaying: true,
      progress: 0,
      buffered: 0,
      playRequestId: playRequestId + 1,
    });
  },

  setVolume: (vol) => {
    const clamped = Math.max(0, Math.min(1, vol));
    set({ volume: clamped, isMuted: clamped === 0 });
  },

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  seekTo: (sec) => {
    const { currentTrack, duration } = get();
    if (!currentTrack) return;
    const total = duration > 0 ? duration : currentTrack.durationSeconds;
    const clamped = Math.max(0, total > 0 ? Math.min(total, sec) : sec);
    audioEngine.seek(clamped);
    set({ progress: clamped });
  },

  playNext: () => {
    autoplayRequestGen += 1;
    const {
      queue,
      originalQueue,
      playbackContext,
      currentTrack,
      history,
      recentTracks,
      playStats,
      shuffle,
      repeat,
      playRequestId,
      preferences,
    } = get();
    if (get().autoplayLoading) {
      set({ autoplayLoading: false });
    }
    if (queue.length === 0) {
      if (repeat === "all") {
        let orderedCycle: Track[] = [];
        if (playbackContext.length > 0) {
          orderedCycle = playbackContext;
        } else if (history.length > 0) {
          const seen = new Set<string>();
          for (const item of [...history].reverse()) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              orderedCycle.push(item);
            }
          }
          if (currentTrack && !seen.has(currentTrack.id)) {
            orderedCycle.push(currentTrack);
          }
        } else if (currentTrack) {
          orderedCycle = [currentTrack];
        }

        if (orderedCycle.length === 0) return;

        if (orderedCycle.length === 1) {
          restartCurrentTrack();
          return;
        }

        let nextQueue: Track[];
        let nextOriginal: Track[] | null = null;
        let first: Track;

        if (shuffle) {
          const shuffled = shuffleArray(orderedCycle);
          if (shuffled[0].id === currentTrack?.id && shuffled.length > 1) {
            [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
          }
          first = shuffled[0];
          nextQueue = shuffled.slice(1);
          nextOriginal = orderedCycle.filter((t) => t.id !== first.id);
        } else {
          first = orderedCycle[0];
          nextQueue = orderedCycle.slice(1);
        }

        const nextHistory =
          currentTrack && currentTrack.id !== first.id
            ? [
                currentTrack,
                ...history.filter((t) => t.id !== currentTrack.id),
              ].slice(0, 30)
            : history;

        audioEngine.resetFade();
        set({
          currentTrack: first,
          currentStreamDetails: null,
          queue: nextQueue,
          originalQueue: nextOriginal,
          playbackContext: orderedCycle,
          history: nextHistory,
          recentTracks: preferences.saveListeningHistory
            ? recordRecentTrack(recentTracks, first)
            : recentTracks,
          playStats: preferences.saveListeningHistory
            ? recordPlayStat(playStats, first)
            : playStats,
          progress: 0,
          buffered: 0,
          duration: sanitizeDurationSeconds(first.durationSeconds),
          playbackStatus: "loading",
          playbackError: null,
          isPlaying: true,
          playRequestId: playRequestId + 1,
        });
      }
      return;
    }

    const [nextTrack, ...remainingQueue] = queue;
    const nextOriginalQueue = originalQueue
      ? removeFirstById(originalQueue, nextTrack.id)
      : null;

    audioEngine.resetFade();
    set({
      currentTrack: nextTrack,
      currentStreamDetails: null,
      queue: remainingQueue,
      originalQueue: nextOriginalQueue,
      history: currentTrack
        ? [currentTrack, ...history.filter((t) => t.id !== currentTrack.id)].slice(
            0,
            30,
          )
        : history,
      recentTracks: preferences.saveListeningHistory
        ? recordRecentTrack(recentTracks, nextTrack)
        : recentTracks,
      playStats: preferences.saveListeningHistory
        ? recordPlayStat(playStats, nextTrack)
        : playStats,
      progress: 0,
      buffered: 0,
      duration: sanitizeDurationSeconds(nextTrack.durationSeconds),
      playbackStatus: "loading",
      playbackError: null,
      isPlaying: true,
      playRequestId: playRequestId + 1,
    });
  },

  playPrevious: () => {
    autoplayRequestGen += 1;
    const {
      history,
      currentTrack,
      queue,
      originalQueue,
      recentTracks,
      playStats,
      progress,
      playRequestId,
      preferences,
    } = get();
    if (get().autoplayLoading) {
      set({ autoplayLoading: false });
    }
    if (!currentTrack) return;

    if (progress > 3 || history.length === 0) {
      get().seekTo(0);
      return;
    }

    const [prevTrack, ...restHistory] = history;
    audioEngine.resetFade();
    set({
      currentTrack: prevTrack,
      currentStreamDetails: null,
      history: restHistory,
      queue: [currentTrack, ...queue],
      originalQueue:
        originalQueue !== null ? [currentTrack, ...originalQueue] : null,
      recentTracks: preferences.saveListeningHistory
        ? recordRecentTrack(recentTracks, prevTrack)
        : recentTracks,
      playStats: preferences.saveListeningHistory
        ? recordPlayStat(playStats, prevTrack)
        : playStats,
      progress: 0,
      buffered: 0,
      duration: sanitizeDurationSeconds(prevTrack.durationSeconds),
      playbackStatus: "loading",
      playbackError: null,
      isPlaying: true,
      playRequestId: playRequestId + 1,
    });
  },

  handleTrackEnded: () => {
    const {
      currentTrack,
      repeat,
      queue,
      history,
      playbackContext,
      sleepTimer,
      autoplayEnabled,
      playRequestId,
    } = get();
    if (sleepTimer.active && sleepTimer.waitingForTrackEnd) {
      get().completeSleepTimer();
      return;
    }

    if (!currentTrack) {
      set({ isPlaying: false, playbackStatus: "paused", progress: 0 });
      return;
    }

    if (repeat === "one") {
      restartCurrentTrack();
      return;
    }

    if (queue.length > 0) {
      get().playNext();
      return;
    }

    if (repeat === "all") {
      if (
        playbackContext.length > 1 ||
        (playbackContext.length === 0 && history.length > 0)
      ) {
        get().playNext();
      } else {
        restartCurrentTrack();
      }
      return;
    }

    if (autoplayEnabled) {
      if (get().autoplayLoading) return;
      const reqGen = ++autoplayRequestGen;
      const expectedPlayRequestId = playRequestId;
      const endedTrack = currentTrack;

      set({
        autoplayLoading: true,
        playbackStatus: "loading",
        playbackError: null,
      });

      void (async () => {
        const stopCleanly = () => {
          audioEngine.pause();
          audioEngine.resetFade();
          audioEngine.seek(0);
          set({
            autoplayLoading: false,
            isPlaying: false,
            playbackStatus: "paused",
            progress: 0,
          });
        };

        try {
          const radioTracks = await getRadioTracks(endedTrack.id);
          const latest = get();
          if (
            reqGen !== autoplayRequestGen ||
            !latest.autoplayEnabled ||
            latest.playRequestId !== expectedPlayRequestId ||
            latest.currentTrack?.id !== endedTrack.id ||
            latest.queue.length > 0 ||
            latest.repeat !== "off"
          ) {
            if (reqGen === autoplayRequestGen && latest.autoplayLoading) {
              set({ autoplayLoading: false });
            }
            return;
          }

          const recentIds = new Set(latest.history.slice(0, 12).map((t) => t.id));
          recentIds.add(endedTrack.id);
          const freshCandidates = radioTracks.filter((t) => !recentIds.has(t.id));
          const candidates =
            freshCandidates.length > 0
              ? freshCandidates
              : radioTracks.filter((t) => t.id !== endedTrack.id);

          if (candidates.length > 0) {
            set({ autoplayLoading: false });
            get().playTrack(candidates[0], candidates);
            useToastStore
              .getState()
              .showToast(`Radio infinita · ${candidates[0].title}`);
            return;
          }

          stopCleanly();
        } catch {
          if (reqGen !== autoplayRequestGen) return;
          stopCleanly();
        }
      })();
      return;
    }

    audioEngine.pause();
    audioEngine.resetFade();
    audioEngine.seek(0);
    set({ isPlaying: false, playbackStatus: "paused", progress: 0 });
  },

  toggleLike: (track) =>
    set((state) => {
      const exists = state.likedTracks.some((item) => item.id === track.id);
      return {
        likedTracks: exists
          ? state.likedTracks.filter((item) => item.id !== track.id)
          : [track, ...state.likedTracks],
      };
    }),

  addToQueue: (track) => {
    set((state) => {
      const baseCtx =
        state.playbackContext.length > 0
          ? state.playbackContext
          : state.currentTrack
            ? [state.currentTrack]
            : [];
      const nextCtx = baseCtx.some((t) => t.id === track.id)
        ? baseCtx
        : [...baseCtx, track];
      return {
        queue: [...state.queue, track],
        originalQueue:
          state.originalQueue !== null
            ? [...state.originalQueue, track]
            : null,
        playbackContext: nextCtx,
      };
    });
    useToastStore.getState().showToast(`Aggiunto alla coda: ${track.title}`);
  },

  enqueueNext: (track) => {
    set((state) => {
      const baseCtx =
        state.playbackContext.length > 0
          ? state.playbackContext
          : state.currentTrack
            ? [state.currentTrack]
            : [];
      const nextCtx = baseCtx.some((t) => t.id === track.id)
        ? baseCtx
        : [...baseCtx, track];
      return {
        queue: [track, ...state.queue],
        originalQueue:
          state.originalQueue !== null
            ? [track, ...state.originalQueue]
            : null,
        playbackContext: nextCtx,
      };
    });
    useToastStore
      .getState()
      .showToast(`In riproduzione dopo: ${track.title}`);
  },

  addTracksToQueue: (tracks, sourceLabel) => {
    if (tracks.length === 0) return;
    set((state) => {
      const baseCtx =
        state.playbackContext.length > 0
          ? state.playbackContext
          : state.currentTrack
            ? [state.currentTrack]
            : [];
      const existingIds = new Set(baseCtx.map((t) => t.id));
      const newForCtx = tracks.filter((t) => !existingIds.has(t.id));
      return {
        queue: [...state.queue, ...tracks],
        originalQueue:
          state.originalQueue !== null
            ? [...state.originalQueue, ...tracks]
            : null,
        playbackContext:
          newForCtx.length > 0 ? [...baseCtx, ...newForCtx] : baseCtx,
      };
    });
    const msg =
      tracks.length === 1
        ? `Aggiunto alla coda: ${tracks[0].title}`
        : sourceLabel
          ? `Aggiunti ${tracks.length} brani di ${sourceLabel} alla coda`
          : `Aggiunti ${tracks.length} brani alla coda`;
    useToastStore.getState().showToast(msg);
  },

  setQueue: (tracks) =>
    set((state) => ({
      originalQueue: state.shuffle ? [...tracks] : null,
      queue: state.shuffle ? shuffleArray(tracks) : tracks,
      playbackContext: state.currentTrack
        ? [
            state.currentTrack,
            ...tracks.filter((t) => t.id !== state.currentTrack!.id),
          ]
        : [...tracks],
    })),

  removeFromQueue: (index) =>
    set((state) => {
      const removed = state.queue[index];
      const nextQueue = state.queue.filter((_, i) => i !== index);
      const nextOriginalQueue =
        state.originalQueue !== null && removed
          ? removeFirstById(state.originalQueue, removed.id)
          : state.originalQueue;
      const nextPlaybackContext =
        removed && removed.id !== state.currentTrack?.id
          ? removeFirstById(state.playbackContext, removed.id)
          : state.playbackContext;
      return {
        queue: nextQueue,
        originalQueue: nextOriginalQueue,
        playbackContext: nextPlaybackContext,
      };
    }),

  reorderQueue: (fromIndex, toIndex) =>
    set((state) => {
      const len = state.queue.length;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= len ||
        toIndex >= len
      ) {
        return state;
      }
      const next = [...state.queue];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { queue: next };
    }),

  clearQueue: () =>
    set((state) => ({
      queue: [],
      originalQueue: null,
      playbackContext: state.currentTrack ? [state.currentTrack] : [],
    })),

  playFromQueue: (index) => {
    autoplayRequestGen += 1;
    const {
      queue,
      originalQueue,
      currentTrack,
      history,
      recentTracks,
      playStats,
      playRequestId,
      preferences,
    } = get();
    if (get().autoplayLoading) {
      set({ autoplayLoading: false });
    }
    const target = queue[index];
    if (!target) return;
    const skipped = queue.slice(0, index);
    const remaining = queue.slice(index + 1);
    const newHistory = [
      ...skipped.reverse(),
      ...(currentTrack ? [currentTrack] : []),
      ...history,
    ].slice(0, 30);

    let nextOriginalQueue = originalQueue;
    if (nextOriginalQueue !== null) {
      for (const item of skipped) {
        nextOriginalQueue = removeFirstById(nextOriginalQueue, item.id);
      }
      nextOriginalQueue = removeFirstById(nextOriginalQueue, target.id);
    }

    audioEngine.resetFade();
    set({
      currentTrack: target,
      currentStreamDetails: null,
      queue: remaining,
      originalQueue: nextOriginalQueue,
      history: newHistory,
      recentTracks: preferences.saveListeningHistory
        ? recordRecentTrack(recentTracks, target)
        : recentTracks,
      playStats: preferences.saveListeningHistory
        ? recordPlayStat(playStats, target)
        : playStats,
      progress: 0,
      buffered: 0,
      duration: sanitizeDurationSeconds(target.durationSeconds),
      playbackStatus: "loading",
      playbackError: null,
      isPlaying: true,
      playRequestId: playRequestId + 1,
    });
  },

  toggleShuffle: () =>
    set((state) => {
      if (!state.shuffle) {
        return {
          shuffle: true,
          originalQueue: [...state.queue],
          queue: shuffleArray(state.queue),
        };
      }
      const restored = state.originalQueue
        ? restoreOriginalOrder(state.queue, state.originalQueue)
        : state.queue;
      return {
        shuffle: false,
        originalQueue: null,
        queue: restored,
      };
    }),

  cycleRepeat: () =>
    set((state) => {
      const order: RepeatMode[] = ["off", "all", "one"];
      const next = order[(order.indexOf(state.repeat) + 1) % order.length];
      return { repeat: next };
    }),

  toggleAutoplay: () =>
    set((state) => {
      const next = !state.autoplayEnabled;
      if (!next) {
        autoplayRequestGen += 1;
      }
      return {
        autoplayEnabled: next,
        autoplayLoading: next ? state.autoplayLoading : false,
      };
    }),

  setAutoplayEnabled: (enabled) =>
    set((state) => {
      if (!enabled) {
        autoplayRequestGen += 1;
      }
      return {
        autoplayEnabled: enabled,
        autoplayLoading: enabled ? state.autoplayLoading : false,
      };
    }),

  setActiveView: (activeView) =>
    set((state) => ({
      activeView,
      isCinemaMode: activeView === "lyrics" ? state.isCinemaMode : false,
    })),

  toggleLyricsView: () =>
    set((state) => {
      if (state.activeView === "lyrics") {
        const back = state.previousViewBeforeLyrics;
        return {
          activeView:
            back === "lyrics" || back === "search" ? "home" : back,
          isNowPlayingOpen: false,
          isCinemaMode: false,
        };
      }
      const saved =
        state.activeView === "search"
          ? state.previousViewBeforeLyrics
          : state.activeView;
      return {
        previousViewBeforeLyrics: saved,
        activeView: "lyrics",
        isNowPlayingOpen: false,
        searchQuery: "",
        searchResults: [],
        searchArtists: [],
        searchStatus: "idle",
        searchError: null,
      };
    }),

  openSearchView: () =>
    set((state) => ({
      previousViewBeforeSearch:
        state.activeView === "search"
          ? state.previousViewBeforeSearch
          : state.activeView,
      activeView: "search",
      isNowPlayingOpen: false,
      isCinemaMode: false,
      contextMenuTrack: null,
      isSleepTimerOpen: false,
      isCreatePlaylistModalOpen: false,
      createPlaylistInitialTrack: null,
    })),

  openArtist: (artist) => {
    const trimmedName = artist.name.trim();
    if (!trimmedName) return;
    set((state) => ({
      selectedArtist: {
        id: artist.id?.trim() || undefined,
        name: trimmedName,
      },
      previousViewBeforeArtist:
        state.activeView === "artist"
          ? state.previousViewBeforeArtist
          : state.activeView,
      activeView: "artist",
      isNowPlayingOpen: false,
      isCinemaMode: false,
      contextMenuTrack: null,
      isCreatePlaylistModalOpen: false,
      createPlaylistInitialTrack: null,
      searchQuery: "",
      searchResults: [],
      searchArtists: [],
      searchStatus: "idle",
      searchError: null,
    }));
  },

  closeArtistView: () =>
    set((state) => ({
      activeView:
        state.previousViewBeforeArtist === "artist"
          ? "home"
          : state.previousViewBeforeArtist,
    })),

  setLibraryTab: (libraryTab) => set({ libraryTab }),

  toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),

  setQueueOpen: (isQueueOpen) => set({ isQueueOpen }),

  openNowPlaying: () =>
    set((state) => ({
      isNowPlayingOpen: state.currentTrack !== null,
      isCinemaMode: false,
    })),

  closeNowPlaying: () => set({ isNowPlayingOpen: false }),

  toggleCinemaMode: () =>
    set((state) => ({ isCinemaMode: !state.isCinemaMode })),

  setCinemaMode: (isCinemaMode) => set({ isCinemaMode }),

  adjustTrackLyricsOffset: (trackId, deltaSec) =>
    set((state) => {
      if (!trackId) return state;
      const prev = state.trackLyricsOffsets[trackId] ?? 0;
      const clamped = Math.max(
        -10,
        Math.min(10, Math.round((prev + deltaSec) * 10) / 10),
      );
      const nextMap = { ...state.trackLyricsOffsets };
      if (clamped === 0) {
        delete nextMap[trackId];
      } else {
        nextMap[trackId] = clamped;
      }
      return { trackLyricsOffsets: nextMap };
    }),

  resetTrackLyricsOffset: (trackId) =>
    set((state) => {
      if (!trackId || !(trackId in state.trackLyricsOffsets)) return state;
      const nextMap = { ...state.trackLyricsOffsets };
      delete nextMap[trackId];
      return { trackLyricsOffsets: nextMap };
    }),

  openSleepTimer: () => set({ isSleepTimerOpen: true }),

  closeSleepTimer: () => set({ isSleepTimerOpen: false }),

  openCreatePlaylistModal: (initialTrack = null) =>
    set({
      isCreatePlaylistModalOpen: true,
      createPlaylistInitialTrack: initialTrack ?? null,
    }),

  closeCreatePlaylistModal: () =>
    set({
      isCreatePlaylistModalOpen: false,
      createPlaylistInitialTrack: null,
    }),

  openTrackMenu: (contextMenuTrack) => set({ contextMenuTrack }),

  closeTrackMenu: () => set({ contextMenuTrack: null }),

  startSleepTimer: ({ minutes, finishCurrentSong, fadeOut }) => {
    const safeMinutes = Math.max(1, Math.round(minutes));
    audioEngine.resetFade();
    set({
      sleepTimer: {
        active: true,
        endsAt: Date.now() + safeMinutes * 60_000,
        durationMinutes: safeMinutes,
        finishCurrentSong,
        fadeOut,
        waitingForTrackEnd: false,
      },
    });
  },

  cancelSleepTimer: () => {
    audioEngine.resetFade();
    set((state) => ({
      sleepTimer: {
        ...state.sleepTimer,
        active: false,
        endsAt: null,
        waitingForTrackEnd: false,
      },
    }));
  },

  setSleepTimerWaitingForTrackEnd: () =>
    set((state) => ({
      sleepTimer: state.sleepTimer.active
        ? { ...state.sleepTimer, waitingForTrackEnd: true }
        : state.sleepTimer,
    })),

  completeSleepTimer: () => {
    audioEngine.pause();
    set((state) => ({
      isPlaying: false,
      playbackStatus:
        state.playbackStatus === "loading" ||
        state.playbackStatus === "playing"
          ? "paused"
          : state.playbackStatus,
      sleepTimer: {
        ...state.sleepTimer,
        active: false,
        endsAt: null,
        waitingForTrackEnd: false,
      },
    }));
    audioEngine.resetFade();
  },

  setCurrentStreamDetails: (currentStreamDetails) =>
    set({ currentStreamDetails }),

  updatePreferences: (partial) =>
    set((state) => {
      const next: AppPreferences = { ...state.preferences, ...partial };
      setPlaybackAndContentConfig({
        preferredAudioFormat: next.preferredAudioFormat,
        audioQuality: next.audioQuality,
        lowDataMode: next.lowDataMode,
        preferOfficialAudio: next.preferOfficialAudio,
        contentLang: next.contentLang,
        contentCountry: next.contentCountry,
      });
      if (partial.equalizer) {
        audioEngine.applyEqualizerConfig(next.equalizer);
        saveEqualizerToLocalStorage(next.equalizer);
      }
      if (
        partial.preferredAudioFormat &&
        partial.preferredAudioFormat !== state.preferences.preferredAudioFormat
      ) {
        setPreferredAudioFormat(next.preferredAudioFormat);
        invalidateAudioStreamCache();
      }
      return { preferences: next };
    }),

  setEqualizerEnabled: (enabled) =>
    set((state) => {
      const nextEqualizer = {
        ...state.preferences.equalizer,
        enabled,
      };
      audioEngine.applyEqualizerConfig(nextEqualizer);
      saveEqualizerToLocalStorage(nextEqualizer);
      return {
        preferences: {
          ...state.preferences,
          equalizer: nextEqualizer,
        },
      };
    }),

  setEqualizerPreset: (preset) =>
    set((state) => {
      const presetBands = [...EQUALIZER_PRESETS[preset].bands] as EqualizerBands;
      const nextEqualizer = {
        ...state.preferences.equalizer,
        preset,
        bands: presetBands,
      };
      audioEngine.applyEqualizerConfig(nextEqualizer);
      saveEqualizerToLocalStorage(nextEqualizer);
      return {
        preferences: {
          ...state.preferences,
          equalizer: nextEqualizer,
        },
      };
    }),

  setEqualizerBand: (bandIndex, gainDb) =>
    set((state) => {
      if (bandIndex < 0 || bandIndex >= 5) return state;
      audioEngine.setEqualizerBandGain(bandIndex, gainDb);
      const synced = audioEngine.getEqualizerConfig();
      const nextEqualizer = {
        ...state.preferences.equalizer,
        preset: synced.preset,
        bands: synced.bands,
      };
      saveEqualizerToLocalStorage(nextEqualizer);
      return {
        preferences: {
          ...state.preferences,
          equalizer: nextEqualizer,
        },
      };
    }),

  resetEqualizer: () =>
    set((state) => {
      const nextEqualizer = {
        ...state.preferences.equalizer,
        preset: "flat" as const,
        bands: [...EQUALIZER_PRESETS.flat.bands] as EqualizerBands,
      };
      audioEngine.applyEqualizerConfig(nextEqualizer);
      saveEqualizerToLocalStorage(nextEqualizer);
      return {
        preferences: {
          ...state.preferences,
          equalizer: nextEqualizer,
        },
      };
    }),

  setThemePalette: (themePalette) => set({ themePalette }),

  hydrateLibrary: (data) => {
    setPlaybackAndContentConfig({
      preferredAudioFormat: data.preferences.preferredAudioFormat,
      audioQuality: data.preferences.audioQuality,
      lowDataMode: data.preferences.lowDataMode,
      preferOfficialAudio: data.preferences.preferOfficialAudio,
      contentLang: data.preferences.contentLang,
      contentCountry: data.preferences.contentCountry,
    });
    setPreferredAudioFormat(data.preferences.preferredAudioFormat);
    audioEngine.applyEqualizerConfig(data.preferences.equalizer);
    saveEqualizerToLocalStorage(data.preferences.equalizer);
    set({
      likedTracks: data.likedTracks,
      recentTracks: data.recentTracks,
      playlists: data.playlists,
      playStats: data.playStats,
      downloadedTrackIds: data.downloadedTrackIds,
      preferences: data.preferences,
      volume: data.settings.volume,
      isMuted: data.settings.volume === 0,
      shuffle: data.settings.shuffle,
      repeat: data.settings.repeat,
      autoplayEnabled: data.settings.autoplayEnabled,
      libraryHydrated: true,
    });
  },

  setDownloadedTrackIds: (ids) =>
    set({
      downloadedTrackIds: Array.from(new Set(ids)),
      offlineCacheRevision: get().offlineCacheRevision + 1,
    }),

  downloadTrack: async (track) => {
    const state = get();
    if (!track.id) return false;
    if (state.downloadingTrackIds[track.id]) return false;

    try {
      const alreadyOnDisk = await invoke<boolean>("is_audio_cached", {
        videoId: track.id,
      });
      if (alreadyOnDisk) {
        set((s) => ({
          downloadedTrackIds: s.downloadedTrackIds.includes(track.id)
            ? s.downloadedTrackIds
            : [...s.downloadedTrackIds, track.id],
          offlineCacheRevision: s.offlineCacheRevision + 1,
        }));
        useToastStore
          .getState()
          .showToast(`"${track.title}" è già disponibile offline`);
        return true;
      }
    } catch {
      useToastStore
        .getState()
        .showToast("Download offline disponibile solo nell'app desktop IPPOS");
      return false;
    }

    set((s) => ({
      downloadingTrackIds: {
        ...s.downloadingTrackIds,
        [track.id]: true,
      },
    }));

    try {
      const resolved = await resolveAudioStream(track.id);
      await invoke<number>("download_audio_to_cache", {
        videoId: track.id,
        url: resolved.url,
        userAgent: resolved.userAgent,
      });
      set((s) => ({
        downloadedTrackIds: s.downloadedTrackIds.includes(track.id)
          ? s.downloadedTrackIds
          : [...s.downloadedTrackIds, track.id],
        offlineCacheRevision: s.offlineCacheRevision + 1,
      }));
      useToastStore
        .getState()
        .showToast(`Brano scaricato offline: "${track.title}"`);
      return true;
    } catch (err) {
      useToastStore
        .getState()
        .showToast(
          `Download offline non riuscito: ${formatNetworkError(err)}`,
          3400,
        );
      return false;
    } finally {
      set((s) => {
        const next = { ...s.downloadingTrackIds };
        delete next[track.id];
        return { downloadingTrackIds: next };
      });
    }
  },

  removeDownloadedTrack: async (videoId) => {
    if (!videoId) return false;
    try {
      await invoke<boolean>("remove_cached_audio", { videoId });
    } catch {
      // Fallback: clean local list even if file already missing
    }
    set((s) => ({
      downloadedTrackIds: s.downloadedTrackIds.filter((id) => id !== videoId),
      offlineCacheRevision: s.offlineCacheRevision + 1,
    }));
    useToastStore
      .getState()
      .showToast("Download offline rimosso");
    return true;
  },

  clearAllDownloadedTracks: async () => {
    try {
      await invoke("clear_offline_audio_cache");
    } catch {
      // Ignore outside Tauri runtime
    }
    set((s) => ({
      downloadedTrackIds: [],
      offlineCacheRevision: s.offlineCacheRevision + 1,
    }));
    useToastStore
      .getState()
      .showToast("Cache audio offline svuotata");
  },

  clearRecentTracks: () => set({ recentTracks: [] }),

  clearPlayStats: () => set({ playStats: {} }),

  createPlaylist: async ({
    title,
    description,
    privacyStatus = "PRIVATE",
    syncWithYTMusic = true,
    initialTrack,
  }) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return null;
    const trimmedDescription = description?.trim() || undefined;

    if (syncWithYTMusic && get().authStatus === "authenticated") {
      try {
        const remoteId = await createRemotePlaylist(
          trimmedTitle,
          trimmedDescription,
          privacyStatus,
          initialTrack ? [initialTrack.id] : undefined,
        );
        const cleanId = normalizePlaylistKey(remoteId);
        const createdRemote: RemotePlaylist = {
          id: cleanId,
          title: trimmedTitle,
          subtitle: trimmedDescription || "Playlist YouTube Music",
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          privacyStatus,
          cover:
            initialTrack?.cover && !initialTrack.cover.startsWith("data:")
              ? initialTrack.cover
              : "",
          trackCount: initialTrack ? "1 brano" : "0 brani",
          isLikedSongs: false,
          isRemote: true,
        };

        recentlyCreatedRemotePlaylists.set(cleanId, {
          playlist: createdRemote,
          createdAt: Date.now(),
        });
        seedRemotePlaylistCache(cleanId, initialTrack ? [initialTrack] : []);

        set((state) => {
          const existingWithoutNew = state.remotePlaylists.filter(
            (pl) => normalizePlaylistKey(pl.id) !== cleanId,
          );
          const likedIdx = existingWithoutNew.findIndex(
            (pl) => pl.isLikedSongs || normalizePlaylistKey(pl.id) === "LM",
          );
          const nextRemotePlaylists =
            likedIdx >= 0
              ? [
                  ...existingWithoutNew.slice(0, likedIdx + 1),
                  createdRemote,
                  ...existingWithoutNew.slice(likedIdx + 1),
                ]
              : [createdRemote, ...existingWithoutNew];

          return {
            remotePlaylists: nextRemotePlaylists,
            remotePlaylistsStatus: "success",
            remotePlaylistsError: null,
            remotePlaylistTrackIds: {
              ...state.remotePlaylistTrackIds,
              [cleanId]: initialTrack ? [initialTrack.id] : [],
            },
          };
        });

        useToastStore
          .getState()
          .showToast(
            initialTrack
              ? `Playlist "${createdRemote.title}" creata su YouTube Music con "${initialTrack.title}"`
              : `Playlist "${createdRemote.title}" creata su YouTube Music`,
          );
        return { id: cleanId, isRemote: true };
      } catch (err: unknown) {
        if (isAuthExpiredError(err)) {
          void clearAuthSession().catch(() => undefined);
          setYTMusicAuthCookie(null);
          get().resetAuthToGuest(
            "Sessione scaduta, effettua nuovamente l'accesso",
          );
          useToastStore
            .getState()
            .showToast(
              "Sessione YouTube Music scaduta. Accedi di nuovo.",
              3600,
            );
        } else {
          useToastStore
            .getState()
            .showToast(
              `Impossibile creare la playlist: ${formatNetworkError(err)}`,
              3600,
            );
        }
        return null;
      }
    }

    const id = createPlaylistId();
    const nextPlaylist: UserPlaylist = {
      id,
      name: trimmedTitle,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      privacyStatus,
      isRemote: false,
      createdAt: Date.now(),
      tracks: initialTrack ? [initialTrack] : [],
    };
    set((state) => ({
      playlists: [nextPlaylist, ...state.playlists],
    }));
    useToastStore
      .getState()
      .showToast(
        initialTrack
          ? `Playlist locale "${nextPlaylist.name}" creata con "${initialTrack.title}"`
          : `Playlist locale "${nextPlaylist.name}" creata`,
      );
    return { id, isRemote: false };
  },

  deletePlaylist: (playlistId) =>
    set((state) => ({
      playlists: state.playlists.filter((pl) => pl.id !== playlistId),
    })),

  renamePlaylist: (playlistId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => ({
      playlists: state.playlists.map((pl) =>
        pl.id === playlistId ? { ...pl, name: trimmed } : pl,
      ),
    }));
  },

  addTrackToPlaylist: (playlistId, track, options) => {
    let addedPlaylistName: string | null = null;
    const allowDuplicate = options?.allowDuplicate === true;
    set((state) => ({
      playlists: state.playlists.map((pl) => {
        if (pl.id !== playlistId) return pl;
        if (!allowDuplicate && pl.tracks.some((t) => t.id === track.id)) return pl;
        addedPlaylistName = pl.name;
        return { ...pl, tracks: [...pl.tracks, track] };
      }),
    }));
    if (addedPlaylistName) {
      useToastStore
        .getState()
        .showToast(`Aggiunto a "${addedPlaylistName}"`);
    }
  },

  removeTrackFromPlaylist: (playlistId, trackId) => {
    let removedPlaylistName: string | null = null;
    set((state) => ({
      playlists: state.playlists.map((pl) => {
        if (pl.id !== playlistId) return pl;
        if (!pl.tracks.some((t) => t.id === trackId)) return pl;
        removedPlaylistName = pl.name;
        return { ...pl, tracks: pl.tracks.filter((t) => t.id !== trackId) };
      }),
    }));
    if (removedPlaylistName) {
      useToastStore
        .getState()
        .showToast(`Rimosso da "${removedPlaylistName}"`);
    }
  },

  setPlaybackState: (partial) => set(partial),

  syncTrackDuration: (videoId, durationSeconds, source = "metadata") =>
    set((state) => {
      const rounded = sanitizeDurationSeconds(durationSeconds);
      if (rounded <= 0) {
        return state;
      }

      const currentMatches = state.currentTrack?.id === videoId;
      const streamAuthoritative =
        state.currentStreamDetails?.videoId === videoId &&
        state.currentStreamDetails.durationSeconds > 0
          ? state.currentStreamDetails.durationSeconds
          : 0;
      const trackAuthoritative =
        currentMatches &&
        state.currentTrack &&
        state.currentTrack.durationSeconds > 0
          ? state.currentTrack.durationSeconds
          : 0;
      const storeAuthoritative =
        currentMatches && state.duration > 0 ? state.duration : 0;
      const knownAuthoritative =
        streamAuthoritative || trackAuthoritative || storeAuthoritative;

      // Impedisce a WebKit/AVFoundation macOS di sovrascrivere la durata reale con valori 2x su fMP4 DASH
      if (
        source === "audio" &&
        !isPlausibleAudioDuration(rounded, knownAuthoritative)
      ) {
        return state;
      }

      const overwriteExisting = source === "stream";
      const formatted = formatTime(rounded);
      const existingStat = state.playStats[videoId];
      const patchedStatTrack = existingStat
        ? patchTrackDuration(
            existingStat.track,
            videoId,
            formatted,
            rounded,
            overwriteExisting,
          )
        : null;
      const updatedStats =
        existingStat && patchedStatTrack && patchedStatTrack !== existingStat.track
          ? {
              ...state.playStats,
              [videoId]: {
                ...existingStat,
                track: patchedStatTrack,
              },
            }
          : state.playStats;

      return {
        duration:
          currentMatches && (overwriteExisting || state.duration <= 0)
            ? rounded
            : state.duration,
        currentTrack:
          currentMatches && state.currentTrack
            ? patchTrackDuration(
                state.currentTrack,
                videoId,
                formatted,
                rounded,
                overwriteExisting,
              )
            : state.currentTrack,
        queue: state.queue.map((t) =>
          patchTrackDuration(t, videoId, formatted, rounded, overwriteExisting),
        ),
        recentTracks: state.recentTracks.map((t) =>
          patchTrackDuration(t, videoId, formatted, rounded, overwriteExisting),
        ),
        likedTracks: state.likedTracks.map((t) =>
          patchTrackDuration(t, videoId, formatted, rounded, overwriteExisting),
        ),
        playlists: state.playlists.map((pl) => ({
          ...pl,
          tracks: pl.tracks.map((t) =>
            patchTrackDuration(
              t,
              videoId,
              formatted,
              rounded,
              overwriteExisting,
            ),
          ),
        })),
        playStats: updatedStats,
      };
    }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSearchFilter: (searchFilter) => set({ searchFilter }),

  triggerSearchNow: () =>
    set((state) => ({ searchNonce: state.searchNonce + 1 })),

  clearSearch: () =>
    set((state) => ({
      searchQuery: "",
      searchResults: [],
      searchArtists: [],
      searchStatus: "idle",
      searchError: null,
      activeView:
        state.activeView === "search"
          ? state.previousViewBeforeSearch === "search"
            ? "home"
            : state.previousViewBeforeSearch
          : state.activeView,
    })),

  setSearchState: (partial) => set(partial),

  setHomeFilter: (homeFilter) => set({ homeFilter }),

  setHomeFeedState: (partial) => set(partial),

  setExploreFeedState: (partial) => set(partial),

  setAuthState: (partial) => set(partial),

  setAuthNotice: (authNotice) => set({ authNotice }),

  setRemotePlaylistsState: (partial) => set(partial),

  setRemotePlaylistTrackIds: (playlistId, trackIds) => {
    const cleanId = normalizePlaylistKey(playlistId);
    if (!cleanId) return;
    const uniqueIds = Array.from(new Set(trackIds));
    set((state) => ({
      remotePlaylistTrackIds: {
        ...state.remotePlaylistTrackIds,
        [cleanId]: uniqueIds,
      },
    }));
  },

  refreshRemotePlaylists: async (options) => {
    if (get().authStatus !== "authenticated") return;
    if (inFlightRemotePlaylistsRefresh) {
      return inFlightRemotePlaylistsRefresh;
    }

    const gen = remoteSyncGeneration;
    const silent = Boolean(options?.silent);

    if (!silent) {
      set({
        remotePlaylistsStatus: "loading",
        remotePlaylistsError: null,
      });
    }

    const task = (async () => {
      try {
        const playlists = await fetchRemotePlaylists();
        if (
          gen !== remoteSyncGeneration ||
          get().authStatus !== "authenticated"
        ) {
          return;
        }

        const existingByKey = new Map<string, RemotePlaylist>();
        for (const existing of get().remotePlaylists) {
          const key = normalizePlaylistKey(existing.id);
          if (key && !existingByKey.has(key)) {
            existingByKey.set(key, existing);
          }
        }

        const dedupedByKey = new Map<string, RemotePlaylist>();
        for (const remote of playlists) {
          const key = normalizePlaylistKey(remote.id);
          if (!key || dedupedByKey.has(key)) continue;
          const prev = existingByKey.get(key);
          dedupedByKey.set(key, {
            ...remote,
            isRemote: true,
            ...(remote.description || prev?.description
              ? { description: remote.description ?? prev?.description }
              : {}),
            ...(remote.privacyStatus || prev?.privacyStatus
              ? { privacyStatus: remote.privacyStatus ?? prev?.privacyStatus }
              : {}),
          });
        }

        const now = Date.now();
        const pendingRecent: RemotePlaylist[] = [];
        for (const [key, entry] of recentlyCreatedRemotePlaylists.entries()) {
          if (now - entry.createdAt > RECENTLY_CREATED_REMOTE_TTL_MS) {
            recentlyCreatedRemotePlaylists.delete(key);
            continue;
          }
          const fetched = dedupedByKey.get(key);
          if (fetched) {
            dedupedByKey.set(key, {
              ...fetched,
              isRemote: true,
              ...(entry.playlist.description && !fetched.description
                ? { description: entry.playlist.description }
                : {}),
              ...(entry.playlist.privacyStatus && !fetched.privacyStatus
                ? { privacyStatus: entry.playlist.privacyStatus }
                : {}),
            });
            recentlyCreatedRemotePlaylists.delete(key);
          } else {
            pendingRecent.push(entry.playlist);
          }
        }

        const mergedList = Array.from(dedupedByKey.values());
        let finalRemotePlaylists = mergedList;
        if (pendingRecent.length > 0) {
          const likedIdx = mergedList.findIndex(
            (pl) => pl.isLikedSongs || normalizePlaylistKey(pl.id) === "LM",
          );
          finalRemotePlaylists =
            likedIdx >= 0
              ? [
                  ...mergedList.slice(0, likedIdx + 1),
                  ...pendingRecent,
                  ...mergedList.slice(likedIdx + 1),
                ]
              : [...pendingRecent, ...mergedList];
        }

        set({
          remotePlaylists: finalRemotePlaylists,
          remotePlaylistsStatus: "success",
          remotePlaylistsError: null,
        });
      } catch (err: unknown) {
        if (gen !== remoteSyncGeneration) return;

        if (isAuthExpiredError(err)) {
          void clearAuthSession().catch(() => undefined);
          setYTMusicAuthCookie(null);
          get().resetAuthToGuest(
            "Sessione scaduta, effettua nuovamente l'accesso",
          );
          get().setExploreFeedState({ exploreStatus: "idle" });
          useToastStore
            .getState()
            .showToast(
              "Sessione YouTube Music scaduta. Accedi di nuovo.",
              3600,
            );
          return;
        }

        if (!silent) {
          set({
            remotePlaylistsStatus: "error",
            remotePlaylistsError: formatNetworkError(err),
          });
        }
      } finally {
        inFlightRemotePlaylistsRefresh = null;
      }
    })();

    inFlightRemotePlaylistsRefresh = task;
    return task;
  },

  addTrackToRemotePlaylistOptimistic: async (playlist, track, options) => {
    const cleanId = normalizePlaylistKey(playlist.id);
    if (!cleanId || get().authStatus !== "authenticated") return false;

    const mutationKey = `${cleanId}:${track.id}`;
    if (get().remotePlaylistMutatingKeys[mutationKey]) return false;

    const hadPrevEntry = Object.prototype.hasOwnProperty.call(
      get().remotePlaylistTrackIds,
      cleanId,
    );
    const prevTrackIds = get().remotePlaylistTrackIds[cleanId];
    const prevLikedTracks = get().likedTracks;
    const isLikedPlaylist = Boolean(playlist.isLikedSongs || cleanId === "LM");

    set((state) => {
      const currentIds = state.remotePlaylistTrackIds[cleanId] ?? [];
      const nextIds = currentIds.includes(track.id)
        ? currentIds
        : [...currentIds, track.id];
      const nextLiked =
        isLikedPlaylist && !state.likedTracks.some((t) => t.id === track.id)
          ? [track, ...state.likedTracks]
          : state.likedTracks;
      return {
        remotePlaylistMutatingKeys: {
          ...state.remotePlaylistMutatingKeys,
          [mutationKey]: true,
        },
        remotePlaylistTrackIds: {
          ...state.remotePlaylistTrackIds,
          [cleanId]: nextIds,
        },
        likedTracks: nextLiked,
      };
    });

    try {
      await addTrackToRemotePlaylist(cleanId, track.id, {
        allowDuplicate: options?.allowDuplicate,
      });
      clearRemotePlaylistCache(cleanId);
      set((state) => {
        const nextMutating = { ...state.remotePlaylistMutatingKeys };
        delete nextMutating[mutationKey];
        return { remotePlaylistMutatingKeys: nextMutating };
      });
      useToastStore.getState().showToast(`Aggiunto a "${playlist.title}"`);
      void get().refreshRemotePlaylists({ silent: true });
      return true;
    } catch (err: unknown) {
      set((state) => {
        const nextMutating = { ...state.remotePlaylistMutatingKeys };
        delete nextMutating[mutationKey];
        const nextTrackIdsMap = { ...state.remotePlaylistTrackIds };
        if (hadPrevEntry && prevTrackIds) {
          nextTrackIdsMap[cleanId] = prevTrackIds;
        } else {
          delete nextTrackIdsMap[cleanId];
        }
        return {
          remotePlaylistMutatingKeys: nextMutating,
          remotePlaylistTrackIds: nextTrackIdsMap,
          likedTracks: isLikedPlaylist ? prevLikedTracks : state.likedTracks,
        };
      });

      if (isAuthExpiredError(err)) {
        void clearAuthSession().catch(() => undefined);
        setYTMusicAuthCookie(null);
        get().resetAuthToGuest(
          "Sessione scaduta, effettua nuovamente l'accesso",
        );
        useToastStore
          .getState()
          .showToast(
            "Sessione YouTube Music scaduta. Accedi di nuovo.",
            3600,
          );
      } else {
        useToastStore
          .getState()
          .showToast(
            `Impossibile aggiungere a "${playlist.title}": ${formatNetworkError(err)}`,
            3600,
          );
      }
      return false;
    }
  },

  removeTrackFromRemotePlaylistOptimistic: async (playlist, track) => {
    const cleanId = normalizePlaylistKey(playlist.id);
    if (!cleanId || get().authStatus !== "authenticated") return false;

    const mutationKey = `${cleanId}:${track.id}`;
    if (get().remotePlaylistMutatingKeys[mutationKey]) return false;

    const hadPrevEntry = Object.prototype.hasOwnProperty.call(
      get().remotePlaylistTrackIds,
      cleanId,
    );
    const prevTrackIds = get().remotePlaylistTrackIds[cleanId];
    const prevLikedTracks = get().likedTracks;
    const isLikedPlaylist = Boolean(playlist.isLikedSongs || cleanId === "LM");

    set((state) => {
      const currentIds = state.remotePlaylistTrackIds[cleanId] ?? [];
      return {
        remotePlaylistMutatingKeys: {
          ...state.remotePlaylistMutatingKeys,
          [mutationKey]: true,
        },
        remotePlaylistTrackIds: {
          ...state.remotePlaylistTrackIds,
          [cleanId]: currentIds.filter((id) => id !== track.id),
        },
        likedTracks: isLikedPlaylist
          ? state.likedTracks.filter((t) => t.id !== track.id)
          : state.likedTracks,
      };
    });

    try {
      await removeTrackFromRemotePlaylist(cleanId, track.id);
      clearRemotePlaylistCache(cleanId);
      set((state) => {
        const nextMutating = { ...state.remotePlaylistMutatingKeys };
        delete nextMutating[mutationKey];
        return { remotePlaylistMutatingKeys: nextMutating };
      });
      useToastStore.getState().showToast(`Rimosso da "${playlist.title}"`);
      void get().refreshRemotePlaylists({ silent: true });
      return true;
    } catch (err: unknown) {
      set((state) => {
        const nextMutating = { ...state.remotePlaylistMutatingKeys };
        delete nextMutating[mutationKey];
        const nextTrackIdsMap = { ...state.remotePlaylistTrackIds };
        if (hadPrevEntry && prevTrackIds) {
          nextTrackIdsMap[cleanId] = prevTrackIds;
        } else {
          delete nextTrackIdsMap[cleanId];
        }
        return {
          remotePlaylistMutatingKeys: nextMutating,
          remotePlaylistTrackIds: nextTrackIdsMap,
          likedTracks: isLikedPlaylist ? prevLikedTracks : state.likedTracks,
        };
      });

      if (isAuthExpiredError(err)) {
        void clearAuthSession().catch(() => undefined);
        setYTMusicAuthCookie(null);
        get().resetAuthToGuest(
          "Sessione scaduta, effettua nuovamente l'accesso",
        );
        useToastStore
          .getState()
          .showToast(
            "Sessione YouTube Music scaduta. Accedi di nuovo.",
            3600,
          );
      } else {
        useToastStore
          .getState()
          .showToast(
            `Impossibile rimuovere da "${playlist.title}": ${formatNetworkError(err)}`,
            3600,
          );
      }
      return false;
    }
  },

  createRemotePlaylistAndAddTrack: async (title, track) => {
    const result = await get().createPlaylist({
      title,
      privacyStatus: "PRIVATE",
      syncWithYTMusic: true,
      initialTrack: track,
    });
    return result !== null;
  },

  resetAuthToGuest: (notice) => {
    remoteSyncGeneration += 1;
    inFlightRemotePlaylistsRefresh = null;
    recentlyCreatedRemotePlaylists.clear();
    set({
      authStatus: "guest",
      authUser: null,
      remotePlaylists: [],
      remotePlaylistsStatus: "idle",
      remotePlaylistsError: null,
      remotePlaylistTrackIds: {},
      remotePlaylistMutatingKeys: {},
      authNotice: notice ?? null,
    });
  },
  };
});
