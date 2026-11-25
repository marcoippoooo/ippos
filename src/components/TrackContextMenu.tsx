import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Disc3,
  Download,
  Heart,
  Info,
  Link2,
  ListEnd,
  ListMusic,
  ListPlus,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  UserRound,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  fetchRelatedTracks,
  getCachedAudioStream,
  isEditableRemotePlaylist,
  resolveAudioStream,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { StreamTechnicalDetails } from "../types/music";
import { formatTime } from "../utils/formatTime";
import { ArtistLinks } from "./ArtistLinks";
import { ExplicitBadge } from "./ExplicitBadge";
import { ExpressiveSlider } from "./ExpressiveSlider";
import { ScallopedArtwork } from "./ScallopedArtwork";

type ContextSubView = "menu" | "playlists" | "details";

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback textarea sotto
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function TrackContextMenu() {
  const track = usePlayerStore((s) => s.contextMenuTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentStreamDetails = usePlayerStore((s) => s.currentStreamDetails);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const downloadedTrackIds = usePlayerStore((s) => s.downloadedTrackIds);
  const downloadingTrackIds = usePlayerStore((s) => s.downloadingTrackIds);
  const authStatus = usePlayerStore((s) => s.authStatus);
  const remotePlaylists = usePlayerStore((s) => s.remotePlaylists);
  const remotePlaylistsStatus = usePlayerStore(
    (s) => s.remotePlaylistsStatus,
  );
  const remotePlaylistsError = usePlayerStore((s) => s.remotePlaylistsError);
  const remotePlaylistTrackIds = usePlayerStore(
    (s) => s.remotePlaylistTrackIds,
  );
  const remotePlaylistMutatingKeys = usePlayerStore(
    (s) => s.remotePlaylistMutatingKeys,
  );

  const closeTrackMenu = usePlayerStore((s) => s.closeTrackMenu);
  const closeNowPlaying = usePlayerStore((s) => s.closeNowPlaying);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const enqueueNext = usePlayerStore((s) => s.enqueueNext);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = usePlayerStore(
    (s) => s.removeTrackFromPlaylist,
  );
  const refreshRemotePlaylists = usePlayerStore(
    (s) => s.refreshRemotePlaylists,
  );
  const addTrackToRemotePlaylistOptimistic = usePlayerStore(
    (s) => s.addTrackToRemotePlaylistOptimistic,
  );
  const removeTrackFromRemotePlaylistOptimistic = usePlayerStore(
    (s) => s.removeTrackFromRemotePlaylistOptimistic,
  );
  const openCreatePlaylistModal = usePlayerStore(
    (s) => s.openCreatePlaylistModal,
  );
  const openArtist = usePlayerStore((s) => s.openArtist);
  const setSearchFilter = usePlayerStore((s) => s.setSearchFilter);
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);
  const triggerSearchNow = usePlayerStore((s) => s.triggerSearchNow);
  const downloadTrack = usePlayerStore((s) => s.downloadTrack);
  const removeDownloadedTrack = usePlayerStore(
    (s) => s.removeDownloadedTrack,
  );

  const [subView, setSubView] = useState<ContextSubView>("menu");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [playlistCreateTarget, setPlaylistCreateTarget] = useState<
    "remote" | "local"
  >(authStatus === "authenticated" ? "remote" : "local");
  const [creatingRemotePlaylist, setCreatingRemotePlaylist] = useState(false);
  const [radioLoading, setRadioLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const [details, setDetails] = useState<StreamTechnicalDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const copiedLinkTimerRef = useRef<number | null>(null);
  const copiedIdTimerRef = useRef<number | null>(null);

  const isAuthenticated = authStatus === "authenticated";

  const editableRemotePlaylists = useMemo(
    () => remotePlaylists.filter((pl) => isEditableRemotePlaylist(pl)),
    [remotePlaylists],
  );

  const likedTrackIds = useMemo(
    () => new Set(likedTracks.map((t) => t.id)),
    [likedTracks],
  );
  const isTrackDownloaded = track ? downloadedTrackIds.includes(track.id) : false;
  const isTrackDownloading = track ? Boolean(downloadingTrackIds[track.id]) : false;

  useEffect(() => {
    if (!isAuthenticated) {
      setPlaylistCreateTarget("local");
    } else if (subView !== "playlists") {
      setPlaylistCreateTarget("remote");
    }
  }, [isAuthenticated, subView]);

  useEffect(() => {
    if (!track || subView !== "playlists" || !isAuthenticated) return;
    if (
      remotePlaylistsStatus === "idle" ||
      (remotePlaylistsStatus === "error" && remotePlaylists.length === 0)
    ) {
      void refreshRemotePlaylists();
    }
  }, [
    track,
    subView,
    isAuthenticated,
    remotePlaylistsStatus,
    remotePlaylists.length,
    refreshRemotePlaylists,
  ]);

  useEffect(() => {
    if (copiedLinkTimerRef.current !== null) {
      window.clearTimeout(copiedLinkTimerRef.current);
      copiedLinkTimerRef.current = null;
    }
    if (copiedIdTimerRef.current !== null) {
      window.clearTimeout(copiedIdTimerRef.current);
      copiedIdTimerRef.current = null;
    }
    setSubView("menu");
    setNewPlaylistName("");
    setRadioLoading(false);
    setFeedbackMessage(null);
    setCopiedLink(false);
    setCopiedId(false);
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(false);

    return () => {
      if (copiedLinkTimerRef.current !== null) {
        window.clearTimeout(copiedLinkTimerRef.current);
        copiedLinkTimerRef.current = null;
      }
      if (copiedIdTimerRef.current !== null) {
        window.clearTimeout(copiedIdTimerRef.current);
        copiedIdTimerRef.current = null;
      }
    };
  }, [track?.id]);

  useEffect(() => {
    if (!track) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (subView !== "menu") {
          setSubView("menu");
        } else {
          closeTrackMenu();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [track, subView, closeTrackMenu]);

  useEffect(() => {
    if (!track || subView !== "details") return;

    if (currentStreamDetails && currentStreamDetails.videoId === track.id) {
      setDetails(currentStreamDetails);
      setDetailsLoading(false);
      setDetailsError(null);
      return;
    }

    const cached = getCachedAudioStream(track.id);
    if (cached) {
      setDetails({
        videoId: track.id,
        mimeType: cached.mimeType,
        codec: cached.codec,
        bitrate: cached.bitrate,
        itag: cached.itag,
        sampleRate: cached.sampleRate,
        audioChannels: cached.audioChannels,
        audioQuality: cached.audioQuality,
        contentLength: cached.contentLength,
        durationSeconds: cached.durationSeconds,
        clientUsed: cached.clientUsed,
      });
      setDetailsLoading(false);
      setDetailsError(null);
      return;
    }

    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);

    void resolveAudioStream(track.id)
      .then((resolved) => {
        if (cancelled) return;
        setDetails({
          videoId: track.id,
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
        setDetailsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetailsLoading(false);
        setDetailsError(
          err instanceof Error
            ? err.message
            : "Metadati stream non disponibili.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [track, subView, currentStreamDetails]);

  if (!track) return null;

  const isLiked = likedTracks.some((t) => t.id === track.id);
  const isPlayingTrack =
    currentTrack?.id === track.id && playbackStatus === "playing";
  const effectiveVolume = isMuted ? 0 : volume;

  const handleStartRadio = async () => {
    if (radioLoading) return;
    setRadioLoading(true);
    setFeedbackMessage(null);
    try {
      const related = await fetchRelatedTracks(track);
      if (related.length === 0) {
        setFeedbackMessage("Nessun brano simile trovato per questa radio.");
        return;
      }

      if (currentTrack?.id === track.id) {
        setQueue(related);
        setQueueOpen(true);
        setFeedbackMessage(
          `Radio avviata · ${related.length} brani aggiunti alla coda`,
        );
      } else {
        playTrack(track, [track, ...related]);
        setQueueOpen(true);
        closeTrackMenu();
      }
    } catch {
      setFeedbackMessage("Impossibile avviare la radio al momento.");
    } finally {
      setRadioLoading(false);
    }
  };

  const handleCopyLink = async () => {
    const url = `https://music.youtube.com/watch?v=${track.id}`;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopiedLink(true);
      setFeedbackMessage("Link copiato negli appunti");
      if (copiedLinkTimerRef.current !== null) {
        window.clearTimeout(copiedLinkTimerRef.current);
      }
      copiedLinkTimerRef.current = window.setTimeout(() => {
        copiedLinkTimerRef.current = null;
        setCopiedLink(false);
      }, 2000);
    }
  };

  const handleViewArtist = () => {
    const primary = track.artists?.[0];
    openArtist({
      id: primary?.id ?? track.artistId,
      name: primary?.name ?? track.artist,
    });
  };

  const handleViewAlbum = () => {
    setSearchFilter("song");
    setSearchQuery(
      track.album ? `${track.artist} ${track.album}` : track.artist,
    );
    triggerSearchNow();
    closeTrackMenu();
    closeNowPlaying();
  };

  const handleCreatePlaylistAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed || creatingRemotePlaylist) return;

    const syncRemote = isAuthenticated && playlistCreateTarget === "remote";
    setCreatingRemotePlaylist(syncRemote);
    try {
      const result = await createPlaylist({
        title: trimmed,
        privacyStatus: "PRIVATE",
        syncWithYTMusic: syncRemote,
        initialTrack: track,
      });
      if (result) {
        setNewPlaylistName("");
      }
    } finally {
      setCreatingRemotePlaylist(false);
    }
  };

  const bitrateKbps =
    details && details.bitrate > 0
      ? `${Math.round(details.bitrate / 1000)} kbps`
      : "—";

  const channelsLabel =
    details?.audioChannels === 2
      ? "Stereo (2 ch)"
      : details?.audioChannels === 1
        ? "Mono (1 ch)"
        : details?.audioChannels
          ? `${details.audioChannels} ch`
          : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md select-none"
      onClick={closeTrackMenu}
      role="dialog"
      aria-modal="true"
      aria-label={`Opzioni per ${track.title}`}
    >
      <div
        className="at-modal-pop w-full max-w-[430px] rounded-3xl p-5 space-y-4 shadow-2xl shadow-black/75 at-tonal"
        style={{
          backgroundColor: "rgb(var(--md-surface-container-high-rgb) / 0.96)",
          border: "1px solid rgb(var(--md-outline-rgb) / 0.30)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header con copertina scalloped, titolo, artista */}
        <div
          className="flex items-center gap-3.5 pb-3.5"
          style={{ borderBottom: "1px solid rgb(var(--md-outline-rgb) / 0.2)" }}
        >
          {subView !== "menu" && (
            <button
              type="button"
              onClick={() => setSubView("menu")}
              aria-label="Torna al menu brano"
              className="p-2 rounded-full text-zinc-300 hover:text-white hover:bg-white/[0.08] transition shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <ScallopedArtwork
            src={track.cover}
            alt={track.title}
            size={52}
            variant="cookie10"
            active={isPlayingTrack}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2
                className="text-[14.5px] font-bold truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                {track.title}
              </h2>
              {track.isExplicit && <ExplicitBadge />}
            </div>
            <p
              className="text-[12px] truncate mt-0.5"
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

          <button
            type="button"
            onClick={closeTrackMenu}
            aria-label="Chiudi menu traccia"
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {subView === "menu" && (
          <div className="space-y-4">
            {/* Slider volume rapido */}
            <div
              className="rounded-2xl px-3.5 py-2.5 flex items-center gap-3 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "Riattiva audio" : "Silenzia"}
                className="p-1 rounded-full hover:bg-white/[0.08] transition shrink-0"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {effectiveVolume === 0 ? (
                  <VolumeX className="w-4 h-4 opacity-65" />
                ) : effectiveVolume < 0.5 ? (
                  <Volume1 className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              <ExpressiveSlider
                size="sm"
                min={0}
                max={1}
                step={0.01}
                value={effectiveVolume}
                ariaLabel="Controllo rapido volume"
                formatTooltip={(v) => `${Math.round(v * 100)}%`}
                onChange={(next) => setVolume(next)}
                className="flex-1"
              />

              <span
                className="text-[11.5px] font-medium tabular-nums w-9 text-right shrink-0"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {Math.round(effectiveVolume * 100)}%
              </span>
            </div>

            {/* Griglia azioni 2x2 */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void handleStartRadio()}
                disabled={radioLoading}
                className="rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 disabled:opacity-60 transition at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb) / 0.72)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                {radioLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <Radio className="w-4 h-4 shrink-0" />
                )}
                <span className="text-[12.5px] font-semibold truncate">
                  Avvia radio
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSubView("playlists")}
                className="rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.88)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }}
              >
                <ListPlus
                  className="w-4 h-4 shrink-0"
                  style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                />
                <span className="text-[12.5px] font-semibold truncate">
                  Aggiungi a playlist
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleLike(track)}
                className="rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 transition at-tonal"
                style={
                  isLiked
                    ? {
                        backgroundColor:
                          "rgb(var(--md-secondary-container-rgb) / 0.9)",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
                        color: "rgb(var(--md-on-secondary-container-rgb))",
                      }
                    : {
                        backgroundColor:
                          "rgb(var(--md-surface-container-rgb) / 0.88)",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                        color: "rgb(var(--md-on-surface-rgb))",
                      }
                }
              >
                <Heart
                  className={`w-4 h-4 shrink-0 ${isLiked ? "fill-current" : ""}`}
                  style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                />
                <span className="text-[12.5px] font-semibold truncate">
                  {isLiked ? "Nei preferiti" : "Aggiungi ai preferiti"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.88)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }}
              >
                {copiedLink ? (
                  <Check
                    className="w-4 h-4 shrink-0"
                    style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                  />
                ) : (
                  <Link2
                    className="w-4 h-4 shrink-0"
                    style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                  />
                )}
                <span className="text-[12.5px] font-semibold truncate">
                  {copiedLink ? "Link copiato!" : "Copia link"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  enqueueNext(track);
                  closeTrackMenu();
                }}
                className="rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.88)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }}
              >
                <ListEnd className="w-4 h-4 shrink-0 text-accent" />
                <span className="text-[12.5px] font-semibold truncate">
                  Riproduci dopo
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  addToQueue(track);
                  closeTrackMenu();
                }}
                className="rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 transition at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.88)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }}
              >
                <Plus className="w-4 h-4 shrink-0 text-accent" />
                <span className="text-[12.5px] font-semibold truncate">
                  Aggiungi alla coda
                </span>
              </button>

              <button
                type="button"
                disabled={isTrackDownloading}
                onClick={() => {
                  if (isTrackDownloaded) {
                    void removeDownloadedTrack(track.id);
                  } else {
                    void downloadTrack(track);
                  }
                  closeTrackMenu();
                }}
                className="col-span-2 rounded-2xl p-3 flex items-center gap-2.5 text-left hover:brightness-110 disabled:opacity-60 transition at-tonal"
                style={
                  isTrackDownloaded
                    ? {
                        backgroundColor: "rgb(16 185 129 / 0.14)",
                        border: "1px solid rgb(52 211 153 / 0.35)",
                        color: "#a7f3d0",
                      }
                    : {
                        backgroundColor:
                          "rgb(var(--md-surface-container-rgb) / 0.88)",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                        color: "rgb(var(--md-on-surface-rgb))",
                      }
                }
              >
                {isTrackDownloading ? (
                  <Loader2 className="w-4 h-4 shrink-0 text-sky-300 animate-spin" />
                ) : isTrackDownloaded ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <Download className="w-4 h-4 shrink-0 text-accent" />
                )}
                <span className="text-[12.5px] font-semibold truncate">
                  {isTrackDownloading
                    ? "Download offline in corso..."
                    : isTrackDownloaded
                      ? "Rimuovi download"
                      : "Scarica offline"}
                </span>
              </button>
            </div>

            {/* Voci navigazione rapida & Dettagli */}
            <div
              className="rounded-2xl overflow-hidden divide-y divide-white/[0.06] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              <button
                type="button"
                onClick={handleViewArtist}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.06] transition"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <UserRound
                    className="w-4 h-4 shrink-0"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  />
                  <span className="min-w-0">
                    <span
                      className="block text-[13px] font-medium"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Visualizza artista
                    </span>
                    <span
                      className="block text-[11.5px] truncate"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      {track.artist}
                    </span>
                  </span>
                </span>
                <ChevronRight
                  className="w-4 h-4 shrink-0"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                />
              </button>

              <button
                type="button"
                onClick={handleViewAlbum}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.06] transition"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Disc3
                    className="w-4 h-4 shrink-0"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  />
                  <span className="min-w-0">
                    <span
                      className="block text-[13px] font-medium"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Visualizza album
                    </span>
                    <span
                      className="block text-[11.5px] truncate"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      {track.album || "Cerca album correlato"}
                    </span>
                  </span>
                </span>
                <ChevronRight
                  className="w-4 h-4 shrink-0"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                />
              </button>

              <button
                type="button"
                onClick={() => setSubView("details")}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.06] transition"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Info
                    className="w-4 h-4 shrink-0"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  />
                  <span className="min-w-0">
                    <span
                      className="block text-[13px] font-medium"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Dettagli tecnici
                    </span>
                    <span
                      className="block text-[11.5px] truncate"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      Codec, bitrate, itag e ID video YouTube
                    </span>
                  </span>
                </span>
                <ChevronRight
                  className="w-4 h-4 shrink-0"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                />
              </button>
            </div>

            {feedbackMessage && (
              <p
                className="text-center text-[12px] font-medium px-2"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              >
                {feedbackMessage}
              </p>
            )}
          </div>
        )}

        {subView === "playlists" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span
                className="text-[12px] font-medium"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Scegli una playlist
              </span>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => void refreshRemotePlaylists()}
                  disabled={remotePlaylistsStatus === "loading"}
                  title="Sincronizza playlist YouTube Music"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium hover:bg-white/[0.08] disabled:opacity-50 transition"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  <RefreshCw
                    className={`w-3 h-3 ${
                      remotePlaylistsStatus === "loading" ? "animate-spin" : ""
                    }`}
                  />
                  Sincronizza
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                closeTrackMenu();
                openCreatePlaylistModal(track);
              }}
              className="w-full px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-2 text-left text-[12.5px] font-semibold hover:brightness-110 transition active:scale-[0.99] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
                color: "rgb(var(--md-on-primary-container-rgb))",
              }}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </span>
                <span className="truncate">Nuova playlist</span>
              </span>
              <span className="text-[11px] opacity-80 shrink-0">
                Con opzioni e privacy
              </span>
            </button>

            <div className="max-h-64 overflow-y-auto space-y-2.5 pr-0.5">
              {isAuthenticated && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-1">
                    <span
                      className="text-[10.5px] font-semibold uppercase tracking-wider"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      YouTube Music
                    </span>
                    {editableRemotePlaylists.length > 0 && (
                      <span
                        className="text-[10.5px] tabular-nums"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        {editableRemotePlaylists.length}
                      </span>
                    )}
                  </div>

                  {remotePlaylistsStatus === "loading" &&
                  editableRemotePlaylists.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-zinc-300">
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                      />
                      Sincronizzazione playlist YouTube Music...
                    </div>
                  ) : remotePlaylistsStatus === "error" &&
                    editableRemotePlaylists.length === 0 ? (
                    <div className="rounded-2xl bg-white/[0.04] p-3 text-center space-y-2">
                      <p className="text-[12px] text-zinc-300">
                        {remotePlaylistsError ||
                          "Impossibile caricare le playlist YouTube Music."}
                      </p>
                      <button
                        type="button"
                        onClick={() => void refreshRemotePlaylists()}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-semibold transition-transform active:scale-95"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-primary-container-rgb))",
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Riprova
                      </button>
                    </div>
                  ) : editableRemotePlaylists.length === 0 ? (
                    <p
                      className="py-2 px-2 text-[12px]"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      Nessuna playlist YouTube Music modificabile trovata.
                    </p>
                  ) : (
                    editableRemotePlaylists.map((pl) => {
                      const cleanId = pl.id.trim().replace(/^VL/, "");
                      const isLikedPlaylist = Boolean(
                        pl.isLikedSongs || cleanId === "LM",
                      );
                      const contains = isLikedPlaylist
                        ? likedTrackIds.has(track.id) ||
                          (remotePlaylistTrackIds["LM"]?.includes(track.id) ??
                            false)
                        : (remotePlaylistTrackIds[cleanId]?.includes(
                            track.id,
                          ) ?? false);
                      const isPending = Boolean(
                        remotePlaylistMutatingKeys[`${cleanId}:${track.id}`],
                      );

                      return (
                        <button
                          key={pl.id}
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            if (contains) {
                              void removeTrackFromRemotePlaylistOptimistic(
                                pl,
                                track,
                              );
                            } else {
                              void addTrackToRemotePlaylistOptimistic(
                                pl,
                                track,
                              );
                            }
                          }}
                          className="w-full px-3 py-2 rounded-2xl flex items-center justify-between gap-2.5 text-left hover:bg-white/[0.06] disabled:opacity-65 transition"
                          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-xl overflow-hidden bg-white/[0.07] shrink-0 flex items-center justify-center">
                              {pl.cover ? (
                                <img
                                  src={pl.cover}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : isLikedPlaylist ? (
                                <Heart
                                  className="w-4 h-4 fill-current"
                                  style={{
                                    color: "rgb(var(--md-accent-primary-rgb))",
                                  }}
                                />
                              ) : (
                                <ListMusic className="w-4 h-4 text-zinc-400" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium truncate">
                                {pl.title}
                              </span>
                              <span
                                className="block text-[11px] truncate tabular-nums"
                                style={{
                                  color: "rgb(var(--md-on-surface-variant-rgb))",
                                }}
                              >
                                {pl.trackCount || "Playlist YouTube Music"}
                              </span>
                            </span>
                          </span>

                          {isPending ? (
                            <Loader2
                              className="w-4 h-4 animate-spin shrink-0"
                              style={{
                                color: "rgb(var(--md-accent-primary-rgb))",
                              }}
                            />
                          ) : contains ? (
                            <Check
                              className="w-4 h-4 shrink-0"
                              style={{
                                color: "rgb(var(--md-accent-primary-rgb))",
                              }}
                            />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              <div className="space-y-1">
                {isAuthenticated && (
                  <div className="flex items-center justify-between px-1 pt-1">
                    <span
                      className="text-[10.5px] font-semibold uppercase tracking-wider"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      Playlist locali
                    </span>
                    {playlists.length > 0 && (
                      <span
                        className="text-[10.5px] tabular-nums"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        {playlists.length}
                      </span>
                    )}
                  </div>
                )}

                {playlists.length === 0 ? (
                  !isAuthenticated && (
                    <p
                      className="py-4 text-center text-[12.5px]"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      Nessuna playlist creata. Creane una qui sotto.
                    </p>
                  )
                ) : (
                  playlists.map((pl) => {
                    const contains = pl.tracks.some((t) => t.id === track.id);
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() =>
                          contains
                            ? removeTrackFromPlaylist(pl.id, track.id)
                            : addTrackToPlaylist(pl.id, track)
                        }
                        className="w-full px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-2 text-left hover:bg-white/[0.06] transition"
                        style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium truncate">
                            {pl.name}
                          </span>
                          <span
                            className="block text-[11px] tabular-nums"
                            style={{
                              color: "rgb(var(--md-on-surface-variant-rgb))",
                            }}
                          >
                            {pl.tracks.length}{" "}
                            {pl.tracks.length === 1 ? "brano" : "brani"}
                          </span>
                        </span>
                        {contains && (
                          <Check
                            className="w-4 h-4 shrink-0"
                            style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div
              className="pt-2.5 space-y-2"
              style={{ borderTop: "1px solid rgb(var(--md-outline-rgb) / 0.2)" }}
            >
              {isAuthenticated && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPlaylistCreateTarget("remote")}
                    className="flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-colors"
                    style={
                      playlistCreateTarget === "remote"
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                    }
                  >
                    YouTube Music
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaylistCreateTarget("local")}
                    className="flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-colors"
                    style={
                      playlistCreateTarget === "local"
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                    }
                  >
                    Locale
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => void handleCreatePlaylistAndAdd(e)}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  disabled={creatingRemotePlaylist}
                  placeholder={
                    isAuthenticated && playlistCreateTarget === "remote"
                      ? "Nuova playlist YouTube Music..."
                      : "Nome nuova playlist locale..."
                  }
                  className="flex-1 h-9 px-3.5 rounded-full text-[12.5px] placeholder-zinc-400/75 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.5)] disabled:opacity-60"
                  style={{
                    backgroundColor: "rgb(var(--md-surface-container-rgb))",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
                    color: "rgb(var(--md-on-surface-rgb))",
                  }}
                />
                <button
                  type="submit"
                  disabled={!newPlaylistName.trim() || creatingRemotePlaylist}
                  className="h-9 px-3.5 rounded-full text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1 transition-transform active:scale-95"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  {creatingRemotePlaylist ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Crea
                </button>
              </form>
            </div>
          </div>
        )}

        {subView === "details" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span
                className="text-[12px] font-semibold"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Dettagli tecnici stream
              </span>
              {detailsLoading && (
                <span
                  className="inline-flex items-center gap-1.5 text-[11.5px]"
                  style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analisi formati...
                </span>
              )}
            </div>

            <div
              className="rounded-2xl divide-y divide-white/[0.06] text-[12.5px] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}>
                  ID Video YouTube
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void copyTextToClipboard(track.id).then((ok) => {
                      if (ok) {
                        setCopiedId(true);
                        if (copiedIdTimerRef.current !== null) {
                          window.clearTimeout(copiedIdTimerRef.current);
                        }
                        copiedIdTimerRef.current = window.setTimeout(() => {
                          copiedIdTimerRef.current = null;
                          setCopiedId(false);
                        }, 1600);
                      }
                    });
                  }}
                  title="Copia ID"
                  className="inline-flex items-center gap-1.5 font-mono text-[12px] hover:underline"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {track.id}
                  {copiedId ? (
                    <Check
                      className="w-3 h-3"
                      style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                    />
                  ) : (
                    <Copy className="w-3 h-3 opacity-65" />
                  )}
                </button>
              </div>

              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}>
                  Durata
                </span>
                <span
                  className="tabular-nums font-medium"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {details?.durationSeconds
                    ? `${formatTime(details.durationSeconds)} (${details.durationSeconds}s)`
                    : track.duration || "—"}
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}>
                  Codec audio
                </span>
                <span
                  className="font-mono font-medium"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {details?.codec || (detailsLoading ? "..." : "—")}
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}>
                  Contenitore MIME
                </span>
                <span
                  className="font-mono"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {details?.mimeType || (detailsLoading ? "..." : "—")}
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}>
                  Bitrate
                </span>
                <span
                  className="tabular-nums font-medium"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {details ? bitrateKbps : detailsLoading ? "..." : "—"}
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}>
                  Itag / Client
                </span>
                <span
                  className="font-mono tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {details
                    ? `${details.itag ?? "—"} · ${details.clientUsed}`
                    : detailsLoading
                      ? "..."
                      : "—"}
                </span>
              </div>

              {(details?.sampleRate || channelsLabel) && (
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    Frequenza / Canali
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                  >
                    {[
                      details?.sampleRate
                        ? `${(details.sampleRate / 1000).toFixed(1)} kHz`
                        : null,
                      channelsLabel ?? null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              )}

              {details?.contentLength && (
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    Dimensione stream
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                  >
                    {formatBytes(details.contentLength)}
                  </span>
                </div>
              )}
            </div>

            {detailsError && (
              <p className="text-[11.5px] text-rose-400 px-1">{detailsError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
