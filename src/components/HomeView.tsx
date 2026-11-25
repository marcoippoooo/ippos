import { useMemo, useState } from "react";
import {
  AlertCircle,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { fetchRemotePlaylistTracks } from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { HomeMoodFilter, HomePlaylist } from "../types/music";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerBars } from "./EqualizerBars";
import { ExplicitBadge } from "./ExplicitBadge";
import { PlaylistCollageCover } from "./PlaylistCollageCover";

interface HomeViewProps {
  onReload: () => void;
  onSelectFilter: (filter: HomeMoodFilter) => void;
}

const CONTEXT_FILTERS: { id: HomeMoodFilter; label: string }[] = [
  { id: "all", label: "Tutto" },
  { id: "workout", label: "Allenamento" },
  { id: "energize", label: "Energia" },
  { id: "relax", label: "Relax" },
  { id: "podcasts", label: "Podcast" },
];

export function HomeView({ onReload, onSelectFilter }: HomeViewProps) {
  const homeFilter = usePlayerStore((s) => s.homeFilter);
  const homeSections = usePlayerStore((s) => s.homeSections);
  const homePlaylists = usePlayerStore((s) => s.homePlaylists);
  const homeStatus = usePlayerStore((s) => s.homeStatus);
  const homeError = usePlayerStore((s) => s.homeError);
  const authStatus = usePlayerStore((s) => s.authStatus);
  const remotePlaylists = usePlayerStore((s) => s.remotePlaylists);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const [loadingPlaylistId, setLoadingPlaylistId] = useState<string | null>(
    null,
  );

  const youtubePlaylists = useMemo<HomePlaylist[]>(() => {
    const merged: HomePlaylist[] = [];
    const seen = new Set<string>();

    if (homeFilter === "all" && authStatus === "authenticated") {
      for (const pl of remotePlaylists) {
        if (pl.isLikedSongs || seen.has(pl.id)) continue;
        seen.add(pl.id);
        merged.push({
          id: pl.id,
          title: pl.title,
          subtitle: pl.subtitle || "Dalla tua libreria YouTube Music",
          cover: pl.cover,
          trackCount: pl.trackCount,
        });
        if (merged.length >= 4) break;
      }
    }

    for (const pl of homePlaylists) {
      if (seen.has(pl.id)) continue;
      seen.add(pl.id);
      merged.push(pl);
    }

    return merged.slice(0, 8);
  }, [homeFilter, authStatus, remotePlaylists, homePlaylists]);

  const handlePlayHomePlaylist = async (pl: HomePlaylist) => {
    if (pl.tracks && pl.tracks.length > 0) {
      playTrack(pl.tracks[0], pl.tracks);
      return;
    }

    setLoadingPlaylistId(pl.id);
    try {
      const tracks = await fetchRemotePlaylistTracks(pl.id);
      if (tracks.length > 0) {
        playTrack(tracks[0], tracks);
      }
    } catch {
      // Silenzioso per playlist non accessibili dal feed rapido
    } finally {
      setLoadingPlaylistId((prev) => (prev === pl.id ? null : prev));
    }
  };

  const renderTrackStateBadge = (
    isCurrent: boolean,
    size: "sm" | "md" = "sm",
  ) => {
    const isPlayingTrack = isCurrent && playbackStatus === "playing";
    const isLoadingTrack = isCurrent && playbackStatus === "loading";
    const iconCls = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";

    if (isLoadingTrack) {
      return <Loader2 className={`${iconCls} animate-spin`} />;
    }
    if (isPlayingTrack) {
      return <EqualizerBars playing className="h-3" />;
    }
    if (isCurrent) {
      return <Pause className={`${iconCls} fill-current`} />;
    }
    return <Play className={`${iconCls} fill-current ml-0.5`} />;
  };

  const firstSection = homeSections[0];
  const heroTrack = firstSection?.tracks[0] ?? null;
  const quickPickTracks = firstSection ? firstSection.tracks.slice(1, 7) : [];
  const otherSections = homeSections.slice(1);

  return (
    <div className="max-w-6xl space-y-9 pb-8">
      {/* Intestazione + Chip Filtri di Contesto */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h1
            className="text-[28px] font-bold tracking-[-0.03em]"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            Ascolta ora
          </h1>
          <button
            type="button"
            onClick={onReload}
            disabled={homeStatus === "loading"}
            title="Aggiorna suggerimenti"
            aria-label="Aggiorna Home"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium hover:brightness-110 disabled:opacity-50 transition at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
              color: "rgb(var(--md-on-surface-variant-rgb))",
            }}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${homeStatus === "loading" ? "animate-spin" : ""}`}
            />
            Aggiorna
          </button>
        </div>

        <div
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5"
          role="tablist"
          aria-label="Filtri di contesto"
        >
          {CONTEXT_FILTERS.map((chip) => {
            const active = homeFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectFilter(chip.id)}
                className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold shrink-0 transition-all duration-200 active:scale-95 at-tonal"
                style={
                  active
                    ? {
                        backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                        color: "rgb(var(--md-on-accent-rgb))",
                        border: "1px solid rgb(var(--md-accent-primary-rgb))",
                      }
                    : {
                        backgroundColor:
                          "rgb(var(--md-surface-container-rgb) / 0.85)",
                        color: "rgb(var(--md-on-surface-rgb))",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
                      }
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Skeleton di caricamento */}
      {(homeStatus === "idle" || homeStatus === "loading") && (
        <div className="space-y-8 animate-pulse">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div
              className="xl:col-span-5 h-48 rounded-3xl at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.16)",
              }}
            />
            <div className="xl:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-3 rounded-3xl at-tonal"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-surface-container-rgb) / 0.65)",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.16)",
                  }}
                >
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.08] shrink-0" />
                  <div className="flex-1 space-y-2 min-w-0">
                    <div className="h-3.5 w-32 rounded-full bg-white/[0.08]" />
                    <div className="h-3 w-24 rounded-full bg-white/[0.05]" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="h-5 w-44 rounded-full bg-white/[0.08]" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-3xl space-y-3"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-surface-container-rgb) / 0.58)",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.14)",
                  }}
                >
                  <div className="aspect-square w-full rounded-2xl bg-white/[0.07]" />
                  <div className="h-3.5 w-3/4 rounded-full bg-white/[0.08]" />
                  <div className="h-3 w-1/2 rounded-full bg-white/[0.05]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Errore caricamento feed */}
      {homeStatus === "error" && (
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.06] p-8 text-center space-y-3">
          <AlertCircle
            className="w-6 h-6 mx-auto"
            style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
          />
          <p className="text-[14px] font-semibold text-zinc-100">
            Impossibile caricare la Home
          </p>
          <p className="text-[12.5px] text-zinc-400 max-w-md mx-auto">
            {homeError}
          </p>
          <button
            type="button"
            onClick={onReload}
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

      {/* Stato vuoto */}
      {homeStatus === "success" && homeSections.length === 0 && (
        <div
          className="rounded-3xl p-10 text-center space-y-2.5 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.7)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
          }}
        >
          <Music2 className="w-6 h-6 text-zinc-500 mx-auto" />
          <p className="text-[14px] font-medium text-zinc-200">
            Nessun brano suggerito disponibile per questo filtro
          </p>
          <p className="text-[12.5px] text-zinc-500">
            Prova un altro stato d'animo oppure usa la ricerca in alto.
          </p>
        </div>
      )}

      {/* Hero Card + Scelte Rapide */}
      {homeStatus === "success" && firstSection && heroTrack && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2
              className="text-[19px] font-semibold tracking-[-0.02em]"
              style={{ color: "rgb(var(--md-on-surface-rgb))" }}
            >
              {firstSection.title}
            </h2>
            <span
              className="text-[12px] tabular-nums"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {firstSection.tracks.length} brani
            </span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            {/* Hero Card */}
            {(() => {
              const isHeroCurrent = currentTrack?.id === heroTrack.id;
              const isHeroPlaying =
                isHeroCurrent && playbackStatus === "playing";
              return (
                <div
                  onClick={() => playTrack(heroTrack, firstSection.tracks)}
                  className="xl:col-span-5 group rounded-3xl p-5 flex flex-col justify-between gap-5 cursor-pointer transition-all duration-200 hover:brightness-105 at-tonal"
                  style={{
                    background:
                      "linear-gradient(145deg, rgb(var(--md-primary-container-rgb) / 0.85), rgb(var(--md-surface-container-rgb) / 0.90))",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.30)",
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden shrink-0 shadow-xl shadow-black/45 ring-1 ring-white/15">
                      <img
                        src={heroTrack.cover}
                        alt={heroTrack.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-secondary-container-rgb) / 0.88)",
                          color: "rgb(var(--md-on-secondary-container-rgb))",
                        }}
                      >
                        <Sparkles className="w-3 h-3" />
                        Scelta in evidenza
                      </span>

                      <div className="flex items-center gap-1.5 min-w-0">
                        <h3
                          className="text-[18px] font-bold tracking-[-0.02em] truncate"
                          style={{
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }}
                        >
                          {heroTrack.title}
                        </h3>
                        {heroTrack.isExplicit && <ExplicitBadge />}
                      </div>

                      <p
                        className="text-[13px] truncate opacity-85"
                        style={{
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }}
                      >
                        <ArtistLinks
                          artist={heroTrack.artist}
                          artistId={heroTrack.artistId}
                          artists={heroTrack.artists}
                          inheritColor
                        />
                        {heroTrack.album ? ` — ${heroTrack.album}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playTrack(heroTrack, firstSection.tracks);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold shadow-md transition-transform active:scale-95 at-tonal"
                        style={{
                          backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                          color: "rgb(var(--md-on-accent-rgb))",
                        }}
                      >
                        {renderTrackStateBadge(isHeroCurrent, "sm")}
                        {isHeroPlaying ? "In riproduzione" : "Riproduci ora"}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToQueue(heroTrack);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-[12px] font-medium hover:brightness-110 transition at-tonal"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-surface-container-high-rgb) / 0.78)",
                          color: "rgb(var(--md-on-surface-rgb))",
                        }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Coda
                      </button>
                    </div>

                    <AddToPlaylistMenu track={heroTrack} />
                  </div>
                </div>
              );
            })()}

            {/* Griglia Scelte Rapide */}
            <div className="xl:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {quickPickTracks.map((track) => {
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <div
                    key={track.id}
                    onClick={() => playTrack(track, firstSection.tracks)}
                    className="group flex items-center gap-3.5 p-3 rounded-3xl cursor-pointer transition-all duration-200 hover:brightness-110 at-tonal"
                    style={
                      isCurrent
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb) / 0.72)",
                            border: "1px solid rgb(var(--md-outline-rgb) / 0.34)",
                          }
                        : {
                            backgroundColor:
                              "rgb(var(--md-surface-container-rgb) / 0.76)",
                            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                          }
                    }
                  >
                    <div className="relative w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-white/10 shrink-0 bg-[#18181D]">
                      <img
                        src={track.cover}
                        alt={track.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
                      />
                      <div
                        className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                          isCurrent
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center shadow-md"
                          style={{
                            backgroundColor:
                              "rgb(var(--md-accent-primary-rgb))",
                            color: "rgb(var(--md-on-accent-rgb))",
                          }}
                        >
                          {renderTrackStateBadge(isCurrent, "sm")}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p
                          className="text-[13.5px] font-semibold truncate transition-colors duration-500"
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
                        className="text-[12px] truncate mt-0.5"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        <ArtistLinks
                          artist={track.artist}
                          artistId={track.artistId}
                          artists={track.artists}
                        />
                      </p>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <AddToPlaylistMenu
                        track={track}
                        className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      />
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
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Sezione Playlist YouTube (box modulare 4 copertine / cover HD) */}
      {homeStatus === "success" && youtubePlaylists.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2
              className="text-[19px] font-semibold tracking-[-0.02em]"
              style={{ color: "rgb(var(--md-on-surface-rgb))" }}
            >
              Playlist YouTube
            </h2>
            <span
              className="inline-flex items-center gap-1.5 text-[12px] tabular-nums"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              <ListMusic className="w-3.5 h-3.5" />
              {youtubePlaylists.length} raccolte
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {youtubePlaylists.map((pl) => {
              const isLoadingPl = loadingPlaylistId === pl.id;
              const collageCovers =
                pl.previewCovers && pl.previewCovers.length >= 2
                  ? pl.previewCovers
                  : pl.cover
                    ? [pl.cover]
                    : [];
              return (
                <div
                  key={pl.id}
                  onClick={() => void handlePlayHomePlaylist(pl)}
                  className="group p-3.5 rounded-3xl cursor-pointer transition-all duration-200 hover:brightness-110 space-y-3 at-tonal"
                  style={{
                    backgroundColor:
                      "rgb(var(--md-surface-container-rgb) / 0.72)",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                  }}
                >
                  <div
                    className="relative aspect-square w-full rounded-2xl overflow-hidden shadow-lg shadow-black/35 at-tonal"
                    style={{
                      backgroundColor:
                        "rgb(var(--md-surface-container-high-rgb))",
                      border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                    }}
                  >
                    <PlaylistCollageCover
                      covers={collageCovers}
                      alt={pl.title}
                      className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                    />

                    <div
                      className={`absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent flex items-end justify-end p-3 transition-opacity duration-200 ${
                        isLoadingPl
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePlayHomePlaylist(pl);
                        }}
                        aria-label={`Riproduci ${pl.title}`}
                        className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
                        style={{
                          backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                          color: "rgb(var(--md-on-accent-rgb))",
                        }}
                      >
                        {isLoadingPl ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="min-w-0 px-0.5 space-y-0.5">
                    <h3
                      className="text-[14px] font-semibold truncate"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      {pl.title}
                    </h3>
                    <p
                      className="text-[12px] truncate"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      {pl.trackCount || pl.subtitle || "Playlist YouTube Music"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Altre Sezioni Home ("Dalla community" e successivi) */}
      {homeStatus === "success" &&
        otherSections.map((section) => (
          <section key={section.id} className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2
                className="text-[19px] font-semibold tracking-[-0.02em]"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                {section.title}
              </h2>
              <span
                className="text-[12px] tabular-nums"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {section.tracks.length} brani
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {section.tracks.slice(0, 8).map((track) => {
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <div
                    key={`${section.id}-${track.id}`}
                    onClick={() => playTrack(track, section.tracks)}
                    className="group p-3.5 rounded-3xl cursor-pointer transition-all duration-200 hover:brightness-110 space-y-3 at-tonal"
                    style={
                      isCurrent
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb) / 0.65)",
                            border: "1px solid rgb(var(--md-outline-rgb) / 0.34)",
                          }
                        : {
                            backgroundColor:
                              "rgb(var(--md-surface-container-rgb) / 0.72)",
                            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                          }
                    }
                  >
                    <div
                      className="relative aspect-square w-full rounded-2xl overflow-hidden shadow-lg shadow-black/40 at-tonal"
                      style={{
                        backgroundColor:
                          "rgb(var(--md-surface-container-high-rgb))",
                        border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                      }}
                    >
                      <img
                        src={track.cover}
                        alt={track.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                      />
                      <div
                        className={`absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent flex items-end justify-between p-3 transition-opacity duration-200 ${
                          isCurrent
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addToQueue(track);
                          }}
                          title="Aggiungi alla coda"
                          className="w-8 h-8 rounded-full bg-black/55 backdrop-blur-md text-white hover:bg-black/75 flex items-center justify-center transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform duration-200 group-hover:scale-105"
                          style={{
                            backgroundColor:
                              "rgb(var(--md-accent-primary-rgb))",
                            color: "rgb(var(--md-on-accent-rgb))",
                          }}
                        >
                          {renderTrackStateBadge(isCurrent, "md")}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-2 px-0.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h3
                            className="text-[13.5px] font-semibold truncate transition-colors duration-500"
                            style={{
                              color: isCurrent
                                ? "rgb(var(--md-accent-primary-rgb))"
                                : "rgb(var(--md-on-surface-rgb))",
                            }}
                          >
                            {track.title}
                          </h3>
                          {track.isExplicit && <ExplicitBadge />}
                        </div>
                        <p
                          className="text-[12px] truncate mt-0.5"
                          style={{
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }}
                        >
                          <ArtistLinks
                            artist={track.artist}
                            artistId={track.artistId}
                            artists={track.artists}
                          />
                        </p>
                      </div>

                      <AddToPlaylistMenu
                        track={track}
                        className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
