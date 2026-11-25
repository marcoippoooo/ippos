import { useState } from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useSleepTimerDisplay } from "../hooks/useSleepTimer";
import { usePlayerStore } from "../store/playerStore";
import { formatRemainingTime, formatTime } from "../utils/formatTime";
import { ArtistLinks } from "./ArtistLinks";
import { ExplicitBadge } from "./ExplicitBadge";
import { ExpressiveSlider } from "./ExpressiveSlider";

export function NowPlayingOverlay() {
  const isNowPlayingOpen = usePlayerStore((s) => s.isNowPlayingOpen);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);

  const closeNowPlaying = usePlayerStore((s) => s.closeNowPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const openSleepTimer = usePlayerStore((s) => s.openSleepTimer);
  const openTrackMenu = usePlayerStore((s) => s.openTrackMenu);
  const setActiveView = usePlayerStore((s) => s.setActiveView);

  const sleepDisplay = useSleepTimerDisplay();
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  if (!isNowPlayingOpen || !currentTrack) {
    return null;
  }

  const totalDuration =
    duration > 0 ? duration : currentTrack.durationSeconds;
  const displayProgress = isScrubbing ? scrubValue : progress;

  const isLiked = likedTracks.some((item) => item.id === currentTrack.id);
  const isLoading = playbackStatus === "loading";
  const isPlayingState = playbackStatus === "playing";

  const commitScrub = (targetSeconds: number) => {
    setIsScrubbing(false);
    seekTo(targetSeconds);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col overflow-hidden select-none at-sheet-up at-tonal"
      style={{
        backgroundColor: "rgb(var(--md-surface-base-rgb))",
        color: "rgb(var(--md-on-surface-rgb))",
      }}
      role="dialog"
      aria-modal="true"
      data-now-playing="true"
      aria-label="Riproduzione corrente espansa"
    >
      {/* Alone tonale diffuso sullo sfondo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(65% 58% at 50% 34%, rgb(var(--theme-primary-rgb) / 0.42) 0%, transparent 72%), radial-gradient(48% 44% at 75% 74%, rgb(var(--theme-secondary-rgb) / 0.28) 0%, transparent 74%)",
        }}
      />

      {/* Top Bar compatibile Titlebar Overlay macOS */}
      <header
        className="relative z-10 pt-9 px-7 pb-2 flex items-center justify-between gap-4 shrink-0"
        data-tauri-drag-region
      >
        <button
          type="button"
          onClick={closeNowPlaying}
          title="Minimizza player (Esc)"
          aria-label="Minimizza Now Playing"
          className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 transition active:scale-95 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.26)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        >
          <ChevronDown className="w-5 h-5" />
        </button>

        <div className="min-w-0 text-center pointer-events-none">
          <p
            className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
          >
            In riproduzione
          </p>
          {currentTrack.album && (
            <p
              className="text-[12px] font-medium truncate max-w-[320px]"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {currentTrack.album}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => openTrackMenu(currentTrack)}
          title="Menu opzioni brano"
          aria-label="Opzioni brano"
          className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 transition active:scale-95 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.26)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </header>

      {/* Stage Centrale */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-8 w-full max-w-[540px] mx-auto gap-5">
        {/* Copertina centrale prominente con alone */}
        <div
          className={`relative aspect-square w-[clamp(220px,36vh,340px)] rounded-3xl overflow-hidden transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isPlayingState ? "scale-100" : "scale-[0.95]"
          }`}
          style={{
            backgroundColor: "rgb(var(--md-surface-container-high-rgb))",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.30)",
            boxShadow:
              "0 28px 65px -16px rgb(var(--theme-primary-rgb) / 0.55), 0 12px 28px rgba(0, 0, 0, 0.45)",
          }}
        >
          <img
            src={currentTrack.cover}
            alt={currentTrack.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Dettagli traccia + Cuore + Menu (...) */}
        <div className="w-full flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <h1
                className="text-[22px] sm:text-[24px] font-bold tracking-[-0.025em] truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                {currentTrack.title}
              </h1>
              {currentTrack.isExplicit && <ExplicitBadge />}
            </div>

            <div className="flex items-center gap-1.5 min-w-0 text-[14px]">
              <ArtistLinks
                artist={currentTrack.artist}
                artistId={currentTrack.artistId}
                artists={currentTrack.artists}
                className="font-medium truncate"
              />
              {currentTrack.album && (
                <span
                  className="truncate"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  · {currentTrack.album}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => toggleLike(currentTrack)}
              aria-label={
                isLiked ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"
              }
              className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 transition active:scale-90 at-tonal"
              style={
                isLiked
                  ? {
                      backgroundColor: "rgb(var(--md-primary-container-rgb))",
                      color: "rgb(var(--md-accent-primary-rgb))",
                    }
                  : {
                      backgroundColor:
                        "rgb(var(--md-surface-container-rgb) / 0.8)",
                      color: "rgb(var(--md-on-surface-variant-rgb))",
                    }
              }
            >
              <Heart
                className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={() => openTrackMenu(currentTrack)}
              aria-label="Altre azioni brano"
              className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.8)",
                color: "rgb(var(--md-on-surface-rgb))",
              }}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Slider di avanzamento grande + tempi (elapsed / -remaining) */}
        <div className="w-full space-y-1.5">
          <ExpressiveSlider
            size="lg"
            min={0}
            max={Math.max(1, totalDuration)}
            step={0.25}
            value={Math.min(displayProgress, Math.max(1, totalDuration))}
            bufferedValue={buffered}
            disabled={totalDuration === 0}
            ariaLabel="Avanzamento brano espanso"
            formatTooltip={formatTime}
            onChangeStart={() => {
              setScrubValue(progress);
              setIsScrubbing(true);
            }}
            onChange={(next) => {
              if (isScrubbing) {
                setScrubValue(next);
              } else {
                seekTo(next);
              }
            }}
            onChangeEnd={(next) => commitScrub(next)}
            className="w-full"
          />

          <div
            className="flex items-center justify-between text-[12px] font-medium tabular-nums"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            <span>{formatTime(displayProgress)}</span>
            <span>
              {totalDuration > 0
                ? formatRemainingTime(displayProgress, totalDuration)
                : "-0:00"}
            </span>
          </div>
        </div>

        {/* Controlli playback ampi */}
        <div className="w-full max-w-[390px] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Riproduzione casuale"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 transition at-tonal"
            style={
              shuffle
                ? {
                    backgroundColor: "rgb(var(--md-primary-container-rgb))",
                    color: "rgb(var(--md-on-primary-container-rgb))",
                  }
                : { color: "rgb(var(--md-on-surface-variant-rgb))" }
            }
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={playPrevious}
            aria-label="Brano precedente"
            className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/[0.08] active:scale-95 transition"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            <SkipBack className="w-6 h-6 fill-current" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlayingState ? "Pausa" : "Riproduci"}
            className={`w-16 h-16 flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-[border-radius,transform,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isPlayingState ? "rounded-[22px]" : "rounded-full"
            }`}
            style={{
              backgroundColor: "rgb(var(--md-accent-primary-rgb))",
              color: "rgb(var(--md-on-accent-rgb))",
            }}
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : isPlayingState ? (
              <Pause className="w-6 h-6 fill-current" />
            ) : (
              <Play className="w-6 h-6 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={playNext}
            aria-label="Brano successivo"
            className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/[0.08] active:scale-95 transition"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            <SkipForward className="w-6 h-6 fill-current" />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Cicla ripetizione"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 transition at-tonal"
            style={
              repeat !== "off"
                ? {
                    backgroundColor: "rgb(var(--md-primary-container-rgb))",
                    color: "rgb(var(--md-on-primary-container-rgb))",
                  }
                : { color: "rgb(var(--md-on-surface-variant-rgb))" }
            }
          >
            {repeat === "one" ? (
              <Repeat1 className="w-4 h-4" />
            ) : (
              <Repeat className="w-4 h-4" />
            )}
          </button>
        </div>
      </main>

      {/* Barra inferiore azioni rapide: Coda, Sleep Timer, Testi */}
      <footer className="relative z-10 pb-6 pt-2 px-8 flex items-center justify-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => {
            setQueueOpen(true);
            closeNowPlaying();
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold hover:brightness-110 transition active:scale-95 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        >
          <ListMusic className="w-4 h-4" />
          <span>Coda</span>
          {queueLength > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              {queueLength}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={openSleepTimer}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold hover:brightness-110 transition active:scale-95 at-tonal"
          style={
            sleepDisplay.isActive
              ? {
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                  border: "1px solid rgb(var(--md-accent-primary-rgb) / 0.45)",
                }
              : {
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.85)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
                  color: "rgb(var(--md-on-surface-rgb))",
                }
          }
        >
          <Moon className="w-4 h-4" />
          <span className="tabular-nums">
            {sleepDisplay.isActive ? sleepDisplay.label : "Sleep Timer"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveView("lyrics");
            closeNowPlaying();
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold hover:brightness-110 transition active:scale-95 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        >
          <Mic2 className="w-4 h-4" />
          <span>Testi</span>
        </button>
      </footer>
    </div>
  );
}
