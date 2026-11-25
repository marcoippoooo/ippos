import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Clock,
  Cloud,
  Crown,
  Flame,
  Heart,
  ListMusic,
  Loader2,
  LogIn,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchRemotePlaylistTracks,
  formatNetworkError,
  isAuthExpiredError,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import {
  AsyncStatus,
  LibrarySortBy,
  LibraryTab,
  PlaylistPrivacyStatus,
  PlaylistSortBy,
  PlaylistTrackSortBy,
  RemotePlaylist,
  Track,
  TrackPlayStat,
  UserPlaylist,
} from "../types/music";
import { formatTime, parseDurationToSeconds } from "../utils/formatTime";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { ArtistLinks } from "./ArtistLinks";
import { TrackDownloadButton } from "./TrackDownloadButton";
import { EqualizerBars } from "./EqualizerBars";
import { ExplicitBadge } from "./ExplicitBadge";
import { PlaylistCollageCover } from "./PlaylistCollageCover";
import { ScallopedArtwork } from "./ScallopedArtwork";

interface LibraryViewProps {
  onLogin: () => void;
  onRefreshRemotePlaylists: () => void;
  onAuthError: (err: unknown) => void;
}

const TABS: { id: LibraryTab; label: string }[] = [
  { id: "overview", label: "Panoramica" },
  { id: "liked", label: "Brani piaciuti" },
  { id: "recent", label: "Recenti" },
  { id: "top", label: "Top di sempre" },
  { id: "playlists", label: "Playlist" },
];

const SORT_OPTIONS: { id: LibrarySortBy; label: string }[] = [
  { id: "recent", label: "Più recenti" },
  { id: "title", label: "Titolo" },
  { id: "artist", label: "Artista" },
];

const PLAYLIST_SORT_OPTIONS: { id: PlaylistSortBy; label: string }[] = [
  { id: "recent", label: "Recenti" },
  { id: "name", label: "Nome" },
  { id: "count", label: "Tracce" },
];

const PLAYLIST_TRACK_SORT_OPTIONS: {
  id: PlaylistTrackSortBy;
  label: string;
}[] = [
  { id: "default", label: "Predefinito" },
  { id: "title", label: "Titolo (A-Z)" },
  { id: "artist", label: "Artista (A-Z)" },
  { id: "duration", label: "Durata" },
];

function getEffectiveDurationSeconds(track: Track): number {
  if (track.durationSeconds > 0) return track.durationSeconds;
  return parseDurationToSeconds(track.duration);
}

function filterAndSortPlaylistTracks(
  tracks: Track[],
  query: string,
  sortBy: PlaylistTrackSortBy,
): Track[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(needle) ||
          track.artist.toLowerCase().includes(needle) ||
          Boolean(
            track.artists?.some((a) => a.name.toLowerCase().includes(needle)),
          ),
      )
    : tracks;

  if (sortBy === "default") return filtered;

  return [...filtered].sort((a, b) => {
    if (sortBy === "title") {
      return a.title.localeCompare(b.title, "it", { sensitivity: "base" });
    }
    if (sortBy === "artist") {
      const artistCmp = a.artist.localeCompare(b.artist, "it", {
        sensitivity: "base",
      });
      if (artistCmp !== 0) return artistCmp;
      return a.title.localeCompare(b.title, "it", { sensitivity: "base" });
    }
    const durA = getEffectiveDurationSeconds(a);
    const durB = getEffectiveDurationSeconds(b);
    if (durA === 0 && durB === 0) return 0;
    if (durA === 0) return 1;
    if (durB === 0) return -1;
    return durA - durB;
  });
}

function sortTracks(tracks: Track[], sortBy: LibrarySortBy): Track[] {
  if (sortBy === "recent") return tracks;
  return [...tracks].sort((a, b) => {
    if (sortBy === "title") {
      return a.title.localeCompare(b.title, "it", { sensitivity: "base" });
    }
    return a.artist.localeCompare(b.artist, "it", { sensitivity: "base" });
  });
}

function parseRemoteTrackCount(raw?: string): number {
  if (!raw) return 0;
  const match = raw.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) || 0 : 0;
}

function formatPrivacyLabel(privacy?: PlaylistPrivacyStatus): string | null {
  if (privacy === "PRIVATE") return "Privata";
  if (privacy === "UNLISTED") return "Non in elenco";
  if (privacy === "PUBLIC") return "Pubblica";
  return null;
}

export function LibraryView({
  onLogin,
  onRefreshRemotePlaylists,
  onAuthError,
}: LibraryViewProps) {
  const libraryTab = usePlayerStore((s) => s.libraryTab);
  const setLibraryTab = usePlayerStore((s) => s.setLibraryTab);
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const recentTracks = usePlayerStore((s) => s.recentTracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const playStats = usePlayerStore((s) => s.playStats);
  const authStatus = usePlayerStore((s) => s.authStatus);
  const authUser = usePlayerStore((s) => s.authUser);
  const remotePlaylists = usePlayerStore((s) => s.remotePlaylists);
  const remotePlaylistsStatus = usePlayerStore(
    (s) => s.remotePlaylistsStatus,
  );
  const remotePlaylistsError = usePlayerStore((s) => s.remotePlaylistsError);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const clearRecentTracks = usePlayerStore((s) => s.clearRecentTracks);
  const openCreatePlaylistModal = usePlayerStore(
    (s) => s.openCreatePlaylistModal,
  );
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const removeTrackFromPlaylist = usePlayerStore(
    (s) => s.removeTrackFromPlaylist,
  );
  const remotePlaylistTrackIds = usePlayerStore(
    (s) => s.remotePlaylistTrackIds,
  );
  const setRemotePlaylistTrackIds = usePlayerStore(
    (s) => s.setRemotePlaylistTrackIds,
  );
  const setActiveView = usePlayerStore((s) => s.setActiveView);

  const [sortBy, setSortBy] = useState<LibrarySortBy>("recent");
  const [playlistSortBy, setPlaylistSortBy] =
    useState<PlaylistSortBy>("recent");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null,
  );
  const [selectedRemotePlaylistId, setSelectedRemotePlaylistId] = useState<
    string | null
  >(null);
  const [playlistTrackFilter, setPlaylistTrackFilter] = useState("");
  const [playlistTrackSortBy, setPlaylistTrackSortBy] =
    useState<PlaylistTrackSortBy>("default");
  const [remoteTracks, setRemoteTracks] = useState<Track[]>([]);
  const [remoteTracksStatus, setRemoteTracksStatus] =
    useState<AsyncStatus>("idle");
  const [remoteTracksError, setRemoteTracksError] = useState<string | null>(
    null,
  );
  const [quickPlayingPlaylistId, setQuickPlayingPlaylistId] = useState<
    string | null
  >(null);
  const remoteLoadSeqRef = useRef(0);

  const likedIds = useMemo(
    () => new Set(likedTracks.map((t) => t.id)),
    [likedTracks],
  );

  const topEntries = useMemo<TrackPlayStat[]>(() => {
    const statsList = Object.values(playStats).sort(
      (a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt,
    );
    if (statsList.length > 0) {
      return statsList;
    }
    const fallbackPool = recentTracks.length > 0 ? recentTracks : likedTracks;
    return fallbackPool.map((track, idx) => ({
      track,
      playCount: 0,
      lastPlayedAt: fallbackPool.length - idx,
    }));
  }, [playStats, recentTracks, likedTracks]);

  const topTracks = useMemo(
    () => topEntries.map((entry) => entry.track),
    [topEntries],
  );

  const playCountByTrackId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of topEntries) {
      map.set(entry.track.id, entry.playCount);
    }
    return map;
  }, [topEntries]);

  const totalPlayCount = useMemo(
    () => Object.values(playStats).reduce((sum, item) => sum + item.playCount, 0),
    [playStats],
  );

  const sortedLiked = useMemo(
    () => sortTracks(likedTracks, sortBy),
    [likedTracks, sortBy],
  );
  const sortedRecent = useMemo(
    () => sortTracks(recentTracks, sortBy),
    [recentTracks, sortBy],
  );
  const sortedTop = useMemo(
    () => sortTracks(topTracks, sortBy),
    [topTracks, sortBy],
  );

  const sortedLocalPlaylists = useMemo(() => {
    if (playlistSortBy === "recent") return playlists;
    return [...playlists].sort((a, b) => {
      if (playlistSortBy === "name") {
        return a.name.localeCompare(b.name, "it", { sensitivity: "base" });
      }
      return b.tracks.length - a.tracks.length;
    });
  }, [playlists, playlistSortBy]);

  const sortedRemotePlaylists = useMemo(() => {
    if (playlistSortBy === "recent") return remotePlaylists;
    return [...remotePlaylists].sort((a, b) => {
      if (playlistSortBy === "name") {
        return a.title.localeCompare(b.title, "it", { sensitivity: "base" });
      }
      return (
        parseRemoteTrackCount(b.trackCount) - parseRemoteTrackCount(a.trackCount)
      );
    });
  }, [remotePlaylists, playlistSortBy]);

  const selectedPlaylist: UserPlaylist | null = useMemo(
    () => playlists.find((pl) => pl.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId],
  );

  const selectedRemotePlaylist: RemotePlaylist | null = useMemo(
    () =>
      authStatus === "authenticated"
        ? (remotePlaylists.find((pl) => pl.id === selectedRemotePlaylistId) ??
          null)
        : null,
    [authStatus, remotePlaylists, selectedRemotePlaylistId],
  );

  const displayedRemoteTracks = useMemo(
    () =>
      filterAndSortPlaylistTracks(
        remoteTracks,
        playlistTrackFilter,
        playlistTrackSortBy,
      ),
    [remoteTracks, playlistTrackFilter, playlistTrackSortBy],
  );

  const displayedLocalPlaylistTracks = useMemo(
    () =>
      filterAndSortPlaylistTracks(
        selectedPlaylist?.tracks ?? [],
        playlistTrackFilter,
        playlistTrackSortBy,
      ),
    [selectedPlaylist?.tracks, playlistTrackFilter, playlistTrackSortBy],
  );

  useEffect(() => {
    setPlaylistTrackFilter("");
    setPlaylistTrackSortBy("default");
  }, [selectedPlaylistId, selectedRemotePlaylistId]);

  useEffect(() => {
    if (!selectedRemotePlaylistId || remoteTracksStatus !== "success") return;
    const cleanId = selectedRemotePlaylistId.trim().replace(/^VL/, "");
    const syncedIds = remotePlaylistTrackIds[cleanId];
    if (!syncedIds) return;
    const allowed = new Set(syncedIds);
    setRemoteTracks((prev) => {
      const next = prev.filter((t) => allowed.has(t.id));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedRemotePlaylistId, remoteTracksStatus, remotePlaylistTrackIds]);

  const openRemotePlaylist = async (
    playlistId: string,
    forceRefresh = false,
  ) => {
    const reqId = ++remoteLoadSeqRef.current;
    setSelectedPlaylistId(null);
    setSelectedRemotePlaylistId(playlistId);
    setRemoteTracks([]);
    setRemoteTracksStatus("loading");
    setRemoteTracksError(null);

    try {
      const tracks = await fetchRemotePlaylistTracks(playlistId, {
        forceRefresh,
      });
      if (reqId !== remoteLoadSeqRef.current) return;
      setRemoteTracks(tracks);
      setRemotePlaylistTrackIds(
        playlistId,
        tracks.map((t) => t.id),
      );
      setRemoteTracksStatus("success");
    } catch (err: unknown) {
      if (reqId !== remoteLoadSeqRef.current) return;
      if (isAuthExpiredError(err)) {
        setSelectedRemotePlaylistId(null);
        onAuthError(err);
        return;
      }
      setRemoteTracksStatus("error");
      setRemoteTracksError(formatNetworkError(err));
    }
  };

  const handleQuickPlayRemotePlaylist = async (
    e: React.MouseEvent,
    playlist: RemotePlaylist,
  ) => {
    e.stopPropagation();
    setQuickPlayingPlaylistId(playlist.id);

    try {
      const tracks = await fetchRemotePlaylistTracks(playlist.id);
      setRemotePlaylistTrackIds(
        playlist.id,
        tracks.map((t) => t.id),
      );
      if (tracks.length > 0) {
        playTrack(tracks[0], tracks);
      } else {
        setSelectedPlaylistId(null);
        setSelectedRemotePlaylistId(playlist.id);
        setRemoteTracks([]);
        setRemoteTracksStatus("success");
        setRemoteTracksError(null);
      }
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) {
        onAuthError(err);
      } else {
        setSelectedPlaylistId(null);
        setSelectedRemotePlaylistId(playlist.id);
        setRemoteTracks([]);
        setRemoteTracksStatus("error");
        setRemoteTracksError(formatNetworkError(err));
      }
    } finally {
      setQuickPlayingPlaylistId((prev) => (prev === playlist.id ? null : prev));
    }
  };

  const displayName = authUser?.name || "Account Google";

  const renderPlaylistFilterAndSortBar = (
    totalCount: number,
    filteredCount: number,
  ) => {
    if (totalCount === 0) return null;
    const hasFilter = playlistTrackFilter.trim().length > 0;
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          />
          <input
            type="text"
            value={playlistTrackFilter}
            onChange={(e) => setPlaylistTrackFilter(e.target.value)}
            placeholder="Filtra per titolo o artista..."
            aria-label="Filtra brani nella playlist"
            className="w-full h-9 pl-9 pr-16 rounded-full text-[12.5px] placeholder-zinc-400/75 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.5)] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
              color: "rgb(var(--md-on-surface-rgb))",
            }}
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {hasFilter && (
              <span
                className="text-[10.5px] tabular-nums"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {filteredCount} di {totalCount}
              </span>
            )}
            {hasFilter && (
              <button
                type="button"
                onClick={() => setPlaylistTrackFilter("")}
                aria-label="Cancella filtro playlist"
                className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div
          className="inline-flex flex-wrap p-1 rounded-full self-start sm:self-auto at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
          }}
        >
          {PLAYLIST_TRACK_SORT_OPTIONS.map((opt) => {
            const active = playlistTrackSortBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPlaylistTrackSortBy(opt.id)}
                className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-all duration-200"
                style={
                  active
                    ? {
                        backgroundColor: "rgb(var(--md-primary-container-rgb))",
                        color: "rgb(var(--md-on-primary-container-rgb))",
                      }
                    : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSortAndPlayHeader = (
    tracks: Track[],
    extraAction?: React.ReactNode,
    backToOverview = false,
  ) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {backToOverview && (
          <button
            type="button"
            onClick={() => setLibraryTab("overview")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium hover:brightness-110 transition at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              color: "rgb(var(--md-on-surface-rgb))",
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Panoramica
          </button>
        )}

        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => playTrack(tracks[0], tracks)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold transition-transform active:scale-95 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-accent-primary-rgb))",
              color: "rgb(var(--md-on-accent-rgb))",
            }}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Riproduci tutto
          </button>
        )}
        {extraAction}
      </div>

      {tracks.length > 1 && (
        <div
          className="inline-flex p-1 rounded-full at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
          }}
        >
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-all duration-200"
                style={
                  active
                    ? {
                        backgroundColor: "rgb(var(--md-primary-container-rgb))",
                        color: "rgb(var(--md-on-primary-container-rgb))",
                      }
                    : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderTrackList = (
    tracks: Track[],
    emptyMessage: string,
    onRemoveFromList?: (trackId: string) => void,
    showPlayCount?: boolean,
  ) => {
    if (tracks.length === 0) {
      return (
        <div
          className="rounded-3xl p-10 text-center space-y-3 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
          }}
        >
          <p className="text-[14px] font-medium text-zinc-200">{emptyMessage}</p>
          <button
            type="button"
            onClick={() => setActiveView("home")}
            className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-transform active:scale-95"
            style={{
              backgroundColor: "rgb(var(--md-primary-container-rgb))",
              color: "rgb(var(--md-on-primary-container-rgb))",
            }}
          >
            Torna ad Ascolta ora
          </button>
        </div>
      );
    }

    return (
      <div
        className="divide-y divide-white/[0.06] rounded-3xl overflow-visible at-tonal"
        style={{
          backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
          border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
        }}
      >
        {tracks.map((track, idx) => {
          const isCurrent = currentTrack?.id === track.id;
          const isPlayingTrack = isCurrent && playbackStatus === "playing";
          const isLoadingTrack = isCurrent && playbackStatus === "loading";
          const isLiked = likedIds.has(track.id);
          const count = playCountByTrackId.get(track.id) ?? 0;

          return (
            <div
              key={`${track.id}-${idx}`}
              onClick={() => playTrack(track, tracks)}
              className={`flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-colors group first:rounded-t-3xl last:rounded-b-3xl ${
                isCurrent ? "" : "hover:bg-white/[0.05]"
              }`}
              style={
                isCurrent
                  ? {
                      backgroundColor:
                        "rgb(var(--md-primary-container-rgb) / 0.55)",
                    }
                  : undefined
              }
            >
              <div className="relative w-10 h-10 rounded-xl overflow-hidden ring-1 ring-white/10 shrink-0 bg-[#18181D]">
                <img
                  src={track.cover}
                  alt={track.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div
                  className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
                    isCurrent
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {isLoadingTrack ? (
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  ) : isPlayingTrack ? (
                    <EqualizerBars playing className="h-3" />
                  ) : isCurrent ? (
                    <Pause className="w-3.5 h-3.5 text-white fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                  )}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p
                    className="text-[13.5px] font-medium truncate transition-colors duration-500"
                    style={{
                      color: isCurrent
                        ? "rgb(var(--md-accent-primary-rgb))"
                        : "rgb(var(--md-on-surface-rgb))",
                    }}
                  >
                    {track.title}
                  </p>
                  {track.isExplicit && <ExplicitBadge />}
                </div>
                <p
                  className="text-[12px] truncate"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  <ArtistLinks
                    artist={track.artist}
                    artistId={track.artistId}
                    artists={track.artists}
                  />
                  {track.album ? ` — ${track.album}` : ""}
                </p>
              </div>

              {showPlayCount && count > 0 && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-medium tabular-nums shrink-0"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-secondary-container-rgb) / 0.8)",
                    color: "rgb(var(--md-on-secondary-container-rgb))",
                  }}
                >
                  {count} {count === 1 ? "ascolto" : "ascolti"}
                </span>
              )}

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(track);
                  }}
                  aria-label="Rimuovi o aggiungi ai preferiti"
                  className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 transition-colors"
                  style={
                    isLiked
                      ? { color: "rgb(var(--md-accent-primary-rgb))" }
                      : undefined
                  }
                >
                  <Heart
                    className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`}
                  />
                </button>

                <AddToPlaylistMenu
                  track={track}
                  className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                />

                <TrackDownloadButton track={track} />

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToQueue(track);
                  }}
                  title="Aggiungi alla coda"
                  className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {onRemoveFromList && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromList(track.id);
                    }}
                    title="Rimuovi dalla playlist"
                    className="p-1.5 rounded-full text-zinc-500 hover:text-rose-400 hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <span
                className="text-[12px] tabular-nums w-12 text-right"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {track.duration ||
                  (track.durationSeconds > 0
                    ? formatTime(track.durationSeconds)
                    : "—")}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderPlaylistsSection = () => (
    <div className="space-y-7">
      {/* Barra titolo & ordinamento rapido playlist */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2
            className="text-[19px] font-semibold tracking-[-0.02em]"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            Playlist personali
          </h2>
          <span
            className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums"
            style={{
              backgroundColor: "rgb(var(--md-secondary-container-rgb))",
              color: "rgb(var(--md-on-secondary-container-rgb))",
            }}
          >
            {playlists.length +
              (authStatus === "authenticated" ? remotePlaylists.length : 0)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex p-1 rounded-full at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
            }}
          >
            {PLAYLIST_SORT_OPTIONS.map((opt) => {
              const active = playlistSortBy === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPlaylistSortBy(opt.id)}
                  className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-all duration-200"
                  style={
                    active
                      ? {
                          backgroundColor:
                            "rgb(var(--md-primary-container-rgb))",
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }
                      : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {authStatus === "authenticated" && (
            <button
              type="button"
              onClick={onRefreshRemotePlaylists}
              disabled={remotePlaylistsStatus === "loading"}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium disabled:opacity-50 hover:brightness-110 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  remotePlaylistsStatus === "loading" ? "animate-spin" : ""
                }`}
              />
              Aggiorna
            </button>
          )}

          <button
            type="button"
            onClick={() => openCreatePlaylistModal()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-semibold shadow-sm transition-transform active:scale-95 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-accent-primary-rgb))",
              color: "rgb(var(--md-on-accent-rgb))",
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Nuova playlist
          </button>
        </div>
      </div>

      {/* Playlist YouTube Music */}
      <section className="space-y-3.5">
        <div className="flex items-center gap-2">
          <h3
            className="text-[14px] font-semibold"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            YouTube Music
          </h3>
          {authStatus === "authenticated" && remotePlaylists.length > 0 && (
            <span
              className="text-[11.5px] tabular-nums"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              ({remotePlaylists.length})
            </span>
          )}
        </div>

        {authStatus === "guest" ? (
          <div
            className="rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
            }}
          >
            <div className="space-y-1">
              <p
                className="text-[14px] font-semibold"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Sincronizza le tue playlist di YouTube Music
              </p>
              <p
                className="text-[12.5px]"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Accedi localmente con Google per importare le tue playlist e i Brani piaciuti.
              </p>
            </div>
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold shrink-0 transition-transform active:scale-95"
              style={{
                backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                color: "rgb(var(--md-on-accent-rgb))",
              }}
            >
              <LogIn className="w-3.5 h-3.5" />
              Accedi con Google
            </button>
          </div>
        ) : authStatus === "authenticating" ? (
          <div
            className="rounded-3xl p-5 flex items-center gap-3 text-[13px] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              color: "rgb(var(--md-on-surface-rgb))",
            }}
          >
            <Loader2
              className="w-4 h-4 animate-spin shrink-0"
              style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
            />
            Accesso con Google in corso nella finestra dedicata...
          </div>
        ) : remotePlaylistsStatus === "loading" &&
          remotePlaylists.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-3xl flex items-center gap-3.5 animate-pulse at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.65)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.16)",
                }}
              >
                <div className="w-16 h-16 rounded-2xl bg-white/[0.07] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-3/4 rounded-full bg-white/[0.08]" />
                  <div className="h-3 w-1/2 rounded-full bg-white/[0.05]" />
                </div>
              </div>
            ))}
          </div>
        ) : remotePlaylistsStatus === "error" &&
          remotePlaylists.length === 0 ? (
          <div
            className="rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
            }}
          >
            <p className="text-[13px] text-zinc-300">
              {remotePlaylistsError ||
                "Impossibile caricare le playlist di YouTube Music."}
            </p>
            <button
              type="button"
              onClick={onRefreshRemotePlaylists}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-semibold shrink-0 transition-transform active:scale-95"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb))",
                color: "rgb(var(--md-on-primary-container-rgb))",
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Riprova
            </button>
          </div>
        ) : remotePlaylists.length === 0 ? (
          <div
            className="rounded-3xl p-6 text-center at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
            }}
          >
            <p className="text-[13px] text-zinc-400">
              Nessuna playlist personale trovata sul tuo account YouTube Music.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedRemotePlaylists.map((pl) => {
              const isQuickLoading = quickPlayingPlaylistId === pl.id;
              return (
                <div
                  key={pl.id}
                  onClick={() => void openRemotePlaylist(pl.id)}
                  className="group p-3.5 rounded-3xl cursor-pointer transition-all duration-200 hover:brightness-110 flex items-center gap-3.5 at-tonal"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-surface-container-rgb) / 0.76)",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  }}
                >
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-[#18181D] ring-1 ring-white/10 shrink-0 flex items-center justify-center">
                    <PlaylistCollageCover
                      covers={pl.cover ? [pl.cover] : []}
                      alt={pl.title}
                      className="w-full h-full"
                      fallback={
                        pl.isLikedSongs ? (
                          <div
                            className="w-full h-full flex items-center justify-center"
                            style={{
                              background:
                                "linear-gradient(135deg, rgb(var(--md-primary-container-rgb)), rgb(var(--md-secondary-container-rgb)))",
                            }}
                          >
                            <Heart
                              className="w-6 h-6 fill-current"
                              style={{
                                color: "rgb(var(--md-accent-primary-rgb))",
                              }}
                            />
                          </div>
                        ) : undefined
                      }
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h4
                        className="text-[14px] font-semibold truncate"
                        style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                      >
                        {pl.title}
                      </h4>
                      {!pl.isLikedSongs && (
                        <span
                          title="Sincronizzata con YouTube Music"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-semibold shrink-0"
                          style={{
                            backgroundColor:
                              "rgb(var(--md-secondary-container-rgb) / 0.85)",
                            color: "rgb(var(--md-on-secondary-container-rgb))",
                          }}
                        >
                          <Cloud className="w-2.5 h-2.5" />
                          YT Music
                        </span>
                      )}
                    </div>
                    <p
                      className="text-[12px] mt-0.5 truncate tabular-nums"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      {[
                        pl.trackCount || pl.subtitle || "Playlist YouTube Music",
                        formatPrivacyLabel(pl.privacyStatus),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => void handleQuickPlayRemotePlaylist(e, pl)}
                    disabled={isQuickLoading}
                    title="Riproduci playlist"
                    aria-label={`Riproduci ${pl.title}`}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-opacity shadow-sm ${
                      isQuickLoading
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                      color: "rgb(var(--md-on-accent-rgb))",
                    }}
                  >
                    {isQuickLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Playlist Locali */}
      <section className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3
              className="text-[14px] font-semibold"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Playlist locali
            </h3>
            {playlists.length > 0 && (
              <span
                className="text-[11.5px] tabular-nums"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                ({playlists.length})
              </span>
            )}
          </div>
        </div>

        {playlists.length === 0 ? (
          <div
            className="rounded-3xl p-8 text-center space-y-2 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
            }}
          >
            <ListMusic className="w-6 h-6 text-zinc-500 mx-auto" />
            <p className="text-[14px] font-medium text-zinc-200">
              Nessuna playlist locale salvata
            </p>
            <p className="text-[12.5px] text-zinc-500 max-w-md mx-auto">
              Usa il pulsante &ldquo;Nuova playlist&rdquo; in alto oppure Aggiungi a playlist su qualsiasi brano.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedLocalPlaylists.map((pl) => {
              const covers = pl.tracks.map((t) => t.cover);
              return (
                <div
                  key={pl.id}
                  onClick={() => setSelectedPlaylistId(pl.id)}
                  className="group p-3.5 rounded-3xl cursor-pointer transition-all duration-200 hover:brightness-110 flex items-center gap-3.5 at-tonal"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-surface-container-rgb) / 0.76)",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  }}
                >
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#18181D] ring-1 ring-white/10 shrink-0">
                    <PlaylistCollageCover
                      covers={covers}
                      alt={pl.name}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4
                      className="text-[14px] font-semibold truncate"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      {pl.name}
                    </h4>
                    <p
                      className="text-[12px] mt-0.5 tabular-nums"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      {pl.tracks.length}{" "}
                      {pl.tracks.length === 1 ? "brano" : "brani"} · Locale
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {pl.tracks.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playTrack(pl.tracks[0], pl.tracks);
                        }}
                        title="Riproduci playlist"
                        aria-label={`Riproduci ${pl.name}`}
                        className="w-9 h-9 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        style={{
                          backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                          color: "rgb(var(--md-on-accent-rgb))",
                        }}
                      >
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePlaylist(pl.id);
                      }}
                      title="Elimina playlist"
                      className="p-1.5 rounded-full text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  const renderBentoGrid = () => {
    const likedPreviewCovers = Array.from(
      new Set(
        likedTracks
          .map((t) => t.cover)
          .filter((c) => Boolean(c) && !c.startsWith("data:image/svg")),
      ),
    ).slice(0, 4);

    const latestRecent = recentTracks[0] ?? null;
    const topEntry = topEntries[0] ?? null;
    const topThree = topEntries.slice(0, 3);

    return (
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
        {/* Card grande: Brani che ti piacciono */}
        <div
          onClick={() => setLibraryTab("liked")}
          className="md:col-span-5 rounded-3xl p-5 min-h-[268px] flex flex-col justify-between gap-4 cursor-pointer group transition-all duration-200 hover:brightness-105 at-tonal"
          style={{
            background:
              "linear-gradient(150deg, rgb(var(--md-primary-container-rgb) / 0.92), rgb(var(--md-surface-container-rgb) / 0.88))",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.30)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-md at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                color: "rgb(var(--md-on-accent-rgb))",
              }}
            >
              <Heart className="w-6 h-6 fill-current" />
            </div>
            <span
              className="px-3 py-1 rounded-full text-[11.5px] font-semibold tabular-nums"
              style={{
                backgroundColor:
                  "rgb(var(--md-secondary-container-rgb) / 0.85)",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              {likedTracks.length}{" "}
              {likedTracks.length === 1 ? "brano" : "brani"}
            </span>
          </div>

          {likedPreviewCovers.length > 0 ? (
            <div className="flex items-center gap-2">
              {likedPreviewCovers.map((cover, idx) => (
                <div
                  key={`${cover}-${idx}`}
                  className="w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-white/15 shadow-md shrink-0"
                >
                  <img
                    src={cover}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p
              className="text-[12.5px] leading-relaxed opacity-85"
              style={{ color: "rgb(var(--md-on-primary-container-rgb))" }}
            >
              Salva i tuoi brani preferiti premendo l'icona del cuore dal player o dai feed.
            </p>
          )}

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2
                className="text-[20px] font-bold tracking-[-0.02em] truncate"
                style={{ color: "rgb(var(--md-on-primary-container-rgb))" }}
              >
                Brani che ti piacciono
              </h2>
              <p
                className="text-[12.5px] truncate opacity-80"
                style={{ color: "rgb(var(--md-on-primary-container-rgb))" }}
              >
                {likedTracks[0] ? (
                  <>
                    {likedTracks[0].title} ·{" "}
                    <ArtistLinks
                      artist={likedTracks[0].artist}
                      artistId={likedTracks[0].artistId}
                      artists={likedTracks[0].artists}
                      inheritColor
                    />
                  </>
                ) : (
                  "La tua raccolta del cuore"
                )}
              </p>
            </div>

            {likedTracks.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playTrack(likedTracks[0], likedTracks);
                }}
                aria-label="Riproduci brani piaciuti"
                className="w-11 h-11 rounded-full flex items-center justify-center shadow-lg shrink-0 transition-transform group-hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                  color: "rgb(var(--md-on-accent-rgb))",
                }}
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </button>
            )}
          </div>
        </div>

        {/* Colonna centrale: Card impilate Cronologia/Recenti + Top di sempre */}
        <div className="md:col-span-4 flex flex-col gap-4">
          {/* Card Cronologia / Recenti */}
          <div
            onClick={() => setLibraryTab("recent")}
            className="flex-1 rounded-3xl p-4 flex items-center justify-between gap-3.5 cursor-pointer group transition-all duration-200 hover:brightness-110 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              {latestRecent ? (
                <div className="w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-white/10 shrink-0 bg-[#18181D]">
                  <img
                    src={latestRecent.cover}
                    alt={latestRecent.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                    color: "rgb(var(--md-on-secondary-container-rgb))",
                  }}
                >
                  <Clock className="w-5 h-5" />
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Clock
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                  />
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    Cronologia / Recenti
                  </span>
                </div>
                <h3
                  className="text-[15px] font-bold truncate"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {recentTracks.length > 0
                    ? `${recentTracks.length} riprodotti`
                    : "Nessun ascolto recente"}
                </h3>
                <p
                  className="text-[12px] truncate"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {latestRecent ? (
                    <>
                      {latestRecent.title} —{" "}
                      <ArtistLinks
                        artist={latestRecent.artist}
                        artistId={latestRecent.artistId}
                        artists={latestRecent.artists}
                      />
                    </>
                  ) : (
                    "Riproduci un brano per iniziare"
                  )}
                </p>
              </div>
            </div>

            {latestRecent && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playTrack(latestRecent, recentTracks);
                }}
                aria-label="Riprendi cronologia"
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 opacity-85 group-hover:opacity-100 transition-transform active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              </button>
            )}
          </div>

          {/* Card Top di sempre */}
          <div
            onClick={() => setLibraryTab("top")}
            className="flex-1 rounded-3xl p-4 flex items-center justify-between gap-3.5 cursor-pointer group transition-all duration-200 hover:brightness-110 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5">
                <Flame
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                />
                <span
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Top di sempre
                </span>
              </div>
              <h3
                className="text-[15px] font-bold truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                {topTracks.length > 0
                  ? `Top ${Math.min(topTracks.length, 25)} brani`
                  : "Classifica personale"}
              </h3>
              <p
                className="text-[12px] truncate"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {totalPlayCount > 0
                  ? `${totalPlayCount} ascolti totali registrati`
                  : "Basato sulle tue riproduzioni"}
              </p>
            </div>

            {topThree.length > 0 && (
              <div className="flex items-center -space-x-3 shrink-0 pr-1">
                {topThree.map((item, idx) => (
                  <div
                    key={item.track.id}
                    className="w-10 h-10 rounded-xl overflow-hidden ring-2 ring-[rgb(var(--md-surface-container-rgb))] shadow-md"
                    style={{ zIndex: 10 - idx }}
                  >
                    <img
                      src={item.track.cover}
                      alt={item.track.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Box "Più ascoltato" */}
        <div
          className="md:col-span-3 rounded-3xl p-4 min-h-[268px] flex flex-col justify-between gap-3.5 at-tonal"
          style={{
            background:
              "linear-gradient(160deg, rgb(var(--md-secondary-container-rgb) / 0.82), rgb(var(--md-surface-container-rgb) / 0.90))",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "rgb(var(--md-on-secondary-container-rgb))" }}
            >
              <Crown
                className="w-3.5 h-3.5"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              />
              Più ascoltato
            </span>
            {topEntry && topEntry.playCount > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                {topEntry.playCount}x
              </span>
            )}
          </div>

          {topEntry ? (
            <>
              <div
                onClick={() => playTrack(topEntry.track, topTracks)}
                className="flex flex-col items-center text-center gap-2.5 cursor-pointer group"
              >
                <div className="relative w-24 h-24 rounded-2xl overflow-hidden shadow-lg shadow-black/45 ring-1 ring-white/15">
                  <img
                    src={topEntry.track.cover}
                    alt={topEntry.track.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="w-full min-w-0">
                  <div className="flex items-center justify-center gap-1 min-w-0">
                    <h3
                      className="text-[14px] font-bold truncate"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      {topEntry.track.title}
                    </h3>
                    {topEntry.track.isExplicit && <ExplicitBadge />}
                  </div>
                  <p
                    className="text-[12px] truncate"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    <ArtistLinks
                      artist={topEntry.track.artist}
                      artistId={topEntry.track.artistId}
                      artists={topEntry.track.artists}
                    />
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => playTrack(topEntry.track, topTracks)}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded-full text-[12.5px] font-semibold shadow-md transition-transform active:scale-95 at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                  color: "rgb(var(--md-on-accent-rgb))",
                }}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Riproduci tutto
              </button>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-2">
              <p
                className="text-[12.5px]"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Ascolta qualche brano per scoprire il tuo preferito #1.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl space-y-7 pb-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="text-[28px] font-bold tracking-[-0.03em]"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            Libreria
          </h1>

          {authStatus === "authenticated" && authUser ? (
            <div
              className="inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1 rounded-full at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
              }}
            >
              <ScallopedArtwork
                src={authUser.avatar}
                alt={displayName}
                size={22}
                variant="cookie8"
                fallback={
                  <span
                    className="w-full h-full flex items-center justify-center text-[10px] font-bold"
                    style={{
                      backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                      color: "rgb(var(--md-on-accent-rgb))",
                    }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                }
              />
              <span
                className="text-[12px] font-medium max-w-[200px] truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Connesso come {displayName}
              </span>
            </div>
          ) : authStatus === "authenticating" ? (
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb) / 0.85)",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              <Loader2
                className="w-3.5 h-3.5 animate-spin"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              />
              Accesso in corso...
            </button>
          ) : (
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors hover:brightness-110 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
                color: "rgb(var(--md-on-surface-rgb))",
              }}
            >
              <LogIn
                className="w-3.5 h-3.5"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              />
              Accedi con Google
            </button>
          )}
        </div>

        <div
          className="inline-flex p-1 rounded-full self-start overflow-x-auto max-w-full no-scrollbar at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
          }}
        >
          {TABS.map((tab) => {
            const active = libraryTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setLibraryTab(tab.id);
                  setSelectedPlaylistId(null);
                  setSelectedRemotePlaylistId(null);
                }}
                className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium shrink-0 transition-all duration-200"
                style={
                  active
                    ? {
                        backgroundColor: "rgb(var(--md-primary-container-rgb))",
                        color: "rgb(var(--md-on-primary-container-rgb))",
                      }
                    : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {libraryTab === "overview" && !selectedPlaylist && !selectedRemotePlaylist && (
        <div className="space-y-9">
          {renderBentoGrid()}
          {renderPlaylistsSection()}
        </div>
      )}

      {libraryTab === "liked" && (
        <div className="space-y-4">
          {renderSortAndPlayHeader(sortedLiked, undefined, true)}
          {renderTrackList(
            sortedLiked,
            "Nessun brano nei preferiti. Premi il cuore su un risultato o nella barra player per salvarlo.",
          )}
        </div>
      )}

      {libraryTab === "recent" && (
        <div className="space-y-4">
          {renderSortAndPlayHeader(
            sortedRecent,
            sortedRecent.length > 0 ? (
              <button
                type="button"
                onClick={clearRecentTracks}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                  color: "rgb(var(--md-on-secondary-container-rgb))",
                }}
              >
                <Clock className="w-3.5 h-3.5" />
                Cancella cronologia
              </button>
            ) : undefined,
            true,
          )}
          {renderTrackList(
            sortedRecent,
            "La cronologia di ascolto apparirà qui man mano che riproduci i brani.",
          )}
        </div>
      )}

      {libraryTab === "top" && (
        <div className="space-y-4">
          {renderSortAndPlayHeader(sortedTop, undefined, true)}
          {renderTrackList(
            sortedTop,
            "Non ci sono ancora abbastanza ascolti per generare la classifica Top di sempre.",
            undefined,
            true,
          )}
        </div>
      )}

      {libraryTab === "playlists" &&
        !selectedPlaylist &&
        !selectedRemotePlaylist && (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => setLibraryTab("overview")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium hover:brightness-110 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                color: "rgb(var(--md-on-surface-rgb))",
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Panoramica Bento
            </button>
            {renderPlaylistsSection()}
          </div>
        )}

      {(libraryTab === "overview" || libraryTab === "playlists") &&
        selectedRemotePlaylist && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedRemotePlaylistId(null)}
                className="p-2 rounded-full hover:brightness-110 transition shrink-0 at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }}
                title="Tutte le playlist"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#18181D] ring-1 ring-white/10 shrink-0 flex items-center justify-center">
                {selectedRemotePlaylist.cover ? (
                  <img
                    src={selectedRemotePlaylist.cover}
                    alt={selectedRemotePlaylist.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : selectedRemotePlaylist.isLikedSongs ? (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{
                      background:
                        "linear-gradient(135deg, rgb(var(--md-primary-container-rgb)), rgb(var(--md-secondary-container-rgb)))",
                    }}
                  >
                    <Heart
                      className="w-6 h-6 fill-current"
                      style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                    />
                  </div>
                ) : (
                  <ListMusic className="w-6 h-6 text-zinc-500" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2
                    className="text-[20px] font-bold truncate"
                    style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                  >
                    {selectedRemotePlaylist.title}
                  </h2>
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0"
                    style={{
                      backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                      color: "rgb(var(--md-on-secondary-container-rgb))",
                    }}
                  >
                    <Cloud className="w-3 h-3" />
                    YouTube Music
                  </span>
                  {formatPrivacyLabel(selectedRemotePlaylist.privacyStatus) && (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[10.5px] font-medium shrink-0"
                      style={{
                        backgroundColor:
                          "rgb(var(--md-surface-container-high-rgb))",
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      {formatPrivacyLabel(selectedRemotePlaylist.privacyStatus)}
                    </span>
                  )}
                </div>
                <p
                  className="text-[12px] tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {remoteTracksStatus === "loading"
                    ? "Caricamento brani..."
                    : `${remoteTracks.length} ${
                        remoteTracks.length === 1 ? "brano" : "brani"
                      }`}
                </p>
                {selectedRemotePlaylist.description && (
                  <p
                    className="text-[12px] truncate mt-0.5"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {selectedRemotePlaylist.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {displayedRemoteTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    playTrack(displayedRemoteTracks[0], displayedRemoteTracks)
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold transition-transform active:scale-95"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Riproduci playlist
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void openRemotePlaylist(selectedRemotePlaylist.id, true)
                }
                disabled={remoteTracksStatus === "loading"}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium disabled:opacity-50 hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                  color: "rgb(var(--md-on-secondary-container-rgb))",
                }}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    remoteTracksStatus === "loading" ? "animate-spin" : ""
                  }`}
                />
                Aggiorna
              </button>
            </div>
          </div>

          {remoteTracksStatus === "success" &&
            renderPlaylistFilterAndSortBar(
              remoteTracks.length,
              displayedRemoteTracks.length,
            )}

          {remoteTracksStatus === "loading" ? (
            <div
              className="rounded-3xl p-10 flex items-center justify-center gap-3 text-[13.5px] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                color: "rgb(var(--md-on-surface-rgb))",
              }}
            >
              <Loader2
                className="w-4 h-4 animate-spin"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              />
              Caricamento brani della playlist...
            </div>
          ) : remoteTracksStatus === "error" ? (
            <div
              className="rounded-3xl p-8 text-center space-y-3 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              <p className="text-[13.5px] text-zinc-300">
                {remoteTracksError ||
                  "Impossibile caricare i brani di questa playlist."}
              </p>
              <button
                type="button"
                onClick={() =>
                  void openRemotePlaylist(selectedRemotePlaylist.id, true)
                }
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-transform active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Riprova
              </button>
            </div>
          ) : remoteTracks.length > 0 && displayedRemoteTracks.length === 0 ? (
            <div
              className="rounded-3xl p-8 text-center space-y-3 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              <p className="text-[13.5px] text-zinc-200">
                Nessun brano corrisponde a &ldquo;{playlistTrackFilter.trim()}&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => setPlaylistTrackFilter("")}
                className="px-4 py-1.5 rounded-full text-[12px] font-semibold transition-transform active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                Cancella filtro
              </button>
            </div>
          ) : (
            renderTrackList(
              displayedRemoteTracks,
              "Nessun brano trovato in questa playlist.",
            )
          )}
        </div>
      )}

      {(libraryTab === "overview" || libraryTab === "playlists") &&
        selectedPlaylist && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedPlaylistId(null)}
                className="p-2 rounded-full hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }}
                title="Tutte le playlist"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h2
                  className="text-[20px] font-bold truncate"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {selectedPlaylist.name}
                </h2>
                <p
                  className="text-[12px] tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {selectedPlaylist.tracks.length}{" "}
                  {selectedPlaylist.tracks.length === 1 ? "brano" : "brani"}
                </p>
                {selectedPlaylist.description && (
                  <p
                    className="text-[12px] truncate mt-0.5"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {selectedPlaylist.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {displayedLocalPlaylistTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    playTrack(
                      displayedLocalPlaylistTracks[0],
                      displayedLocalPlaylistTracks,
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold transition-transform active:scale-95"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Riproduci playlist
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  deletePlaylist(selectedPlaylist.id);
                  setSelectedPlaylistId(null);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium bg-white/[0.06] hover:bg-rose-500/20 text-zinc-300 hover:text-rose-300 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Elimina
              </button>
            </div>
          </div>

          {renderPlaylistFilterAndSortBar(
            selectedPlaylist.tracks.length,
            displayedLocalPlaylistTracks.length,
          )}

          {selectedPlaylist.tracks.length > 0 &&
          displayedLocalPlaylistTracks.length === 0 ? (
            <div
              className="rounded-3xl p-8 text-center space-y-3 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              <p className="text-[13.5px] text-zinc-200">
                Nessun brano corrisponde a &ldquo;{playlistTrackFilter.trim()}&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => setPlaylistTrackFilter("")}
                className="px-4 py-1.5 rounded-full text-[12px] font-semibold transition-transform active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                Cancella filtro
              </button>
            </div>
          ) : (
            renderTrackList(
              displayedLocalPlaylistTracks,
              "Questa playlist è vuota. Aggiungi brani dalla ricerca, dalla Home o dal player.",
              (trackId) => removeTrackFromPlaylist(selectedPlaylist.id, trackId),
            )
          )}
        </div>
      )}
    </div>
  );
}
