import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  LocateFixed,
  Mic2,
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
  fontPx: number;
  lineHeight: number;
  blurInactive: boolean;
  clickToSeek: boolean;
  isManualScrolling: boolean;
  onSeek: (time: number) => void;
  setRowRef: (index: number, el: HTMLButtonElement | null) => void;
}

const MANUAL_SCROLL_RESUME_MS = 4500;

const SyncedLyricRow = memo(function SyncedLyricRow({
  index,
  text,
  time,
  visualState,
  fontPx,
  lineHeight,
  blurInactive,
  clickToSeek,
  isManualScrolling,
  onSeek,
  setRowRef,
}: SyncedLyricRowProps) {
  const isActive = visualState === "active";
  const isPast = visualState === "past";
  const shouldBlur = blurInactive && !isManualScrolling;

  return (
    <button
      ref={(el) => setRowRef(index, el)}
      type="button"
      onClick={() => {
        if (clickToSeek) {
          onSeek(time);
        }
      }}
      style={{
        fontSize: `${isActive ? fontPx : Math.max(16, fontPx - 3)}px`,
        lineHeight,
      }}
      className={`group block w-full text-left py-2 transition-all duration-300 ease-out origin-left focus:outline-none tracking-[-0.02em] ${
        clickToSeek ? "cursor-pointer" : "cursor-default"
      } ${
        isActive
          ? "font-bold text-white opacity-100 scale-[1.01]"
          : isPast
            ? `font-semibold text-white/35 ${
                clickToSeek ? "hover:text-white/85" : ""
              } ${shouldBlur ? "blur-[0.6px] hover:blur-none" : ""}`
            : `font-semibold text-white/45 ${
                clickToSeek ? "hover:text-white/90" : ""
              } ${shouldBlur ? "blur-[0.45px] hover:blur-none" : ""}`
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
  const seekTo = usePlayerStore((s) => s.seekTo);
  const resumePlayback = usePlayerStore((s) => s.resumePlayback);

  const { status, data, error, retry } = useLyrics();

  const [activeLineIndex, setActiveLineIndex] = useState(-1);

  // Sincronizzazione immediata su cambio testo/traccia/seek/pausa
  useEffect(() => {
    if (data?.mode !== "synced") {
      setActiveLineIndex(-1);
      return;
    }
    const time =
      playbackStatus === "playing" && audioEngine.hasSource()
        ? audioEngine.getCurrentTime()
        : progress;
    const next = findActiveLyricIndex(data.lines, time + lyricsSyncOffsetSec);
    setActiveLineIndex((prev) => (prev === next ? prev : next));
  }, [data, currentTrack?.id, playbackStatus, progress, lyricsSyncOffsetSec]);

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
        time + lyricsSyncOffsetSec,
      );
      setActiveLineIndex((prev) => (prev === next ? prev : next));
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [data, playbackStatus, lyricsSyncOffsetSec]);

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
    (time: number) => {
      clearResumeTimer();
      setIsManualScrolling(false);
      seekTo(time);
      if (usePlayerStore.getState().playbackStatus !== "playing") {
        resumePlayback();
      }
    },
    [clearResumeTimer, seekTo, resumePlayback],
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

  return (
    <div className="relative h-full max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[300px_1fr] gap-8 lg:gap-14 overflow-hidden">
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
      <div className="flex flex-col justify-center py-4 space-y-5 shrink-0">
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-3 rounded-3xl blur-2xl transition-colors duration-700"
            style={{
              backgroundColor: "rgb(var(--theme-primary-rgb) / 0.34)",
            }}
          />
          <img
            src={currentTrack.cover}
            alt={currentTrack.title}
            referrerPolicy="no-referrer"
            className="relative w-full max-w-[280px] aspect-square rounded-[26px] object-cover ring-1 ring-white/10 shadow-2xl shadow-black/60 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb))",
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
        onWheel={handleManualScrollActivity}
        onTouchMove={handleManualScrollActivity}
        className="relative h-full overflow-y-auto pr-4"
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
              Non è stato trovato alcun testo né su YouTube Music né su LRCLIB per questo brano.
            </p>
          </div>
        )}

        {status === "success" && data?.mode === "synced" && (
          <div className="py-[32vh] space-y-3 max-w-2xl">
            {data.lines.map((line, index) => {
              const visualState: LineVisualState =
                index === activeLineIndex
                  ? "active"
                  : activeLineIndex >= 0 && index < activeLineIndex
                    ? "past"
                    : "upcoming";

              return (
                <SyncedLyricRow
                  key={`${index}-${line.time}`}
                  index={index}
                  text={line.text}
                  time={line.time}
                  visualState={visualState}
                  fontPx={lyricsFontPx}
                  lineHeight={lyricsLineHeight}
                  blurInactive={lyricsBlurInactive}
                  clickToSeek={lyricsClickToSeek}
                  isManualScrolling={isManualScrolling}
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
