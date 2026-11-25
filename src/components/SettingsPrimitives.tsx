import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

interface M3ExpressiveSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * Switch Material 3 Expressive a pillola con icona ✓ quando attivo e × quando spento.
 */
export function M3ExpressiveSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: M3ExpressiveSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center w-[52px] h-[30px] rounded-full transition-colors duration-200 shrink-0 disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.55)]"
      style={{
        backgroundColor: checked
          ? "rgb(var(--md-accent-primary-rgb))"
          : "rgb(var(--md-surface-container-high-rgb))",
        border: checked
          ? "1px solid rgb(var(--md-accent-primary-rgb))"
          : "1px solid rgb(var(--md-outline-rgb) / 0.45)",
      }}
    >
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-full shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[23px]" : "translate-x-[2px]"
        }`}
        style={{
          backgroundColor: checked
            ? "rgb(var(--md-on-accent-rgb))"
            : "rgb(var(--md-on-surface-variant-rgb))",
          color: checked
            ? "rgb(var(--md-accent-primary-rgb))"
            : "rgb(var(--md-surface-container-high-rgb))",
        }}
      >
        {checked ? (
          <Check className="w-3.5 h-3.5 stroke-[2.8]" />
        ) : (
          <X className="w-3.5 h-3.5 stroke-[2.6]" />
        )}
      </span>
    </button>
  );
}

export type BadgeShape = "scalloped" | "clover" | "cloud" | "circle";

interface ShapedIconBadgeProps {
  shape?: BadgeShape;
  bgColor: string;
  fgColor: string;
  size?: number;
  children: ReactNode;
}

/**
 * Badge icona sagomato Material 3 Expressive (scalloped, quadrifoglio, nuvola o cerchio).
 */
export function ShapedIconBadge({
  shape = "scalloped",
  bgColor,
  fgColor,
  size = 44,
  children,
}: ShapedIconBadgeProps) {
  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, color: fgColor }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        {shape === "scalloped" && (
          <path
            fill={bgColor}
            d="M50 3 C57 3 61 9 67 11 C74 13 80 10 85 15 C90 20 87 26 89 33 C91 39 97 43 97 50 C97 57 91 61 89 67 C87 74 90 80 85 85 C80 90 74 87 67 89 C61 91 57 97 50 97 C43 97 39 91 33 89 C26 87 20 90 15 85 C10 80 13 74 11 67 C9 61 3 57 3 50 C3 43 9 39 11 33 C13 26 10 20 15 15 C20 10 26 13 33 11 C39 9 43 3 50 3 Z"
          />
        )}
        {shape === "clover" && (
          <path
            fill={bgColor}
            d="M50 8 C66 8 76 18 76 30 C88 30 92 40 92 50 C92 60 88 70 76 70 C76 82 66 92 50 92 C34 92 24 82 24 70 C12 70 8 60 8 50 C8 40 12 30 24 30 C24 18 34 8 50 8 Z"
          />
        )}
        {shape === "cloud" && (
          <path
            fill={bgColor}
            d="M32 78 C17 78 8 69 8 56 C8 45 15 36 25 34 C28 20 40 12 54 12 C69 12 81 22 83 36 C90 39 94 47 94 56 C94 69 84 78 70 78 Z"
          />
        )}
        {shape === "circle" && <circle cx="50" cy="50" r="46" fill={bgColor} />}
      </svg>
      <span className="relative z-10 flex items-center justify-center">
        {children}
      </span>
    </div>
  );
}

export function ScallopedWatermark({
  className = "",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={`pointer-events-none select-none ${className}`}
    >
      <path
        fill="currentColor"
        d="M50 3 C57 3 61 9 67 11 C74 13 80 10 85 15 C90 20 87 26 89 33 C91 39 97 43 97 50 C97 57 91 61 89 67 C87 74 90 80 85 85 C80 90 74 87 67 89 C61 91 57 97 50 97 C43 97 39 91 33 89 C26 87 20 90 15 85 C10 80 13 74 11 67 C9 61 3 57 3 50 C3 43 9 39 11 33 C13 26 10 20 15 15 C20 10 26 13 33 11 C39 9 43 3 50 3 Z"
      />
    </svg>
  );
}

export function WavyBar({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 14"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`w-full h-3.5 ${className}`}
    >
      <path
        d="M2 7 Q 17 1, 32 7 T 62 7 T 92 7 T 122 7 T 152 7 T 182 7 T 212 7 T 238 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
