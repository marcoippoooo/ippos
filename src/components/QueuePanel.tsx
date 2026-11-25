import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  GripVertical,
  Infinity as InfinityIcon,
  Loader2,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerBars } from "./EqualizerBars";
import { ExplicitBadge } from "./ExplicitBadge";
import { M3ExpressiveSwitch } from "./SettingsPrimitives";

interface DragState {
  fromIndex: number;
  overIndex: number;
  stepHeight: number;
}

interface DragMeta {
  pointerId: number;
  startClientY: number;
  startScrollTop: number;
  lastClientY: number;
  stepHeight: number;
  centers: number[];
  fromIndex: number;
  overIndex: number;
  rafId: number | null;
  autoScrollRafId: number | null;
}

export function QueuePanel() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);
  const queue = usePlayerStore((s) => s.queue);
  const autoplayEnabled = usePlayerStore((s) => s.autoplayEnabled);
  const autoplayLoading = usePlayerStore((s) => s.autoplayLoading);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const playFromQueue = usePlayerStore((s) => s.playFromQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setAutoplayEnabled = usePlayerStore((s) => s.setAutoplayEnabled);

  const [dragState, setDragState] = useState<DragState | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const dragMetaRef = useRef<DragMeta | null>(null);
  const queueLenRef = useRef(queue.length);
  queueLenRef.current = queue.length;

  const stopLoops = useCallback(() => {
    const meta = dragMetaRef.current;
    if (!meta) return;
    if (meta.rafId !== null) {
      window.cancelAnimationFrame(meta.rafId);
      meta.rafId = null;
    }
    if (meta.autoScrollRafId !== null) {
      window.cancelAnimationFrame(meta.autoScrollRafId);
      meta.autoScrollRafId = null;
    }
  }, []);

  const resetRowTransform = useCallback((index: number | null) => {
    if (index === null) return;
    const el = rowRefs.current.get(index);
    if (el) {
      el.style.transform = "";
      el.style.zIndex = "";
    }
  }, []);

  const cancelActiveDrag = useCallback(() => {
    const meta = dragMetaRef.current;
    if (meta) {
      stopLoops();
      resetRowTransform(meta.fromIndex);
      dragMetaRef.current = null;
    }
    setDragState(null);
  }, [resetRowTransform, stopLoops]);

  useEffect(() => {
    if (dragMetaRef.current) {
      cancelActiveDrag();
    }
  }, [queue.length, cancelActiveDrag]);

  useEffect(() => {
    return () => {
      cancelActiveDrag();
    };
  }, [cancelActiveDrag]);

  const computeAndApplyDragFrame = useCallback(() => {
    const meta = dragMetaRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!meta || !scrollEl) return;

    const rowEl = rowRefs.current.get(meta.fromIndex);
    const scrollDelta = scrollEl.scrollTop - meta.startScrollTop;
    const deltaY = meta.lastClientY - meta.startClientY + scrollDelta;

    if (rowEl) {
      rowEl.style.transform = `translate3d(0, ${deltaY}px, 0) scale(1.015)`;
      rowEl.style.zIndex = "30";
    }

    const draggedCenter = (meta.centers[meta.fromIndex] ?? 0) + deltaY;
    let nextOver = meta.fromIndex;
    if (deltaY >= 0) {
      for (let i = meta.fromIndex + 1; i < meta.centers.length; i++) {
        if (draggedCenter >= meta.centers[i]) {
          nextOver = i;
        }
      }
    } else {
      for (let i = meta.fromIndex - 1; i >= 0; i--) {
        if (draggedCenter <= meta.centers[i]) {
          nextOver = i;
        }
      }
    }

    if (nextOver !== meta.overIndex) {
      meta.overIndex = nextOver;
      setDragState((prev) =>
        prev ? { ...prev, overIndex: nextOver } : prev,
      );
    }
  }, []);

  const runAutoScrollStep = useCallback(() => {
    const meta = dragMetaRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!meta || !scrollEl) return;

    const rect = scrollEl.getBoundingClientRect();
    const edge = 36;
    let scrollBy = 0;

    if (meta.lastClientY < rect.top + edge) {
      const ratio = (rect.top + edge - meta.lastClientY) / edge;
      scrollBy = -Math.max(2, Math.round(ratio * 8));
    } else if (meta.lastClientY > rect.bottom - edge) {
      const ratio = (meta.lastClientY - (rect.bottom - edge)) / edge;
      scrollBy = Math.max(2, Math.round(ratio * 8));
    }

    if (scrollBy !== 0) {
      scrollEl.scrollTop += scrollBy;
      computeAndApplyDragFrame();
      meta.autoScrollRafId = window.requestAnimationFrame(runAutoScrollStep);
    } else {
      meta.autoScrollRafId = null;
    }
  }, [computeAndApplyDragFrame]);

  const handleDragHandlePointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (e.button !== 0 || queue.length < 2) return;
    e.stopPropagation();
    e.preventDefault();

    const scrollEl = scrollContainerRef.current;
    const currentRow = rowRefs.current.get(idx);
    if (!scrollEl || !currentRow) return;

    const centers: number[] = [];
    for (let i = 0; i < queue.length; i++) {
      const el = rowRefs.current.get(i);
      if (el) {
        centers.push(el.offsetTop + el.offsetHeight / 2);
      } else {
        centers.push(i * 58);
      }
    }

    const rowHeight = currentRow.getBoundingClientRect().height || 56;
    const nextEl = rowRefs.current.get(idx + 1);
    const prevEl = rowRefs.current.get(idx - 1);
    const stepHeight = nextEl
      ? Math.max(rowHeight, nextEl.offsetTop - currentRow.offsetTop)
      : prevEl
        ? Math.max(rowHeight, currentRow.offsetTop - prevEl.offsetTop)
        : rowHeight + 4;

    e.currentTarget.setPointerCapture(e.pointerId);

    dragMetaRef.current = {
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startScrollTop: scrollEl.scrollTop,
      lastClientY: e.clientY,
      stepHeight,
      centers,
      fromIndex: idx,
      overIndex: idx,
      rafId: null,
      autoScrollRafId: null,
    };

    setDragState({
      fromIndex: idx,
      overIndex: idx,
      stepHeight,
    });
  };

  const handleDragHandlePointerMove = (
    e: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const meta = dragMetaRef.current;
    if (!meta || meta.pointerId !== e.pointerId) return;

    meta.lastClientY = e.clientY;
    if (meta.rafId === null) {
      meta.rafId = window.requestAnimationFrame(() => {
        if (!dragMetaRef.current) return;
        dragMetaRef.current.rafId = null;
        computeAndApplyDragFrame();
      });
    }

    const scrollEl = scrollContainerRef.current;
    if (scrollEl && meta.autoScrollRafId === null) {
      const rect = scrollEl.getBoundingClientRect();
      if (e.clientY < rect.top + 36 || e.clientY > rect.bottom - 36) {
        meta.autoScrollRafId = window.requestAnimationFrame(runAutoScrollStep);
      }
    }
  };

  const handleDragHandlePointerEnd = (
    e: ReactPointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) => {
    const meta = dragMetaRef.current;
    if (!meta || meta.pointerId !== e.pointerId) return;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const { fromIndex, overIndex } = meta;
    cancelActiveDrag();

    if (commit && fromIndex !== overIndex) {
      reorderQueue(fromIndex, overIndex);
    }
  };

  const handleDragHandleKeyDown = (
    e: ReactKeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      e.stopPropagation();
      reorderQueue(idx, idx - 1);
    } else if (e.key === "ArrowDown" && idx < queue.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      reorderQueue(idx, idx + 1);
    }
  };

  return (
    <aside
      className="at-panel-in w-[328px] shrink-0 h-full backdrop-blur-2xl border-l border-white/[0.08] shadow-[-12px_0_40px_rgba(0,0,0,0.42)] flex flex-col select-none at-tonal"
      style={{
        backgroundColor: "rgb(var(--md-surface-container-low-rgb) / 0.60)",
        backgroundImage:
          "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.01) 30%, rgba(0,0,0,0.14) 100%)",
      }}
    >
      <div className="px-4 py-3.5 flex items-center justify-between gap-2 shrink-0 border-b border-white/[0.08]">
        <div className="min-w-0 flex items-center gap-2">
          <h2
            className="text-[13.5px] font-semibold truncate"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            Coda di riproduzione
          </h2>
          {queue.length > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums shrink-0"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb) / 0.85)",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              {queue.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={clearQueue}
              title="Svuota coda residua"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium hover:brightness-110 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.9)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                color: "rgb(var(--md-on-surface-variant-rgb))",
              }}
            >
              <Trash2 className="w-3 h-3" />
              Svuota
            </button>
          )}
          <button
            type="button"
            onClick={toggleQueue}
            aria-label="Chiudi coda"
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3.5 space-y-5 relative"
      >
        {currentTrack && (
          <div className="space-y-2">
            <div
              className="px-1 text-[11px] font-medium"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {playbackStatus === "playing"
                ? "In riproduzione"
                : playbackStatus === "loading"
                  ? "Caricamento"
                  : "In pausa"}
            </div>
            <div
              className="flex items-center gap-3 p-2.5 rounded-2xl border border-white/[0.10] shadow-lg shadow-black/25 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb) / 0.62)",
              }}
            >
              <img
                src={currentTrack.cover}
                alt={currentTrack.title}
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-xl object-cover shrink-0"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-high-rgb))",
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p
                    className="text-[12.5px] font-semibold truncate"
                    style={{ color: "rgb(var(--md-on-primary-container-rgb))" }}
                  >
                    {currentTrack.title}
                  </p>
                  {currentTrack.isExplicit && <ExplicitBadge />}
                </div>
                <p
                  className="text-[11.5px] truncate opacity-80"
                  style={{ color: "rgb(var(--md-on-primary-container-rgb))" }}
                >
                  <ArtistLinks
                    artist={currentTrack.artist}
                    artistId={currentTrack.artistId}
                    artists={currentTrack.artists}
                    inheritColor
                  />
                </p>
              </div>
              <EqualizerBars
                playing={playbackStatus === "playing"}
                className="h-3 shrink-0 pr-1"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div
            className="px-1 flex items-center justify-between text-[11px] font-medium"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            <span>Prossimi in coda</span>
            {queue.length > 1 && (
              <span className="text-[10.5px] opacity-75">
                Trascina per riordinare
              </span>
            )}
          </div>

          {queue.length === 0 ? (
            <p
              className="px-1 py-4 text-[12px]"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {autoplayEnabled
                ? "La coda è vuota. Con Autoplay attivo, al termine del brano partirà la radio infinita."
                : "La coda è vuota. Passa il mouse su un brano e premi + per accodarlo."}
            </p>
          ) : (
            <div className="space-y-1 relative">
              {queue.map((track, idx) => {
                const isDragged = dragState?.fromIndex === idx;
                let shiftY = 0;
                if (dragState && !isDragged) {
                  const { fromIndex, overIndex, stepHeight } = dragState;
                  if (fromIndex < overIndex && idx > fromIndex && idx <= overIndex) {
                    shiftY = -stepHeight;
                  } else if (
                    fromIndex > overIndex &&
                    idx >= overIndex &&
                    idx < fromIndex
                  ) {
                    shiftY = stepHeight;
                  }
                }

                return (
                  <div
                    key={`${track.id}-${idx}`}
                    ref={(el) => {
                      if (el) {
                        rowRefs.current.set(idx, el);
                      } else {
                        rowRefs.current.delete(idx);
                      }
                    }}
                    onClick={() => {
                      if (dragState) return;
                      playFromQueue(idx);
                    }}
                    className={`group relative flex items-center gap-2 p-2 rounded-2xl cursor-pointer ${
                      isDragged
                        ? "shadow-xl shadow-black/50"
                        : "hover:bg-[rgb(var(--md-surface-container-high-rgb)/0.65)] transition-[transform,background-color] duration-150 ease-out"
                    }`}
                    style={
                      isDragged
                        ? {
                            backgroundColor:
                              "rgb(var(--md-surface-container-high-rgb))",
                            border:
                              "1px solid rgb(var(--md-accent-primary-rgb) / 0.55)",
                          }
                        : shiftY !== 0
                          ? { transform: `translate3d(0, ${shiftY}px, 0)` }
                          : undefined
                    }
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => handleDragHandlePointerDown(e, idx)}
                      onPointerMove={handleDragHandlePointerMove}
                      onPointerUp={(e) => handleDragHandlePointerEnd(e, true)}
                      onPointerCancel={(e) => handleDragHandlePointerEnd(e, false)}
                      onKeyDown={(e) => handleDragHandleKeyDown(e, idx)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Riordina ${track.title}`}
                      title="Trascina o usa frecce Su/Giù per riordinare"
                      className={`p-1 rounded-lg touch-none shrink-0 transition-colors cursor-grab active:cursor-grabbing ${
                        isDragged
                          ? "opacity-100"
                          : "opacity-45 group-hover:opacity-100 hover:bg-white/[0.08]"
                      }`}
                      style={{
                        color: isDragged
                          ? "rgb(var(--md-accent-primary-rgb))"
                          : "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </button>

                    <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 ring-1 ring-white/10">
                      <img
                        src={track.cover}
                        alt={track.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-surface-container-high-rgb))",
                        }}
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p
                          className="text-[12.5px] font-medium truncate"
                          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                        >
                          {track.title}
                        </p>
                        {track.isExplicit && <ExplicitBadge />}
                      </div>
                      <p
                        className="text-[11px] truncate"
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

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue(idx);
                      }}
                      title="Rimuovi dalla coda"
                      aria-label={`Rimuovi ${track.title} dalla coda`}
                      className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className="px-4 py-3 flex items-center justify-between gap-3 shrink-0 border-t border-white/[0.08] at-tonal"
        style={{
          backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.52)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 at-tonal"
            style={
              autoplayEnabled
                ? {
                    backgroundColor: "rgb(var(--md-primary-container-rgb))",
                    color: "rgb(var(--md-accent-primary-rgb))",
                  }
                : {
                    backgroundColor: "rgb(var(--md-surface-container-high-rgb))",
                    color: "rgb(var(--md-on-surface-variant-rgb))",
                  }
            }
          >
            {autoplayLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <InfinityIcon className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <p
              className="text-[12.5px] font-semibold truncate"
              style={{ color: "rgb(var(--md-on-surface-rgb))" }}
            >
              Autoplay
            </p>
            <p
              className="text-[11px] truncate"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {autoplayLoading
                ? "Caricamento radio infinita..."
                : autoplayEnabled
                  ? repeat !== "off"
                    ? "In pausa con Ripeti attivo"
                    : "Radio infinita a fine coda"
                  : "Stop automatico a fine coda"}
            </p>
          </div>
        </div>

        <M3ExpressiveSwitch
          checked={autoplayEnabled}
          onChange={(val) => setAutoplayEnabled(val)}
          ariaLabel="Autoplay e radio infinita"
        />
      </div>
    </aside>
  );
}
