import {
  AlertCircle,
  Compass,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { formatTime } from "../utils/formatTime";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerBars } from "./EqualizerBars";

interface ExploreViewProps {
  onReload: () => void;
}

export function ExploreView({ onReload }: ExploreViewProps) {
  const exploreSections = usePlayerStore((s) => s.exploreSections);
  const exploreStatus = usePlayerStore((s) => s.exploreStatus);
  const exploreError = usePlayerStore((s) => s.exploreError);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  return (
    <div className="max-w-6xl space-y-8 pb-8">
      <div>
        <h1
          className="text-[28px] font-bold tracking-[-0.03em]"
          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
        >
          Esplora
        </h1>
      </div>

      {(exploreStatus === "idle" || exploreStatus === "loading") && (
        <div className="space-y-6 animate-pulse">
          <div className="h-5 w-40 rounded-full bg-white/[0.08]" />
          <div
            className="divide-y divide-white/[0.05] rounded-2xl overflow-hidden at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.68)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
            }}
          >
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-3.5 px-4 py-3">
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

      {exploreStatus === "error" && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-8 text-center space-y-3">
          <AlertCircle
            className="w-6 h-6 mx-auto"
            style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
          />
          <p className="text-[14px] font-semibold text-zinc-100">
            Impossibile caricare Esplora
          </p>
          <p className="text-[12.5px] text-zinc-400 max-w-md mx-auto">
            {exploreError}
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

      {exploreStatus === "success" && exploreSections.length === 0 && (
        <div
          className="rounded-2xl p-10 text-center space-y-2.5 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.68)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
          }}
        >
          <Compass className="w-6 h-6 text-zinc-500 mx-auto" />
          <p className="text-[14px] font-medium text-zinc-200">
            Nessun contenuto nella sezione Esplora
          </p>
          <p className="text-[12.5px] text-zinc-500">
            Usa la barra di ricerca in alto per cercare brani e video su YouTube Music.
          </p>
        </div>
      )}

      {exploreStatus === "success" &&
        exploreSections.map((section) => (
          <section key={section.id} className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2
                className="text-[18px] font-semibold tracking-[-0.02em]"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                {section.title}
              </h2>
              <span
                className="text-[12px] tabular-nums"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {section.tracks.length} elementi
              </span>
            </div>

            <div
              className="divide-y divide-white/[0.06] rounded-2xl overflow-visible at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.68)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
              }}
            >
              {section.tracks.map((track) => {
                const isCurrent = currentTrack?.id === track.id;
                const isPlayingTrack =
                  isCurrent && playbackStatus === "playing";
                const isLoadingTrack =
                  isCurrent && playbackStatus === "loading";
                return (
                  <div
                    key={`${section.id}-${track.id}`}
                    onClick={() => playTrack(track, section.tracks)}
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
                      <p
                        className="text-[12px] truncate"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        <ArtistLinks
                          artist={track.artist}
                          artistId={track.artistId}
                          artists={track.artists}
                        />
                        {track.album ? ` — ${track.album}` : ""}
                      </p>
                    </div>

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

                    {(track.duration || track.durationSeconds > 0) && (
                      <span
                        className="text-[12px] tabular-nums w-12 text-right"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        {track.duration || formatTime(track.durationSeconds)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
