import { useCallback, useRef, useState } from "react";

interface ExpressiveSliderProps {
  value: number;
  min?: number;
  max: number;
  step?: number;
  bufferedValue?: number;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  ariaLabel: string;
  formatTooltip?: (value: number) => string;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: (value: number) => void;
  className?: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function quantize(raw: number, min: number, max: number, step: number): number {
  const clamped = clamp(raw, min, max);
  if (step <= 0) return clamped;
  const snapped = Math.round((clamped - min) / step) * step + min;
  return clamp(Number(snapped.toFixed(6)), min, max);
}

/**
 * Slider tattile in stile Material 3 Expressive: traccia spessa con
 * interruzione attorno al cursore verticale a capsula reattivo a hover e drag.
 */
export function ExpressiveSlider({
  value,
  min = 0,
  max,
  step = 0.01,
  bufferedValue,
  disabled = false,
  size = "md",
  ariaLabel,
  formatTooltip,
  onChange,
  onChangeStart,
  onChangeEnd,
  className = "",
}: ExpressiveSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const safeMax = max > min ? max : min + 1;
  const safeVal = clamp(value, min, safeMax);
  const ratio = (safeVal - min) / (safeMax - min);
  const pct = ratio * 100;

  const bufferedPct =
    typeof bufferedValue === "number" && Number.isFinite(bufferedValue)
      ? clamp((bufferedValue - min) / (safeMax - min), ratio, 1) * 100
      : pct;

  const isActive = isHovered || isDragging || isFocused;
  const trackHeightClass =
    size === "lg"
      ? isActive
        ? "h-[12px]"
        : "h-[10px]"
      : size === "md"
        ? isActive
          ? "h-[10px]"
          : "h-[8px]"
        : isActive
          ? "h-[8px]"
          : "h-[6px]";

  const handleSizeClass =
    size === "lg"
      ? isDragging
        ? "w-[4px] h-[28px]"
        : isActive
          ? "w-[4.5px] h-[26px]"
          : "w-[4.5px] h-[22px]"
      : size === "md"
        ? isDragging
          ? "w-[3.5px] h-[24px]"
          : isActive
            ? "w-[4px] h-[22px]"
            : "w-[4px] h-[18px]"
        : isDragging
          ? "w-[3px] h-[20px]"
          : isActive
            ? "w-[3.5px] h-[18px]"
            : "w-[3.5px] h-[15px]";

  const computeValueFromClientX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return safeVal;
      const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
      return quantize(min + frac * (safeMax - min), min, safeMax, step);
    },
    [min, safeMax, safeVal, step],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    onChangeStart?.();

    const next = computeValueFromClientX(e.clientX);
    onChange(next);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || disabled) return;
    const next = computeValueFromClientX(e.clientX);
    onChange(next);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!isDragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
    const next = computeValueFromClientX(e.clientX);
    if (commit) {
      onChangeEnd?.(next);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const coarse = (safeMax - min) / 20;
    const fine = Math.max(step, (safeMax - min) / 100);
    let next: number | null = null;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = quantize(safeVal + fine, min, safeMax, step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = quantize(safeVal - fine, min, safeMax, step);
        break;
      case "PageUp":
        next = quantize(safeVal + coarse, min, safeMax, step);
        break;
      case "PageDown":
        next = quantize(safeVal - coarse, min, safeMax, step);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = safeMax;
        break;
      default:
        break;
    }

    if (next !== null) {
      e.preventDefault();
      onChange(next);
      onChangeEnd?.(next);
    }
  };

  const remainingPct = Math.max(0.001, 100 - pct);
  const bufferedWithinRightPct = clamp(
    ((bufferedPct - pct) / remainingPct) * 100,
    0,
    100,
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      aria-valuenow={Number(safeVal.toFixed(2))}
      aria-disabled={disabled}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishDrag(e, true)}
      onPointerCancel={(e) => finishDrag(e, false)}
      onKeyDown={handleKeyDown}
      className={`relative flex items-center select-none touch-none focus:outline-none ${
        size === "lg" ? "h-8" : size === "md" ? "h-7" : "h-6"
      } ${
        disabled
          ? "opacity-40 cursor-default pointer-events-none"
          : "cursor-pointer"
      } ${className}`}
    >
      {/* Segmento sinistro attivo con terminale morbido prima dello stacco capsula */}
      <div
        className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-l-full rounded-r-[3px] transition-[height] duration-150 ease-out ${trackHeightClass}`}
        style={{
          width: `calc(max(0px, ${pct}% - 5px))`,
          backgroundColor: "rgb(var(--md-accent-primary-rgb))",
        }}
      />

      {/* Segmento destro inattivo con eventuale livello buffered */}
      <div
        className={`absolute right-0 top-1/2 -translate-y-1/2 rounded-l-[3px] rounded-r-full overflow-hidden transition-[height] duration-150 ease-out ${trackHeightClass}`}
        style={{
          left: `calc(min(100%, ${pct}% + 5px))`,
          backgroundColor: "rgb(var(--md-surface-container-high-rgb))",
        }}
      >
        {bufferedWithinRightPct > 0.5 && (
          <div
            className="h-full rounded-r-full"
            style={{
              width: `${bufferedWithinRightPct}%`,
              backgroundColor: "rgb(var(--md-primary-container-rgb) / 0.8)",
            }}
          />
        )}
      </div>

      {/* Cursore verticale a capsula stile Material 3 Expressive */}
      <div
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none transition-[width,height,box-shadow] duration-150 ease-out ${handleSizeClass}`}
        style={{
          left: `clamp(2px, ${pct}%, calc(100% - 2px))`,
          backgroundColor: "rgb(var(--md-accent-primary-rgb))",
          boxShadow: isActive
            ? "0 0 0 4px rgb(var(--md-accent-primary-rgb) / 0.16)"
            : "0 1px 4px rgba(0, 0, 0, 0.45)",
        }}
      />

      {/* Tooltip pillola durante lo scrub */}
      {isDragging && formatTooltip && (
        <div
          className="absolute bottom-full mb-2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums whitespace-nowrap shadow-md pointer-events-none"
          style={{
            left: `clamp(14px, ${pct}%, calc(100% - 14px))`,
            backgroundColor: "rgb(var(--md-primary-container-rgb))",
            color: "rgb(var(--md-on-primary-container-rgb))",
          }}
        >
          {formatTooltip(safeVal)}
        </div>
      )}
    </div>
  );
}
