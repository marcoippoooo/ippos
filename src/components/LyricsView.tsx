import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  LocateFixed,
  Maximize2,
  Mic2,
  Minimize2,
  Music,
  RefreshCw,
} from "lucide-react";
import { useLyrics } from "../hooks/useLyrics";
import { audioEngine } from "../services/audioEngine";
import { findActiveLyricIndex } from "../services/lyricsService";
import { usePlayerStore } from "../store/playerStore";
import { ArtistLinks } from "./ArtistLinks";

type LineVisualState = "active" | "past" | "upcoming";

interface SyncedLyricRowProps {
  index: number;
  text: string;
  time: number;
  visualState: LineVisualState;
  distance: number;
  fontPx: number;
  lineHeight: number;
  blurInactive: boolean;
  clickToSeek: boolean;
  isManualScrolling: boolean;
  isContainerHovered: boolean;
  isCinemaMode: boolean;
  onSeek: (time: number, index: number) => void;
  setRowRef: (index: number, el: HTMLButtonElement | null) => void;
}

const MANUAL_SCROLL_RESUME_MS = 4500;

const SyncedLyricRow = memo(function SyncedLyricRow({
  index,
  text,
  time,
  visualState,
  distance,
  fontPx,
  lineHeight,
  blurInactive,
  clickToSeek,
  isManualScrolling,
  isContainerHovered,
  isCinemaMode,
  onSeek,
  setRowRef,
}: SyncedLyricRowProps) {
  const isActive = visualState === "active";
  const isPast = visualState === "past";
  const absDistance = Math.abs(distance);
  const shouldBlur = blurInactive && !isManualScrolling && !isContainerHovered;

  const blurClass =
    !shouldBlur || absDistance <= 1
      ? "blur-0"
      : absDistance === 2
        ? "blur-[1px]"
        : "blur-[1.5px]";

  const inactiveOpacityClass = isPast
    ? absDistance === 1
      ? "opacity-[0.44]"
      : "opacity-[0.28]"
    : absDistance === 1
      ? "opacity-[0.58]"
      : "opacity-[0.36]";

  const nativeFontPx = isCinemaMode
    ? Math.max(30, fontPx + 6)
    : Math.max(28, fontPx + 4);

  return (
    <button
      ref={(el) => setRowRef(index, el)}
      type="button"
      onClick={() => {
        if (clickToSeek) {
          onSeek(time, index);
        }
      }}
      style={{
        fontSize: `${nativeFontPx}px`,
        lineHeight,
      }}
      className={`group block w-full text-left px-3 -mx-3 py-2.5 rounded-2xl origin-left transition-[transform,opacity,filter,background-color] duration-300 ease-out focus:outline-none tracking-[-0.025em] ${
        clickToSeek ? "cursor-pointer" : "cursor-default"
      } ${
        isActive
          ? "font-bold text-white opacity-100 scale-100 blur-0"
          : `font-bold text-white scale-[0.94] ${inactiveOpacityClass} ${blurClass} hover:opacity-100 hover:scale-[0.97] hover:bg-white/[0.04]`
      }`}
    >
      {text}
    </button>
  );
});

export function LyricsView() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const progress = usePlayerStore((s) => s.progress);
  const lyricsFontPx = usePlayerStore((s) => s.preferences.lyricsFontPx);
  const lyricsLineHeight = usePlayerStore(
    (s) => s.preferences.lyricsLineHeight,
  );
  const lyricsClickToSeek = usePlayerStore(
    (s) => s.preferences.lyricsClickToSeek,
  );
  const lyricsAutoScroll = usePlayerStore(
    (s) => s.preferences.lyricsAutoScroll,
  );
  const lyricsBlurInactive = usePlayerStore(
    (s) => s.preferences.lyricsBlurInactive,
  );
  const lyricsSyncOffsetSec = usePlayerStore(
    (s) => s.preferences.lyricsSyncOffsetSec,
  );
  const isCinemaMode = usePlayerStore((s) => s.isCinemaMode);
  const trackLyricsOffsets = usePlayerStore((s) => s.trackLyricsOffsets);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const resumePlayback = usePlayerStore((s) => s.resumePlayback);
  const toggleCinemaMode = usePlayerStore((s) => s.toggleCinemaMode);
  const adjustTrackLyricsOffset = usePlayerStore(
    (s) => s.adjustTrackLyricsOffset,
  );
  const resetTrackLyricsOffset = usePlayerStore(
    (s) => s.resetTrackLyricsOffset,
  );

  const trackOffsetSec = currentTrack
    ? (trackLyricsOffsets[currentTrack.id] ?? 0)
    : 0;
  const effectiveSyncOffsetSec = lyricsSyncOffsetSec + trackOffsetSec;

  const { status, data, error, retry } = useLyrics();

  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [isLyricsHovered, setIsLyricsHovered] = useState(false);

  // Sincronizzazione immediata su cambio testo/traccia/seek/pausa/offset
  useEffect(() => {
    if (data?.mode !== "synced") {
      setActiveLineIndex(-1);
      return;
    }
    const time =
      playbackStatus === "playing" && audioEngine.hasSource()
        ? audioEngine.getCurrentTime()
        : progress;
    const next = findActiveLyricIndex(
      data.lines,
      time + effectiveSyncOffsetSec,
    );
    setActiveLineIndex((prev) => (prev === next ? prev : next));
  }, [
    data,
    currentTrack?.id,
    playbackStatus,
    progress,
    effectiveSyncOffsetSec,
  ]);

  // Campionamento continuo via requestAnimationFrame su audioEngine.getCurrentTime() per eliminare drift da timeupdate
  useEffect(() => {
    if (data?.mode !== "synced" || playbackStatus !== "playing") {
      return;
    }

    let rafId = 0;
    const tick = () => {
      const time = audioEngine.hasSource()
        ? audioEngine.getCurrentTime()
        : usePlayerStore.getState().progress;
      const next = findActiveLyricIndex(
        data.lines,
        time + effectiveSyncOffsetSec,
      );
      setActiveLineIndex((prev) => (prev === next ? prev : next));
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [data, playbackStatus, effectiveSyncOffsetSec]);

  const [isManualScrolling, setIsManualScrolling] = useState(false);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resumeTimerRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const setRowRef = useCallback(
    (index: number, el: HTMLButtonElement | null) => {
      rowRefs.current[index] = el;
    },
    [],
  );

  const scrollLineToCenter = useCallback((index: number, instant = false) => {
    if (index < 0) return;
    const target = rowRefs.current[index];
    if (!target) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: instant || reduceMotion ? "auto" : "smooth",
      block: "center",
    });
  }, []);

  // Reset scroll al cambio brano
  useEffect(() => {
    clearResumeTimer();
    setIsManualScrolling(false);
    rowRefs.current = [];
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [currentTrack?.id, clearResumeTimer]);

  // Pulizia timer allo smontaggio
  useEffect(() => () => clearResumeTimer(), [clearResumeTimer]);

  // Auto-scroll sulla riga attiva (sospeso durante lo scroll manuale o se disattivato)
  useEffect(() => {
    if (
      !lyricsAutoScroll ||
      data?.mode !== "synced" ||
      activeLineIndex < 0 ||
      isManualScrolling
    ) {
      return;
    }
    scrollLineToCenter(activeLineIndex);
  }, [
    lyricsAutoScroll,
    activeLineIndex,
    data?.mode,
    isManualScrolling,
    scrollLineToCenter,
  ]);

  const handleManualScrollActivity = useCallback(() => {
    if (data?.mode !== "synced") return;
    setIsManualScrolling(true);
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(() => {
      setIsManualScrolling(false);
    }, MANUAL_SCROLL_RESUME_MS);
  }, [data?.mode, clearResumeTimer]);

  const handleResync = useCallback(() => {
    clearResumeTimer();
    setIsManualScrolling(false);
    if (activeLineIndex >= 0) {
      scrollLineToCenter(activeLineIndex);
    }
  }, [activeLineIndex, clearResumeTimer, scrollLineToCenter]);

  const handleSeekToLine = useCallback(
    (time: number, index: number) => {
      setActiveLineIndex(index);
      clearResumeTimer();
      setIsManualScrolling(false);
      seekTo(Math.max(0, time - effectiveSyncOffsetSec));
      if (usePlayerStore.getState().playbackStatus !== "playing") {
        resumePlayback();
      }
      scrollLineToCenter(index);
    },
    [
      clearResumeTimer,
      seekTo,
      effectiveSyncOffsetSec,
      resumePlayback,
      scrollLineToCenter,
    ],
  );

  if (!currentTrack) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 space-y-3">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center">
          <Mic2 className="w-6 h-6 text-zinc-500" />
        </div>
        <h2 className="text-[18px] font-semibold text-zinc-100">
          Nessun brano selezionato
        </h2>
        <p className="text-[13px] text-zinc-400 max-w-sm">
          Avvia un brano dalla Home, da Esplora o dalla ricerca per leggere il testo sincronizzato.
        </p>
      </div>
    );
  }

  const formattedOffset =
    trackOffsetSec > 0
      ? `+${trackOffsetSec.toFixed(1)}s`
      : `${trackOffsetSec.toFixed(1)}s`;

  return (
    <div
      className={`relative h-full min-h-0 mx-auto grid grid-cols-1 overflow-visible transition-[max-width,gap] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isCinemaMode
          ? "max-w-7xl md:grid-cols-[300px_1fr] lg:grid-cols-[360px_1fr] gap-10 lg:gap-16"
          : "max-w-6xl md:grid-cols-[260px_1fr] lg:grid-cols-[300px_1fr] gap-8 lg:gap-14"
      }`}
    >
      {/* Pulsante discreto Modalità Cinema */}
      <button
        type="button"
        onClick={toggleCinemaMode}
        title={isCinemaMode ? "Esci dalla modalità Cinema (Esc)" : "Modalità Cinema"}
        aria-label={
          isCinemaMode ? "Esci dalla modalità Cinema" : "Attiva modalità Cinema"
        }
        className={`absolute z-30 p-2.5 rounded-full backdrop-blur-xl border border-white/[0.10] bg-white/[0.06] hover:bg-white/[0.14] text-white/75 hover:text-white hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer ${
          isCinemaMode ? "top-3 right-4" : "top-3 right-3"
        }`}
      >
        {isCinemaMode ? (
          <Minimize2 className="w-4 h-4" />
        ) : (
          <Maximize2 className="w-4 h-4" />
        )}
      </button>

      {/* Riflesso ambientale discreto dello sfondo dinamico nella vista testi */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 right-8 w-[420px] h-[420px] rounded-full blur-3xl opacity-50 transition-colors duration-700"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--theme-accent-rgb) / 0.14), transparent 70%)",
        }}
      />

      {/* Colonna sinistra: Copertina, metadati e stato sincronizzazione */}
      <div
        className={`flex flex-col justify-center py-4 space-y-5 shrink-0 overflow-visible ${
          isCinemaMode ? "pt-8" : ""
        }`}
      >
        <div
          className={`relative w-full overflow-visible transition-[max-width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isCinemaMode ? "max-w-[330px]" : "max-w-[280px]"
          }`}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-10"
            style={{
              maskImage:
                "radial-gradient(closest-side, black 34%, transparent 100%)",
              WebkitMaskImage:
                "radial-gradient(closest-side, black 34%, transparent 100%)",
            }}
          >
            <div
              className="absolute inset-4 rounded-full blur-2xl opacity-65 transition-colors duration-700"
              style={{
                backgroundColor: "rgb(var(--theme-primary-rgb) / 0.48)",
              }}
            />
            <img
              src={currentTrack.cover}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute inset-5 w-[calc(100%-2.5rem)] h-[calc(100%-2.5rem)] rounded-[30px] object-cover blur-2xl opacity-50 saturate-150 transition-all duration-700"
            />
          </div>
          <img
            src={currentTrack.cover}
            alt={currentTrack.title}
            referrerPolicy="no-referrer"
            className="relative w-full aspect-square rounded-[26px] object-cover ring-1 ring-white/[0.14] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb))",
              boxShadow:
                "0 20px 44px -10px rgb(var(--theme-primary-rgb) / 0.50), 0 10px 24px -6px rgb(var(--theme-accent-rgb) / 0.24), 0 14px 32px rgba(0, 0, 0, 0.50)",
            }}
          />
        </div>

        <div className="space-y-1 min-w-0">
          <h2
            className="text-[20px] font-bold tracking-tight truncate"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            {currentTrack.title}
          </h2>
          <p
            className="text-[13.5px] truncate"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            <ArtistLinks
              artist={currentTrack.artist}
              artistId={currentTrack.artistId}
              artists={currentTrack.artists}
            />
          </p>
          {currentTrack.album && (
            <p
              className="text-[12px] opacity-75 truncate"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {currentTrack.album}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data?.source && status === "success" && (
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-medium at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb) / 0.85)",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              {data.source}
            </span>
          )}

          {status === "success" && data?.mode === "synced" && (
            <div
              className="inline-flex items-center rounded-full border border-white/[0.10] backdrop-blur-xl overflow-hidden text-[11px] font-semibold tabular-nums at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
                color: "rgb(var(--md-on-surface-variant-rgb))",
              }}
            >
              <button
                type="button"
                onClick={() => adjustTrackLyricsOffset(currentTrack.id, -0.5)}
                title="Anticipa testo di 0.5s"
                aria-label="Anticipa sincronizzazione testo di 0.5 secondi"
                className="px-2 py-1 hover:bg-white/[0.09] hover:text-white active:scale-95 transition-colors cursor-pointer"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => resetTrackLyricsOffset(currentTrack.id)}
                title="Ripristina offset a 0.0s"
                aria-label="Ripristina offset sincronizzazione a zero"
                className="px-2 py-1 border-x border-white/[0.08] hover:bg-white/[0.09] hover:text-white transition-colors cursor-pointer"
                style={
                  trackOffsetSec !== 0
                    ? { color: "rgb(var(--md-accent-primary-rgb))" }
                    : undefined
                }
              >
                {formattedOffset}
              </button>
              <button
                type="button"
                onClick={() => adjustTrackLyricsOffset(currentTrack.id, 0.5)}
                title="Ritarda testo di 0.5s"
                aria-label="Ritarda sincronizzazione testo di 0.5 secondi"
                className="px-2 py-1 hover:bg-white/[0.09] hover:text-white active:scale-95 transition-colors cursor-pointer"
              >
                +0.5s
              </button>
            </div>
          )}

          {data?.mode === "synced" && isManualScrolling && (
            <button
              type="button"
              onClick={handleResync}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold transition-transform active:scale-95 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb))",
                color: "rgb(var(--md-on-primary-container-rgb))",
              }}
            >
              <LocateFixed className="w-3 h-3" />
              Riaggancia testo
            </button>
          )}
        </div>
      </div>

      {/* Colonna destra: Testo sincronizzato o fallback */}
      <div
        ref={scrollContainerRef}
        onMouseEnter={() => setIsLyricsHovered(true)}
        onMouseLeave={() => setIsLyricsHovered(false)}
        onWheel={handleManualScrollActivity}
        onTouchMove={handleManualScrollActivity}
        onPointerDown={(e) => {
          const container = scrollContainerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          if (rect.right - e.clientX <= 16) {
            handleManualScrollActivity();
          }
        }}
        className="relative h-full min-h-0 overflow-y-auto pr-4"
        style={
          data?.mode === "synced"
            ? {
                maskImage:
                  "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
              }
            : undefined
        }
      >
        {status === "loading" && (
          <div className="h-full flex flex-col justify-center space-y-5 max-w-xl animate-pulse">
            <p className="text-[13px] font-medium text-zinc-400">
              Recupero testo...
            </p>
            <div className="space-y-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="h-7 rounded-lg bg-white/[0.06]"
                  style={{ width: `${55 + ((i * 19) % 40)}%` }}
                />
              ))}
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="h-full flex flex-col items-start justify-center space-y-3 max-w-md">
            <AlertCircle className="w-6 h-6 text-[#FA2D48]" />
            <p className="text-[16px] font-semibold text-zinc-100">
              Impossibile recuperare il testo
            </p>
            <p className="text-[13px] text-zinc-400">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-white/[0.1] hover:bg-white/[0.16] text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Riprova
            </button>
          </div>
        )}

        {status === "success" && data?.mode === "instrumental" && (
          <div className="h-full flex flex-col items-start justify-center space-y-2.5 max-w-md">
            <Music
              className="w-7 h-7"
              style={{ color: "rgb(var(--theme-accent-rgb))" }}
            />
            <p className="text-[22px] font-bold tracking-tight text-zinc-100">
              Brano strumentale
            </p>
            <p className="text-[13px] text-zinc-400">
              Questo brano non contiene testo cantato.
            </p>
          </div>
        )}

        {status === "success" && data?.mode === "none" && (
          <div className="h-full flex flex-col items-start justify-center space-y-2.5 max-w-md">
            <Mic2 className="w-7 h-7 text-zinc-500" />
            <p className="text-[20px] font-bold tracking-tight text-zinc-100">
              Nessun testo disponibile
            </p>
            <p className="text-[13px] text-zinc-400">
              Non è stato trovato alcun testo né su LRCLIB né su YouTube Music per questo brano.
            </p>
          </div>
        )}

        {status === "success" && data?.mode === "synced" && (
          <div
            className={`py-[32vh] pl-2 pr-6 space-y-3 ${
              isCinemaMode ? "max-w-3xl" : "max-w-2xl"
            }`}
          >
            {data.lines.map((line, index) => {
              const visualState: LineVisualState =
                index === activeLineIndex
                  ? "active"
                  : activeLineIndex >= 0 && index < activeLineIndex
                    ? "past"
                    : "upcoming";
              const distance =
                activeLineIndex >= 0 ? index - activeLineIndex : index;

              return (
                <SyncedLyricRow
                  key={`${index}-${line.time}`}
                  index={index}
                  text={line.text}
                  time={line.time}
                  visualState={visualState}
                  distance={distance}
                  fontPx={lyricsFontPx}
                  lineHeight={lyricsLineHeight}
                  blurInactive={lyricsBlurInactive}
                  clickToSeek={lyricsClickToSeek}
                  isManualScrolling={isManualScrolling}
                  isContainerHovered={isLyricsHovered}
                  isCinemaMode={isCinemaMode}
                  onSeek={handleSeekToLine}
                  setRowRef={setRowRef}
                />
              );
            })}
          </div>
        )}

        {status === "success" && data?.mode === "plain" && (
          <div className="py-10 space-y-2.5 max-w-[58ch] select-text">
            {data.lines.map((line, index) =>
              line.text === "" ? (
                <div key={index} className="h-4" />
              ) : (
                <p
                  key={index}
                  style={{
                    fontSize: `${Math.max(15, lyricsFontPx - 8)}px`,
                    lineHeight: lyricsLineHeight,
                  }}
                  className="font-medium text-zinc-200/90"
                >
                  {line.text}
                </p>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
