import { useState } from "react";
import {
  AlertCircle,
  ChevronUp,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useSleepTimerDisplay } from "../hooks/useSleepTimer";
import { usePlayerStore } from "../store/playerStore";
import { formatTime } from "../utils/formatTime";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { ArtistLinks } from "./ArtistLinks";
import { ExplicitBadge } from "./ExplicitBadge";
import { ExpressiveSlider } from "./ExpressiveSlider";
import { ScallopedArtwork } from "./ScallopedArtwork";

export function PlayerBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const playbackError = usePlayerStore((s) => s.playbackError);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const activeView = usePlayerStore((s) => s.activeView);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const retryPlayback = usePlayerStore((s) => s.retryPlayback);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleLyricsView = usePlayerStore((s) => s.toggleLyricsView);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const openNowPlaying = usePlayerStore((s) => s.openNowPlaying);
  const openSleepTimer = usePlayerStore((s) => s.openSleepTimer);
  const openTrackMenu = usePlayerStore((s) => s.openTrackMenu);

  const sleepDisplay = useSleepTimerDisplay();
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const totalDuration =
    duration > 0 ? duration : (currentTrack?.durationSeconds ?? 0);
  const displayProgress = isScrubbing ? scrubValue : progress;

  const effectiveVolume = isMuted ? 0 : volume;
  const isLiked = currentTrack
    ? likedTracks.some((item) => item.id === currentTrack.id)
    : false;
  const isLoading = playbackStatus === "loading";
  const isPlayingState = playbackStatus === "playing";
  const isError = playbackStatus === "error";

  const commitScrub = (targetSeconds: number) => {
    setIsScrubbing(false);
    seekTo(targetSeconds);
  };

  return (
    <footer
      className="h-[90px] shrink-0 w-full backdrop-blur-3xl px-5 grid grid-cols-[minmax(200px,1fr)_minmax(300px,540px)_minmax(190px,1fr)] items-center gap-5 select-none at-tonal"
      style={{
        backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.86)",
        borderTop: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
      }}
    >
      {/* Sinistra: Copertina organica scalloped, titolo, artista ed eventuale errore */}
      <div className="flex items-center gap-3.5 min-w-0">
        {currentTrack ? (
          <>
            <button
              type="button"
              onClick={openNowPlaying}
              title="Apri Now Playing espanso"
              aria-label="Apri Now Playing espanso"
              className="group/art relative rounded-2xl focus:outline-none shrink-0"
            >
              <ScallopedArtwork
                src={currentTrack.cover}
                alt={currentTrack.title}
                size={56}
                variant="cookie10"
                active={isPlayingState}
                overlay={
                  isLoading ? (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-black/45 opacity-0 group-hover/art:opacity-100 flex items-center justify-center transition-opacity">
                      <ChevronUp className="w-4 h-4 text-white" />
                    </div>
                  )
                }
                fallback={<Music2 className="w-5 h-5 text-zinc-400" />}
              />
            </button>

            <div
              onClick={openNowPlaying}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openNowPlaying();
                }
              }}
              title="Apri Now Playing espanso"
              className="min-w-0 flex-1 cursor-pointer group/meta"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[13.5px] font-semibold truncate group-hover/meta:underline"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {currentTrack.title}
                </span>
                {currentTrack.isExplicit && <ExplicitBadge />}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(currentTrack);
                  }}
                  aria-label={
                    isLiked ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"
                  }
                  className="p-1 rounded-full text-zinc-400 hover:text-zinc-100 transition-colors duration-300 shrink-0"
                  style={
                    isLiked
                      ? { color: "rgb(var(--md-accent-primary-rgb))" }
                      : undefined
                  }
                >
                  <Heart
                    className={`w-3.5 h-3.5 transition-transform duration-150 active:scale-90 ${
                      isLiked ? "fill-current" : ""
                    }`}
                  />
                </button>
                <AddToPlaylistMenu
                  track={currentTrack}
                  align="left"
                  openUpward
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openTrackMenu(currentTrack);
                  }}
                  title="Altre azioni traccia"
                  aria-label="Opzioni traccia"
                  className="p-1 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] transition-colors shrink-0"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>
              {isError ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 mt-0.5 text-[11.5px] text-rose-400 min-w-0"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {playbackError || "Errore stream"}
                  </span>
                  <button
                    type="button"
                    onClick={retryPlayback}
                    className="text-zinc-200 hover:text-white underline shrink-0"
                  >
                    Riprova
                  </button>
                </div>
              ) : (
                <p
                  className="text-[12px] truncate mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  <ArtistLinks
                    artist={currentTrack.artist}
                    artistId={currentTrack.artistId}
                    artists={currentTrack.artists}
                  />
                  {currentTrack.album ? ` — ${currentTrack.album}` : ""}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3.5 min-w-0">
            <ScallopedArtwork
              alt="Nessun brano selezionato"
              size={56}
              variant="cookie10"
              fallback={
                <Music2
                  className="w-5 h-5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb) / 0.55)" }}
                />
              }
            />
            <div className="min-w-0">
              <p
                className="text-[12.5px] font-medium truncate"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Nessun brano selezionato
              </p>
              <p className="text-[11.5px] text-zinc-500 truncate">
                Cerca o scegli un brano per ascoltare
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Centro: Controlli espressivi con pulsante Play morphing e ExpressiveSlider */}
      <div className="flex flex-col items-center gap-1 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleShuffle}
            title="Riproduzione casuale"
            className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors duration-300"
            style={
              shuffle
                ? {
                    backgroundColor: "rgb(var(--md-primary-container-rgb))",
                    color: "rgb(var(--md-on-primary-container-rgb))",
                  }
                : undefined
            }
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={playPrevious}
            disabled={!currentTrack}
            title="Brano precedente (⌘←)"
            className="p-1.5 rounded-full text-zinc-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none active:scale-95 transition"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={!currentTrack}
            title={
              isLoading
                ? "Caricamento stream..."
                : isPlayingState
                  ? "Pausa (Spazio)"
                  : "Riproduci (Spazio)"
            }
            className={`w-10 h-10 flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-[border-radius,transform,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-md ${
              isPlayingState ? "rounded-[14px]" : "rounded-full"
            }`}
            style={{
              backgroundColor: "rgb(var(--md-accent-primary-rgb))",
              color: "rgb(var(--md-on-accent-rgb))",
            }}
          >
            <span
              key={playbackStatus}
              className="at-icon-pop flex items-center justify-center"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlayingState ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={playNext}
            disabled={!currentTrack}
            title="Brano successivo (⌘→)"
            className="p-1.5 rounded-full text-zinc-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none active:scale-95 transition"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            title={
              repeat === "off"
                ? "Ripeti: disattivo"
                : repeat === "all"
                  ? "Ripeti coda"
                  : "Ripeti brano corrente"
            }
            className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors duration-300"
            style={
              repeat !== "off"
                ? {
                    backgroundColor: "rgb(var(--md-primary-container-rgb))",
                    color: "rgb(var(--md-on-primary-container-rgb))",
                  }
                : undefined
            }
          >
            {repeat === "one" ? (
              <Repeat1 className="w-3.5 h-3.5" />
            ) : (
              <Repeat className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Scrubber tattile Expressive */}
        <div
          className="w-full flex items-center gap-3 text-[11px] tabular-nums"
          style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
        >
          <span className="w-9 text-right">{formatTime(displayProgress)}</span>
          <ExpressiveSlider
            size="md"
            min={0}
            max={Math.max(1, totalDuration)}
            step={0.25}
            value={Math.min(displayProgress, Math.max(1, totalDuration))}
            bufferedValue={buffered}
            disabled={totalDuration === 0}
            ariaLabel="Avanzamento riproduzione"
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
            className="flex-1"
          />
          <span className="w-9">
            {totalDuration > 0
              ? formatTime(totalDuration)
              : currentTrack?.duration || "0:00"}
          </span>
        </div>
      </div>

      {/* Destra: Sleep Timer, Testi, Coda e Volume */}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={openSleepTimer}
          title={
            sleepDisplay.isActive
              ? `Sleep Timer attivo (${sleepDisplay.label})`
              : "Temporizzatore di sonno"
          }
          aria-label="Temporizzatore di sonno"
          className={`flex items-center gap-1.5 rounded-full transition-colors duration-300 ${
            sleepDisplay.isActive
              ? "px-2.5 py-1 text-[11px] font-semibold tabular-nums"
              : "p-2 hover:bg-white/[0.06]"
          }`}
          style={
            sleepDisplay.isActive
              ? {
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }
              : { color: "rgb(var(--md-on-surface-variant-rgb))" }
          }
        >
          <Moon className="w-4 h-4 shrink-0" />
          {sleepDisplay.isActive && <span>{sleepDisplay.label}</span>}
        </button>

        <button
          type="button"
          onClick={toggleLyricsView}
          title="Mostra testo (⌘L)"
          className="p-2 rounded-full transition-colors duration-300 hover:bg-white/[0.06]"
          style={
            activeView === "lyrics"
              ? {
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }
              : { color: "rgb(var(--md-on-surface-variant-rgb))" }
          }
        >
          <Mic2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={toggleQueue}
          title="Coda di riproduzione"
          className="relative p-2 rounded-full transition-colors duration-300 hover:bg-white/[0.06]"
          style={
            isQueueOpen
              ? {
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }
              : { color: "rgb(var(--md-on-surface-variant-rgb))" }
          }
        >
          <ListMusic className="w-4 h-4" />
          {queueLength > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9.5px] font-bold flex items-center justify-center tabular-nums"
              style={{
                backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                color: "rgb(var(--md-on-accent-rgb))",
              }}
            >
              {queueLength}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 pl-1.5">
          <button
            type="button"
            onClick={toggleMute}
            title={
              isMuted
                ? "Riattiva audio (M) · Volume ⌘↑/↓"
                : "Silenzia (M) · Volume ⌘↑/↓"
            }
            aria-label={isMuted ? "Riattiva audio" : "Silenzia"}
            className="p-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            {effectiveVolume === 0 ? (
              <VolumeX className="w-4 h-4 opacity-60" />
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
            ariaLabel="Volume"
            formatTooltip={(v) => `${Math.round(v * 100)}%`}
            onChange={(next) => setVolume(next)}
            className="w-24"
          />
        </div>
      </div>
    </footer>
  );
}
