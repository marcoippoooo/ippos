import {
  AlertCircle,
  Heart,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { SearchFilter } from "../types/music";
import { formatTime } from "../utils/formatTime";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerBars } from "./EqualizerBars";

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: "song", label: "Brani" },
  { id: "video", label: "Video" },
  { id: "all", label: "Tutti" },
];

export function SearchResultsView() {
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const searchFilter = usePlayerStore((s) => s.searchFilter);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const searchArtists = usePlayerStore((s) => s.searchArtists);
  const searchStatus = usePlayerStore((s) => s.searchStatus);
  const searchError = usePlayerStore((s) => s.searchError);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const likedTracks = usePlayerStore((s) => s.likedTracks);

  const setSearchFilter = usePlayerStore((s) => s.setSearchFilter);
  const triggerSearchNow = usePlayerStore((s) => s.triggerSearchNow);
  const clearSearch = usePlayerStore((s) => s.clearSearch);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const openArtist = usePlayerStore((s) => s.openArtist);

  const likedIds = new Set(likedTracks.map((t) => t.id));
  const totalCount = searchResults.length + searchArtists.length;

  if (!searchQuery.trim()) {
    return (
      <div className="max-w-5xl py-12">
        <div
          className="rounded-3xl p-10 text-center space-y-3 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
          }}
        >
          <Search className="w-7 h-7 mx-auto text-accent" />
          <h2
            className="text-[17px] font-semibold"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            Cerca brani, album o artisti su YouTube Music
          </h2>
          <p
            className="text-[12.5px]"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            Inizia a digitare nella barra in alto · Premi{" "}
            <kbd
              className="px-1.5 py-0.5 rounded text-[11px] font-semibold"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-high-rgb))",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
              }}
            >
              Esc
            </kbd>{" "}
            per chiudere
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6 pb-8">
      {/* Intestazione e filtri */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1
            className="text-[26px] font-bold tracking-[-0.03em] truncate"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            Risultati per “{searchQuery.trim()}”
          </h1>
          <p
            className="text-[12.5px] mt-1"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            {searchStatus === "loading"
              ? "Ricerca in corso su YouTube Music..."
              : searchStatus === "success"
                ? `${totalCount} risultati trovati`
                : "Catalogo YouTube Music"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className="inline-flex p-1 rounded-full at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.9)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
            }}
          >
            {FILTERS.map((f) => {
              const active = searchFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSearchFilter(f.id)}
                  className="px-3.5 py-1 rounded-full text-[12px] font-medium transition-all duration-200"
                  style={
                    active
                      ? {
                          backgroundColor: "rgb(var(--md-primary-container-rgb))",
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }
                      : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                  }
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={clearSearch}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium hover:brightness-110 transition at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              color: "rgb(var(--md-on-surface-rgb))",
            }}
          >
            Chiudi
          </button>
        </div>
      </div>

      {/* Stato caricamento: skeleton */}
      {searchStatus === "loading" && (
        <div
          className="divide-y divide-white/[0.06] rounded-2xl overflow-hidden at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.68)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
          }}
        >
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3.5 px-4 py-3 animate-pulse"
            >
              <div className="w-11 h-11 rounded-xl bg-white/[0.08] shrink-0" />
              <div className="flex-1 space-y-2 min-w-0">
                <div className="h-3.5 w-48 max-w-[60%] rounded-full bg-white/[0.08]" />
                <div className="h-3 w-32 max-w-[40%] rounded-full bg-white/[0.05]" />
              </div>
              <div className="h-3 w-10 rounded-full bg-white/[0.05] shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Stato errore */}
      {searchStatus === "error" && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-8 text-center space-y-3">
          <AlertCircle
            className="w-6 h-6 mx-auto"
            style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
          />
          <p className="text-[14px] font-semibold text-zinc-100">
            Errore di ricerca
          </p>
          <p className="text-[12.5px] text-zinc-400 max-w-md mx-auto">
            {searchError}
          </p>
          <button
            type="button"
            onClick={triggerSearchNow}
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
      {searchStatus === "success" &&
        searchResults.length === 0 &&
        searchArtists.length === 0 && (
        <div
          className="rounded-2xl p-10 text-center space-y-2.5 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.7)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
          }}
        >
          <Search className="w-6 h-6 text-zinc-500 mx-auto" />
          <p className="text-[14px] font-medium text-zinc-200">
            Nessun risultato trovato
          </p>
          <p className="text-[12.5px] text-zinc-500">
            Prova con parole chiave diverse o cambia il filtro tra Brani, Video e Tutti.
          </p>
        </div>
      )}

      {/* Sezione dedicata Artisti */}
      {searchStatus === "success" && searchArtists.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2
              className="text-[17px] font-semibold tracking-[-0.02em]"
              style={{ color: "rgb(var(--md-on-surface-rgb))" }}
            >
              Artisti
            </h2>
            <span
              className="text-[12px] tabular-nums"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {searchArtists.length}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {searchArtists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                onClick={() =>
                  openArtist({ id: artist.id, name: artist.name })
                }
                className="group p-3.5 rounded-2xl flex items-center gap-3.5 text-left hover:brightness-110 transition-all cursor-pointer at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.78)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
                }}
              >
                <div className="w-14 h-14 rounded-full overflow-hidden ring-1 ring-white/15 bg-[#18181D] shrink-0 flex items-center justify-center">
                  {artist.thumbnail && !artist.thumbnail.startsWith("data:") ? (
                    <img
                      src={artist.thumbnail}
                      alt={artist.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <UserRound className="w-5 h-5 text-zinc-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[14px] font-semibold truncate group-hover:underline group-hover:text-accent"
                    style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                  >
                    {artist.name}
                  </p>
                  <p
                    className="text-[12px] truncate mt-0.5"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {artist.subtitle || "Artista"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Lista risultati tracce */}
      {searchStatus === "success" && searchResults.length > 0 && (
        <div
          className="divide-y divide-white/[0.06] rounded-2xl overflow-visible at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.7)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
          }}
        >
          {searchResults.map((track) => {
            const isCurrent = currentTrack?.id === track.id;
            const isPlayingTrack = isCurrent && playbackStatus === "playing";
            const isLoadingTrack = isCurrent && playbackStatus === "loading";
            const isLiked = likedIds.has(track.id);
            return (
              <div
                key={track.id}
                onClick={() => playTrack(track, searchResults)}
                className={`flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-colors group first:rounded-t-2xl last:rounded-b-2xl ${
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
                <div className="relative w-11 h-11 rounded-xl overflow-hidden ring-1 ring-white/10 shrink-0 bg-[#18181D]">
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
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : isPlayingTrack ? (
                      <EqualizerBars playing />
                    ) : isCurrent ? (
                      <Pause className="w-4 h-4 text-white fill-current" />
                    ) : (
                      <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                    )}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
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
                    {track.itemType === "video" && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-secondary-container-rgb))",
                          color: "rgb(var(--md-on-secondary-container-rgb))",
                        }}
                      >
                        Video
                      </span>
                    )}
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

                <div className="flex items-center gap-1 shrink-0">
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

                <span
                  className="text-[12px] tabular-nums w-12 text-right shrink-0"
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
      )}
    </div>
  );
}
