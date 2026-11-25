import { RotateCcw, SlidersVertical } from "lucide-react";
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import {
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQUALIZER_BANDS_META,
  EQUALIZER_PRESETS,
} from "../services/audioEngine";
import type { EqualizerPresetId } from "../types/music";
import { usePlayerStore } from "../store/playerStore";
import { M3ExpressiveSwitch } from "./SettingsPrimitives";

const PRESET_ORDER: Exclude<EqualizerPresetId, "custom">[] = [
  "flat",
  "bass_boost",
  "vocal",
  "electronic",
  "rock",
];

function formatDb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 0.05) return "0.0 dB";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
}

function clampDb(value: number): number {
  return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Math.round(value * 2) / 2));
}

export function EqualizerPanel() {
  const equalizer = usePlayerStore((s) => s.preferences.equalizer);
  const setEqualizerEnabled = usePlayerStore((s) => s.setEqualizerEnabled);
  const setEqualizerBandGain = usePlayerStore((s) => s.setEqualizerBand);
  const setEqualizerPreset = usePlayerStore((s) => s.setEqualizerPreset);
  const resetEqualizer = usePlayerStore((s) => s.resetEqualizer);

  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);

  const updateGainFromPointer = useCallback(
    (index: number, clientY: number) => {
      const el = trackRefs.current[index];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const gain = EQ_MIN_DB + ratio * (EQ_MAX_DB - EQ_MIN_DB);
      setEqualizerBandGain(index, clampDb(gain));
    },
    [setEqualizerBandGain],
  );

  const handleTrackPointerDown = (index: number, e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateGainFromPointer(index, e.clientY);
  };

  const handleTrackPointerMove = (index: number, e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.buttons & 1) === 0 && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      return;
    }
    updateGainFromPointer(index, e.clientY);
  };

  const handleSliderKeyDown = (index: number, currentValue: number, e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      next = clampDb(currentValue + 0.5);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      next = clampDb(currentValue - 0.5);
    } else if (e.key === "Home") {
      next = EQ_MAX_DB;
    } else if (e.key === "End") {
      next = EQ_MIN_DB;
    } else if (e.key === "0" || e.key === "Delete" || e.key === "Backspace") {
      next = 0;
    }
    if (next !== null) {
      e.preventDefault();
      setEqualizerBandGain(index, next);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-[22px] border border-white/[0.12] bg-zinc-900/55 backdrop-blur-2xl p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_32px_rgba(0,0,0,0.35)]"
      style={{
        backgroundImage:
          "linear-gradient(155deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.015) 50%, rgba(0,0,0,0.18) 100%)",
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-red-500/15 border border-red-500/25 flex items-center justify-center text-red-300 shrink-0">
            <SlidersVertical className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-semibold text-zinc-100">
                Equalizzatore Audio (5 bande)
              </p>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  equalizer.enabled
                    ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-300"
                    : "bg-white/[0.05] border-white/[0.08] text-zinc-500"
                }`}
              >
                {equalizer.enabled ? "Attivo" : "Bypass"}
              </span>
            </div>
            <p className="text-[12px] text-zinc-400">
              Web Audio parametrico · doppio clic su una banda per azzerarla
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={resetEqualizer}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium text-zinc-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.09] transition-colors"
            title="Ripristina tutte le bande a 0 dB (Flat)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Flat</span>
          </button>

          <M3ExpressiveSwitch
            checked={equalizer.enabled}
            onChange={setEqualizerEnabled}
            ariaLabel="Attiva equalizzatore audio"
          />
        </div>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        {PRESET_ORDER.map((presetId) => {
          const active = equalizer.preset === presetId;
          return (
            <button
              key={presetId}
              type="button"
              onClick={() => setEqualizerPreset(presetId)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all border ${
                active
                  ? "bg-red-500/20 border-red-400/45 text-red-100 shadow-[0_0_16px_rgba(239,68,68,0.22)]"
                  : "bg-white/[0.05] border-white/[0.08] text-zinc-300 hover:bg-white/[0.1] hover:text-zinc-100"
              }`}
            >
              {EQUALIZER_PRESETS[presetId].label}
            </button>
          );
        })}
        {equalizer.preset === "custom" && (
          <span className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-amber-500/15 border border-amber-400/35 text-amber-200">
            Personalizzato
          </span>
        )}
      </div>

      {/* 5 Vertical Band Sliders */}
      <div
        className={`relative rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-4 transition-opacity ${
          equalizer.enabled ? "opacity-100" : "opacity-55"
        }`}
      >
        <div className="grid grid-cols-5 gap-3">
          {EQUALIZER_BANDS_META.map((band, index) => {
            const value = equalizer.bands[index] ?? 0;
            const norm = Math.max(0, Math.min(1, (value - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB)));
            const percent = norm * 100;
            const isPositive = value >= 0;
            const centerPct = 50;
            const fillBottom = isPositive ? centerPct : percent;
            const fillHeight = Math.abs(percent - centerPct);

            return (
              <div key={band.frequency} className="flex flex-col items-center select-none">
                {/* Numeric dB readout */}
                <button
                  type="button"
                  onDoubleClick={() => setEqualizerBandGain(index, 0)}
                  title="Doppio clic per resettare a 0 dB"
                  className={`mb-2.5 text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-md transition-colors ${
                    Math.abs(value) < 0.05
                      ? "text-zinc-400 bg-white/[0.03]"
                      : isPositive
                        ? "text-emerald-300 bg-emerald-500/10"
                        : "text-amber-300 bg-amber-500/10"
                  }`}
                >
                  {formatDb(value)}
                </button>

                {/* Vertical track */}
                <div
                  ref={(el) => {
                    trackRefs.current[index] = el;
                  }}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Banda ${band.shortName} (${band.label})`}
                  aria-valuemin={EQ_MIN_DB}
                  aria-valuemax={EQ_MAX_DB}
                  aria-valuenow={value}
                  onPointerDown={(e) => handleTrackPointerDown(index, e)}
                  onPointerMove={(e) => handleTrackPointerMove(index, e)}
                  onDoubleClick={() => setEqualizerBandGain(index, 0)}
                  onKeyDown={(e) => handleSliderKeyDown(index, value, e)}
                  className="relative h-40 w-10 flex items-center justify-center cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 rounded-xl"
                >
                  {/* Scale reference ticks (+12, +6, 0, -6, -12) */}
                  <div className="pointer-events-none absolute inset-x-2 top-0 h-px bg-white/[0.08]" />
                  <div className="pointer-events-none absolute inset-x-2.5 top-1/4 h-px bg-white/[0.05]" />
                  <div className="pointer-events-none absolute inset-x-1.5 top-1/2 -translate-y-1/2 h-px bg-white/25" />
                  <div className="pointer-events-none absolute inset-x-2.5 top-3/4 h-px bg-white/[0.05]" />
                  <div className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-white/[0.08]" />

                  {/* Rail */}
                  <div className="relative h-full w-2 rounded-full bg-white/[0.1] border border-white/[0.07] overflow-hidden">
                    <div
                      className={`absolute left-0 right-0 transition-[bottom,height] duration-75 ${
                        equalizer.enabled
                          ? "bg-gradient-to-t from-red-500 via-rose-400 to-amber-300"
                          : "bg-zinc-500/60"
                      }`}
                      style={{
                        bottom: `${fillBottom}%`,
                        height: `${fillHeight}%`,
                      }}
                    />
                  </div>

                  {/* Thumb */}
                  <div
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2 w-5 h-5 rounded-full border shadow-md transition-[bottom] duration-75 ${
                      equalizer.enabled
                        ? "bg-white border-red-300/90 shadow-red-500/35"
                        : "bg-zinc-300 border-zinc-400"
                    }`}
                    style={{
                      bottom: `${percent}%`,
                    }}
                  />
                </div>

                {/* Frequency & Band Label */}
                <span className="mt-2.5 text-[11.5px] font-semibold text-zinc-200">
                  {band.label}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {band.shortName}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scale markers */}
        <div className="mt-3 pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-zinc-500">
          <span>-12 dB</span>
          <span>0 dB (Doppio clic per reset)</span>
          <span>+12 dB</span>
        </div>
      </div>
    </div>
  );
}
