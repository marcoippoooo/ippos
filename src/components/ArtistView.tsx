import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Disc3,
  Heart,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";
import {
  fetchAlbumTracks,
  fetchArtistPage,
  formatNetworkError,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { ArtistPageData, ArtistRelease, Track } from "../types/music";
import { formatTime } from "../utils/formatTime";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerBars } from "./EqualizerBars";
import { ExplicitBadge } from "./ExplicitBadge";
import { ScallopedArtwork } from "./ScallopedArtwork";
import { TrackDownloadButton } from "./TrackDownloadButton";

type ReleaseFilter = "all" | "album" | "single";

export function ArtistView() {
  const selectedArtist = usePlayerStore((s) => s.selectedArtist);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const likedTracks = usePlayerStore((s) => s.likedTracks);

  const closeArtistView = usePlayerStore((s) => s.closeArtistView);
  const openArtist = usePlayerStore((s) => s.openArtist);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const addTracksToQueue = usePlayerStore((s) => s.addTracksToQueue);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const openTrackMenu = usePlayerStore((s) => s.openTrackMenu);

  const [artistData, setArtistData] = useState<ArtistPageData | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showFullBio, setShowFullBio] = useState(false);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");

  const [selectedRelease, setSelectedRelease] = useState<ArtistRelease | null>(
    null,
  );
  const [albumTracks, setAlbumTracks] = useState<Track[]>([]);
  const [albumStatus, setAlbumStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [albumError, setAlbumError] = useState<string | null>(null);
  const [quickPlayingAlbumId, setQuickPlayingAlbumId] = useState<string | null>(
    null,
  );

  const reqSeqRef = useRef(0);
  const albumSeqRef = useRef(0);

  const artistKey = `${selectedArtist?.id ?? ""}::${selectedArtist?.name ?? ""}`;

  useEffect(() => {
    if (!selectedArtist) return;

    const seq = ++reqSeqRef.current;
    setStatus("loading");
    setError(null);
    setArtistData(null);
    setShowFullBio(false);
    setReleaseFilter("all");
    setSelectedRelease(null);
    setAlbumTracks([]);
    setAlbumStatus("idle");
    setAlbumError(null);

    void fetchArtistPage(selectedArtist)
      .then((data) => {
        if (reqSeqRef.current !== seq) return;
        setArtistData(data);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (reqSeqRef.current !== seq) return;
        setError(formatNetworkError(err));
        setStatus("error");
      });

    return () => {
      reqSeqRef.current += 1;
    };
  }, [artistKey, reloadNonce]);

  const likedIds = useMemo(
    () => new Set(likedTracks.map((t) => t.id)),
    [likedTracks],
  );

  const combinedReleases = useMemo(() => {
    if (!artistData) return [];
    if (releaseFilter === "album") return artistData.albums;
    if (releaseFilter === "single") return artistData.singles;
    return [...artistData.albums, ...artistData.singles];
  }, [artistData, releaseFilter]);

  const openReleaseDetail = (release: ArtistRelease) => {
    if (selectedRelease?.id === release.id && albumStatus === "success") {
      setSelectedRelease(null);
      return;
    }
    const seq = ++albumSeqRef.current;
    setSelectedRelease(release);
    setAlbumTracks([]);
    setAlbumStatus("loading");
    setAlbumError(null);

    void fetchAlbumTracks(release.id, {
      title: release.title,
      artist: artistData?.name || selectedArtist?.name,
      artistId: artistData?.id.startsWith("UC")
        ? artistData.id
        : selectedArtist?.id,
      cover: release.cover,
    })
      .then((tracks) => {
        if (albumSeqRef.current !== seq) return;
        setAlbumTracks(tracks);
        setAlbumStatus("success");
      })
      .catch((err: unknown) => {
        if (albumSeqRef.current !== seq) return;
        setAlbumError(formatNetworkError(err));
        setAlbumStatus("error");
      });
  };

  const handleQuickPlayRelease = async (
    e: React.MouseEvent,
    release: ArtistRelease,
  ) => {
    e.stopPropagation();
    setQuickPlayingAlbumId(release.id);
    try {
      const tracks = await fetchAlbumTracks(release.id, {
        title: release.title,
        artist: artistData?.name || selectedArtist?.name,
        artistId: artistData?.id.startsWith("UC")
          ? artistData.id
          : selectedArtist?.id,
        cover: release.cover,
      });
      if (tracks.length > 0) {
        playTrack(tracks[0], tracks);
      } else {
        openReleaseDetail(release);
      }
    } catch {
      openReleaseDetail(release);
    } finally {
      setQuickPlayingAlbumId((prev) => (prev === release.id ? null : prev));
    }
  };

  if (!selectedArtist) {
    return (
      <div className="max-w-5xl py-16 text-center space-y-3">
        <UserRound className="w-8 h-8 text-zinc-500 mx-auto" />
        <p className="text-[15px] font-semibold">Nessun artista selezionato</p>
        <button
          type="button"
          onClick={closeArtistView}
          className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold"
          style={{
            backgroundColor: "rgb(var(--md-primary-container-rgb))",
            color: "rgb(var(--md-on-primary-container-rgb))",
          }}
        >
          Torna indietro
        </button>
      </div>
    );
  }

  const renderTrackRow = (track: Track, list: Track[], index: number) => {
    const isCurrent = currentTrack?.id === track.id;
    const isPlayingTrack = isCurrent && playbackStatus === "playing";
    const isLoadingTrack = isCurrent && playbackStatus === "loading";
    const isLiked = likedIds.has(track.id);
    const displayDuration =
      track.duration ||
      (track.durationSeconds > 0 ? formatTime(track.durationSeconds) : "—");

    return (
      <div
        key={`${track.id}-${index}`}
        onClick={() => playTrack(track, list)}
        className={`flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-colors group first:rounded-t-3xl last:rounded-b-3xl ${
          isCurrent ? "" : "hover:bg-white/[0.05]"
        }`}
        style={
          isCurrent
            ? {
                backgroundColor: "rgb(var(--md-primary-container-rgb) / 0.55)",
              }
            : undefined
        }
      >
        <span
          className="w-5 text-center text-[12px] font-medium tabular-nums shrink-0"
          style={{
            color: isCurrent
              ? "rgb(var(--md-accent-primary-rgb))"
              : "rgb(var(--md-on-surface-variant-rgb))",
          }}
        >
          {index + 1}
        </span>

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
              isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
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

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleLike(track);
            }}
            aria-label={
              isLiked ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"
            }
            className={`p-1.5 rounded-full transition-opacity ${
              isLiked
                ? "opacity-100"
                : "text-zinc-400 hover:text-zinc-100 opacity-0 group-hover:opacity-100"
            }`}
            style={
              isLiked ? { color: "rgb(var(--md-accent-primary-rgb))" } : undefined
            }
          >
            <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
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

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openTrackMenu(track);
            }}
            title="Opzioni brano"
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        <span
          className="text-[12px] tabular-nums w-12 text-right shrink-0"
          style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
        >
          {displayDuration}
        </span>
      </div>
    );
  };

  return (
    <div className="max-w-6xl space-y-8 pb-10">
      {/* Barra superiore ritorno */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={closeArtistView}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium hover:brightness-110 transition at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Indietro
        </button>

        {status === "success" && (
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            title="Aggiorna scheda artista"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium hover:brightness-110 transition at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              color: "rgb(var(--md-on-surface-variant-rgb))",
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Aggiorna
          </button>
        )}
      </div>

      {/* Skeleton di caricamento */}
      {status === "loading" && (
        <div className="space-y-8 animate-pulse">
          <div
            className="rounded-3xl p-7 flex flex-col sm:flex-row items-center sm:items-end gap-6 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
            }}
          >
            <div className="w-32 h-32 rounded-full bg-white/[0.08] shrink-0" />
            <div className="flex-1 space-y-3 w-full">
              <div className="h-7 w-56 rounded-full bg-white/[0.09]" />
              <div className="h-4 w-36 rounded-full bg-white/[0.06]" />
              <div className="flex gap-2 pt-2">
                <div className="h-9 w-36 rounded-full bg-white/[0.08]" />
                <div className="h-9 w-40 rounded-full bg-white/[0.06]" />
              </div>
            </div>
          </div>

          <div
            className="rounded-3xl divide-y divide-white/[0.05] overflow-hidden at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.65)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.16)",
            }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3.5 px-4 py-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.08] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-48 rounded-full bg-white/[0.08]" />
                  <div className="h-3 w-32 rounded-full bg-white/[0.05]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errore caricamento artista */}
      {status === "error" && (
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.06] p-8 text-center space-y-3">
          <AlertCircle className="w-6 h-6 mx-auto text-accent" />
          <p className="text-[15px] font-semibold text-zinc-100">
            Impossibile caricare l'artista “{selectedArtist.name}”
          </p>
          <p className="text-[12.5px] text-zinc-400 max-w-md mx-auto">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-transform active:scale-95"
            style={{
              backgroundColor: "rgb(var(--md-primary-container-rgb))",
              color: "rgb(var(--md-on-primary-container-rgb))",
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Riprova
          </button>
        </div>
      )}

      {/* Contenuto artista caricato */}
      {status === "success" && artistData && (
        <>
          {/* Hero Header Artista */}
          <section
            className="relative rounded-3xl overflow-hidden p-6 sm:p-7 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
            }}
          >
            {(artistData.banner || !artistData.thumbnail.startsWith("data:")) && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-30 blur-2xl scale-110"
                style={{
                  backgroundImage: `url(${artistData.banner || artistData.thumbnail})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(120deg, rgb(var(--md-surface-base-rgb) / 0.86) 0%, rgb(var(--md-surface-container-rgb) / 0.72) 100%)",
              }}
            />

            <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end gap-6">
              <ScallopedArtwork
                src={artistData.thumbnail}
                alt={artistData.name}
                size={132}
                variant="cookie10"
                fallback={<UserRound className="w-10 h-10 text-zinc-400" />}
              />

              <div className="min-w-0 flex-1 text-center sm:text-left space-y-2.5">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide"
                    style={{
                      backgroundColor: "rgb(var(--md-primary-container-rgb))",
                      color: "rgb(var(--md-on-primary-container-rgb))",
                    }}
                  >
                    Artista
                  </span>
                  {artistData.subscribers && (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium"
                      style={{
                        backgroundColor:
                          "rgb(var(--md-secondary-container-rgb) / 0.85)",
                        color: "rgb(var(--md-on-secondary-container-rgb))",
                      }}
                    >
                      {artistData.subscribers}
                    </span>
                  )}
                </div>

                <h1
                  className="text-[30px] sm:text-[36px] font-bold tracking-[-0.03em] leading-tight truncate"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {artistData.name}
                </h1>

                {artistData.description && (
                  <div className="max-w-2xl">
                    <p
                      className={`text-[12.5px] leading-relaxed ${
                        showFullBio ? "" : "line-clamp-2"
                      }`}
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      {artistData.description}
                    </p>
                    {artistData.description.length > 140 && (
                      <button
                        type="button"
                        onClick={() => setShowFullBio((v) => !v)}
                        className="mt-1 text-[11.5px] font-semibold text-accent hover:underline"
                      >
                        {showFullBio ? "Mostra meno" : "Leggi tutto"}
                      </button>
                    )}
                  </div>
                )}

                {artistData.topTracks.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        playTrack(artistData.topTracks[0], artistData.topTracks)
                      }
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold shadow-md transition-transform active:scale-95"
                      style={{
                        backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                        color: "rgb(var(--md-on-accent-rgb))",
                      }}
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Riproduci tutto
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        addTracksToQueue(artistData.topTracks, artistData.name)
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[12.5px] font-semibold hover:brightness-110 transition active:scale-95 at-tonal"
                      style={{
                        backgroundColor:
                          "rgb(var(--md-surface-container-high-rgb) / 0.85)",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.26)",
                        color: "rgb(var(--md-on-surface-rgb))",
                      }}
                    >
                      <ListPlus className="w-4 h-4 text-accent" />
                      Aggiungi tutto alla coda
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Sezione Brani popolari / Top brani */}
          <section className="space-y-3.5">
            <div className="flex items-baseline justify-between">
              <h2
                className="text-[19px] font-semibold tracking-[-0.02em]"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Brani popolari
              </h2>
              {artistData.topTracks.length > 0 && (
                <span
                  className="text-[12px] tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {artistData.topTracks.length} brani
                </span>
              )}
            </div>

            {artistData.topTracks.length === 0 ? (
              <div
                className="rounded-3xl p-8 text-center space-y-2 at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.68)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                }}
              >
                <Music2 className="w-6 h-6 text-zinc-500 mx-auto" />
                <p className="text-[13.5px] text-zinc-300">
                  Nessun brano popolare disponibile per questo artista.
                </p>
              </div>
            ) : (
              <div
                className="divide-y divide-white/[0.06] rounded-3xl overflow-visible at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.72)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                }}
              >
                {artistData.topTracks.map((track, idx) =>
                  renderTrackRow(track, artistData.topTracks, idx),
                )}
              </div>
            )}
          </section>

          {/* Sezione Album e singoli */}
          {(artistData.albums.length > 0 || artistData.singles.length > 0) && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2.5">
                  <h2
                    className="text-[19px] font-semibold tracking-[-0.02em]"
                    style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                  >
                    Album e singoli
                  </h2>
                  <span
                    className="text-[12px] tabular-nums"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {combinedReleases.length} uscite
                  </span>
                </div>

                {artistData.albums.length > 0 &&
                  artistData.singles.length > 0 && (
                    <div
                      className="inline-flex p-1 rounded-full at-tonal"
                      style={{
                        backgroundColor:
                          "rgb(var(--md-surface-container-rgb) / 0.85)",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                      }}
                    >
                      {(
                        [
                          { id: "all", label: "Tutti" },
                          { id: "album", label: "Album" },
                          { id: "single", label: "Singoli ed EP" },
                        ] as const
                      ).map((chip) => {
                        const active = releaseFilter === chip.id;
                        return (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => setReleaseFilter(chip.id)}
                            className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-all duration-200"
                            style={
                              active
                                ? {
                                    backgroundColor:
                                      "rgb(var(--md-primary-container-rgb))",
                                    color:
                                      "rgb(var(--md-on-primary-container-rgb))",
                                  }
                                : {
                                    color:
                                      "rgb(var(--md-on-surface-variant-rgb))",
                                  }
                            }
                          >
                            {chip.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* Dettaglio tracce album selezionato */}
              {selectedRelease && (
                <div
                  className="rounded-3xl p-5 space-y-4 at-tonal"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-surface-container-high-rgb) / 0.82)",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <img
                        src={selectedRelease.cover}
                        alt={selectedRelease.title}
                        referrerPolicy="no-referrer"
                        className="w-16 h-16 rounded-2xl object-cover ring-1 ring-white/15 shrink-0"
                      />
                      <div className="min-w-0">
                        <span
                          className="text-[10.5px] font-semibold uppercase tracking-wide text-accent"
                        >
                          {selectedRelease.type === "single"
                            ? "Singolo / EP"
                            : "Album"}
                          {selectedRelease.year ? ` · ${selectedRelease.year}` : ""}
                        </span>
                        <h3
                          className="text-[17px] font-bold truncate"
                          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                        >
                          {selectedRelease.title}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {albumStatus === "success" && albumTracks.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              playTrack(albumTracks[0], albumTracks)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-semibold transition-transform active:scale-95"
                            style={{
                              backgroundColor:
                                "rgb(var(--md-accent-primary-rgb))",
                              color: "rgb(var(--md-on-accent-rgb))",
                            }}
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            Riproduci album
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              addTracksToQueue(albumTracks, selectedRelease.title)
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium hover:brightness-110 transition"
                            style={{
                              backgroundColor:
                                "rgb(var(--md-secondary-container-rgb))",
                              color:
                                "rgb(var(--md-on-secondary-container-rgb))",
                            }}
                          >
                            <ListPlus className="w-3.5 h-3.5" />
                            In coda
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedRelease(null)}
                        aria-label="Chiudi dettaglio album"
                        className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {albumStatus === "loading" && (
                    <div className="py-6 flex items-center justify-center gap-2.5 text-[13px] text-zinc-300">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      Caricamento brani dell'uscita...
                    </div>
                  )}

                  {albumStatus === "error" && (
                    <p className="py-4 text-center text-[13px] text-rose-300">
                      {albumError || "Impossibile caricare i brani."}
                    </p>
                  )}

                  {albumStatus === "success" && albumTracks.length > 0 && (
                    <div
                      className="divide-y divide-white/[0.06] rounded-2xl overflow-visible at-tonal"
                      style={{
                        backgroundColor:
                          "rgb(var(--md-surface-container-rgb) / 0.72)",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                      }}
                    >
                      {albumTracks.map((track, idx) =>
                        renderTrackRow(track, albumTracks, idx),
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {combinedReleases.map((release) => {
                  const isSelected = selectedRelease?.id === release.id;
                  const isQuickLoading = quickPlayingAlbumId === release.id;
                  return (
                    <div
                      key={release.id}
                      onClick={() => openReleaseDetail(release)}
                      className="group p-3 rounded-3xl cursor-pointer transition-all duration-200 hover:brightness-110 space-y-2.5 at-tonal"
                      style={
                        isSelected
                          ? {
                              backgroundColor:
                                "rgb(var(--md-primary-container-rgb) / 0.72)",
                              border:
                                "1px solid rgb(var(--md-accent-primary-rgb) / 0.5)",
                            }
                          : {
                              backgroundColor:
                                "rgb(var(--md-surface-container-rgb) / 0.72)",
                              border:
                                "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                            }
                      }
                    >
                      <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-[#18181D] ring-1 ring-white/10">
                        <img
                          src={release.cover}
                          alt={release.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                        <div
                          className={`absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent flex items-end justify-end p-2.5 transition-opacity ${
                            isQuickLoading
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => void handleQuickPlayRelease(e, release)}
                            disabled={isQuickLoading}
                            aria-label={`Riproduci ${release.title}`}
                            className="w-9 h-9 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
                            style={{
                              backgroundColor:
                                "rgb(var(--md-accent-primary-rgb))",
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
                      </div>

                      <div className="min-w-0 px-0.5 space-y-0.5">
                        <p
                          className="text-[13px] font-semibold truncate"
                          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                        >
                          {release.title}
                        </p>
                        <p
                          className="text-[11.5px] truncate flex items-center gap-1"
                          style={{
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }}
                        >
                          <Disc3 className="w-3 h-3 shrink-0 opacity-75" />
                          <span className="truncate">
                            {release.subtitle ||
                              (release.type === "single" ? "Singolo" : "Album")}
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Sezione Artisti simili */}
          {artistData.relatedArtists.length > 0 && (
            <section className="space-y-4">
              <h2
                className="text-[19px] font-semibold tracking-[-0.02em]"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Artisti simili
              </h2>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {artistData.relatedArtists.map((rel) => (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => openArtist({ id: rel.id, name: rel.name })}
                    className="group p-3.5 rounded-3xl flex flex-col items-center text-center gap-3 hover:brightness-110 transition-all at-tonal"
                    style={{
                      backgroundColor:
                        "rgb(var(--md-surface-container-rgb) / 0.72)",
                      border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                    }}
                  >
                    <div className="w-24 h-24 rounded-full overflow-hidden ring-1 ring-white/15 bg-[#18181D] shadow-md">
                      <img
                        src={rel.thumbnail}
                        alt={rel.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <div className="min-w-0 w-full space-y-0.5">
                      <p
                        className="text-[13.5px] font-semibold truncate group-hover:underline group-hover:text-accent"
                        style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                      >
                        {rel.name}
                      </p>
                      {rel.subtitle && (
                        <p
                          className="text-[11.5px] truncate"
                          style={{
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }}
                        >
                          {rel.subtitle}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
