import { useState } from "react";

export type ScallopVariant = "cookie10" | "cookie8";

function createScallopedPath(
  lobes: number,
  baseRadius: number,
  amplitude: number,
  samples = 120,
): string {
  const cmds: string[] = [];
  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * Math.PI * 2;
    const r = baseRadius + amplitude * Math.cos(lobes * theta);
    const x = 50 + r * Math.cos(theta);
    const y = 50 + r * Math.sin(theta);
    cmds.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  cmds.push("Z");
  return cmds.join(" ");
}

const SCALLOP_PATHS: Record<ScallopVariant, string> = {
  cookie10: createScallopedPath(10, 44.8, 3.9),
  cookie8: createScallopedPath(8, 44.2, 4.4),
};

function buildMaskDataUri(pathD: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${pathD}" fill="white"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

const SCALLOP_MASKS: Record<ScallopVariant, string> = {
  cookie10: buildMaskDataUri(SCALLOP_PATHS.cookie10),
  cookie8: buildMaskDataUri(SCALLOP_PATHS.cookie8),
};

interface ScallopedArtworkProps {
  src?: string;
  alt: string;
  size: number;
  variant?: ScallopVariant;
  active?: boolean;
  fallback?: React.ReactNode;
  overlay?: React.ReactNode;
  className?: string;
}

/**
 * Maschera organica a contorno ondulato (scalloped / cookie) con bordo SVG
 * nitido su DPR Retina e supporto nativo per `referrerPolicy="no-referrer"`.
 */
export function ScallopedArtwork({
  src,
  alt,
  size,
  variant = "cookie10",
  active = false,
  fallback,
  overlay,
  className = "",
}: ScallopedArtworkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const pathD = SCALLOP_PATHS[variant];
  const maskUri = SCALLOP_MASKS[variant];
  const canRenderImg = Boolean(src && src !== failedSrc);

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        filter: active
          ? "drop-shadow(0 8px 18px rgb(var(--theme-primary-rgb) / 0.42))"
          : "drop-shadow(0 4px 10px rgba(0, 0, 0, 0.42))",
        transition: "filter 500ms ease",
      }}
    >
      <div
        className="w-full h-full overflow-hidden flex items-center justify-center at-tonal"
        style={{
          maskImage: maskUri,
          WebkitMaskImage: maskUri,
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          backgroundColor: "rgb(var(--md-surface-container-high-rgb))",
        }}
      >
        {canRenderImg && src ? (
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(src)}
            className="w-full h-full object-cover"
          />
        ) : (
          fallback ?? null
        )}
        {overlay}
      </div>

      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full"
      >
        <path
          d={pathD}
          fill="none"
          stroke={
            active
              ? "rgb(var(--md-accent-primary-rgb) / 0.42)"
              : "rgb(var(--md-outline-rgb) / 0.35)"
          }
          strokeWidth={variant === "cookie8" ? 2.2 : 1.7}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
