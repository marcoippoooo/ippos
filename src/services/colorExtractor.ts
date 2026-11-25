import { ThemePalette } from "../types/music";
import { tauriFetch } from "./tauriFetch";

const SAMPLE_SIZE = 64;
const HUE_BUCKETS = 24;
const MAX_CACHE_ENTRIES = 100;
const BG_LUMINANCE = relativeLuminance(20, 20, 24);
const MIN_ACCENT_CONTRAST = 4.5;

const paletteCache = new Map<string, ThemePalette>();

export function getPaletteCacheStats(): {
  entries: number;
  estimatedBytes: number;
} {
  return {
    entries: paletteCache.size,
    estimatedBytes: paletteCache.size * 1024,
  };
}

export function clearPaletteCache(): void {
  paletteCache.clear();
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

interface BucketAccumulator {
  weightSum: number;
  rSum: number;
  gSum: number;
  bSum: number;
  hueCenter: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampRange(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

export function contrastRatio(fg: RgbColor, bg: RgbColor): number {
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatioAgainstDark(r: number, g: number, b: number): number {
  const fg = relativeLuminance(r, g, b);
  const lighter = Math.max(fg, BG_LUMINANCE);
  const darker = Math.min(fg, BG_LUMINANCE);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r255: number, g255: number, b255: number): HslColor {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  h *= 60;

  return { h, s, l };
}

function hslToRgb(hDeg: number, s: number, l: number): RgbColor {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const sat = clamp01(s);
  const lum = clamp01(l);

  if (sat === 0) {
    const val = Math.round(lum * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
  const p = 2 * lum - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function hueDistance(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function formatRgb(c: RgbColor): string {
  return `${c.r} ${c.g} ${c.b}`;
}

function normalizeAmbientColor(rgb: RgbColor): RgbColor {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const targetS = Math.max(0.35, Math.min(0.75, hsl.s));
  const targetL = Math.max(0.36, Math.min(0.52, hsl.l));
  return hslToRgb(hsl.h, targetS, targetL);
}

function ensureContrastOnBackground(
  seedHsl: HslColor,
  bg: RgbColor,
  minRatio: number,
  direction: "lighter" | "darker",
): RgbColor {
  let l = clamp01(seedHsl.l);
  const delta = direction === "lighter" ? 0.025 : -0.025;

  for (let step = 0; step < 26; step++) {
    const candidate = hslToRgb(seedHsl.h, seedHsl.s, l);
    if (contrastRatio(candidate, bg) >= minRatio) {
      return candidate;
    }
    l = clampRange(l + delta, 0.04, 0.96);
  }

  return direction === "lighter"
    ? { r: 248, g: 248, b: 252 }
    : { r: 16, g: 14, b: 18 };
}

function pickOnAccentColor(accent: RgbColor, hue: number, sat: number): RgbColor {
  const deepInk = hslToRgb(hue, Math.min(0.62, sat), 0.13);
  if (contrastRatio(deepInk, accent) >= MIN_ACCENT_CONTRAST) {
    return deepInk;
  }

  const darkerInk = hslToRgb(hue, Math.min(0.45, sat), 0.07);
  if (contrastRatio(darkerInk, accent) >= MIN_ACCENT_CONTRAST) {
    return darkerInk;
  }

  const darkFallback: RgbColor = { r: 14, g: 13, b: 16 };
  const lightFallback: RgbColor = { r: 252, g: 252, b: 255 };
  return contrastRatio(darkFallback, accent) >= contrastRatio(lightFallback, accent)
    ? darkFallback
    : lightFallback;
}

/**
 * Costruisce una palette tonale completa in stile Material You (Monet dark)
 * a partire dai semi dominante, secondario e accento della copertina,
 * garantendo leggibilità WCAG >= 4.5 su contenitori e controlli.
 */
export function buildTonalPalette(
  primarySeed: RgbColor,
  secondarySeed: RgbColor,
  accentSeed: RgbColor,
  isDynamic: boolean,
  isMonochrome = false,
): ThemePalette {
  const primaryHsl = rgbToHsl(primarySeed.r, primarySeed.g, primarySeed.b);
  const secondaryHsl = rgbToHsl(secondarySeed.r, secondarySeed.g, secondarySeed.b);
  const accentHsl = rgbToHsl(accentSeed.r, accentSeed.g, accentSeed.b);

  const surfaceS = isMonochrome ? 0.05 : clampRange(primaryHsl.s * 0.24, 0.09, 0.17);
  const surfaceBase = hslToRgb(primaryHsl.h, surfaceS, 0.062);
  const surfaceContainerLow = hslToRgb(primaryHsl.h, surfaceS, 0.092);
  const surfaceContainer = hslToRgb(primaryHsl.h, Math.min(0.19, surfaceS + 0.015), 0.125);
  const surfaceContainerHigh = hslToRgb(primaryHsl.h, Math.min(0.21, surfaceS + 0.025), 0.168);
  const outline = hslToRgb(primaryHsl.h, surfaceS, 0.36);

  const onSurface = hslToRgb(primaryHsl.h, isMonochrome ? 0.04 : 0.08, 0.945);
  const onSurfaceVariant = hslToRgb(primaryHsl.h, isMonochrome ? 0.05 : 0.10, 0.70);

  const primaryContainer = hslToRgb(
    accentHsl.h,
    isMonochrome ? 0.12 : clampRange(accentHsl.s * 0.65, 0.36, 0.54),
    0.245,
  );
  const onPrimaryContainer = ensureContrastOnBackground(
    { h: accentHsl.h, s: isMonochrome ? 0.10 : 0.52, l: 0.90 },
    primaryContainer,
    MIN_ACCENT_CONTRAST,
    "lighter",
  );

  const secondaryContainer = hslToRgb(
    secondaryHsl.h,
    isMonochrome ? 0.09 : clampRange(secondaryHsl.s * 0.48, 0.22, 0.36),
    0.21,
  );
  const onSecondaryContainer = ensureContrastOnBackground(
    { h: secondaryHsl.h, s: isMonochrome ? 0.08 : 0.36, l: 0.88 },
    secondaryContainer,
    MIN_ACCENT_CONTRAST,
    "lighter",
  );

  const accentPrimary = ensureContrastOnBackground(
    {
      h: accentHsl.h,
      s: isMonochrome ? 0.10 : clampRange(accentHsl.s, 0.64, 0.88),
      l: isMonochrome ? 0.84 : 0.75,
    },
    surfaceContainer,
    MIN_ACCENT_CONTRAST,
    "lighter",
  );
  const onAccent = pickOnAccentColor(
    accentPrimary,
    accentHsl.h,
    isMonochrome ? 0.14 : accentHsl.s,
  );

  const ambientPrimary = isMonochrome
    ? primarySeed
    : normalizeAmbientColor(primarySeed);
  const ambientSecondary = isMonochrome
    ? secondarySeed
    : normalizeAmbientColor(secondarySeed);
  const accentStr = formatRgb(accentPrimary);

  return {
    primaryRgb: formatRgb(ambientPrimary),
    secondaryRgb: formatRgb(ambientSecondary),
    accentRgb: accentStr,
    surfaceBaseRgb: formatRgb(surfaceBase),
    surfaceContainerLowRgb: formatRgb(surfaceContainerLow),
    surfaceContainerRgb: formatRgb(surfaceContainer),
    surfaceContainerHighRgb: formatRgb(surfaceContainerHigh),
    primaryContainerRgb: formatRgb(primaryContainer),
    onPrimaryContainerRgb: formatRgb(onPrimaryContainer),
    secondaryContainerRgb: formatRgb(secondaryContainer),
    onSecondaryContainerRgb: formatRgb(onSecondaryContainer),
    accentPrimaryRgb: accentStr,
    onAccentRgb: formatRgb(onAccent),
    outlineRgb: formatRgb(outline),
    onSurfaceRgb: formatRgb(onSurface),
    onSurfaceVariantRgb: formatRgb(onSurfaceVariant),
    isDynamic,
  };
}

export const DEFAULT_THEME_PALETTE: ThemePalette = buildTonalPalette(
  { r: 120, g: 58, b: 74 },
  { r: 88, g: 58, b: 96 },
  { r: 245, g: 130, b: 152 },
  false,
);

export const NEUTRAL_DARK_PALETTE: ThemePalette = {
  primaryRgb: "88 90 100",
  secondaryRgb: "70 72 82",
  accentRgb: "235 236 242",
  surfaceBaseRgb: "14 14 16",
  surfaceContainerLowRgb: "21 21 24",
  surfaceContainerRgb: "28 28 32",
  surfaceContainerHighRgb: "39 39 45",
  primaryContainerRgb: "52 54 62",
  onPrimaryContainerRgb: "238 239 244",
  secondaryContainerRgb: "44 45 52",
  onSecondaryContainerRgb: "222 224 232",
  accentPrimaryRgb: "235 236 242",
  onAccentRgb: "18 18 22",
  outlineRgb: "82 84 92",
  onSurfaceRgb: "242 242 245",
  onSurfaceVariantRgb: "168 170 178",
  isDynamic: false,
};

/**
 * Estrae una palette tonale armonica campionando l'area centrale
 * dell'immagine 64x64 per evitare letterboxing.
 */
export function extractPaletteFromPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ThemePalette {
  const buckets: BucketAccumulator[] = Array.from(
    { length: HUE_BUCKETS },
    (_, i) => ({
      weightSum: 0,
      rSum: 0,
      gSum: 0,
      bSum: 0,
      hueCenter: (i + 0.5) * (360 / HUE_BUCKETS),
    }),
  );

  const marginX = Math.floor(width * 0.125);
  const marginY = Math.floor(height * 0.125);
  const minX = marginX;
  const maxX = Math.max(minX + 1, width - marginX);
  const minY = marginY;
  const maxY = Math.max(minY + 1, height - marginY);

  let neutralWeight = 0;
  let neutralR = 0;
  let neutralG = 0;
  let neutralB = 0;

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const idx = (y * width + x) * 4;
      const a = rgba[idx + 3];
      if (a < 180) continue;

      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const hsl = rgbToHsl(r, g, b);

      if (hsl.l < 0.08 || hsl.l > 0.92) continue;

      if (hsl.s < 0.12) {
        const w = 1 - Math.abs(hsl.l - 0.5);
        neutralWeight += w;
        neutralR += r * w;
        neutralG += g * w;
        neutralB += b * w;
        continue;
      }

      const bucketIdx = Math.min(
        HUE_BUCKETS - 1,
        Math.floor((hsl.h / 360) * HUE_BUCKETS),
      );
      const midtoneFactor = 1.15 - Math.abs(hsl.l - 0.5);
      const weight = 0.4 + hsl.s * 1.6 * Math.max(0.25, midtoneFactor);

      const acc = buckets[bucketIdx];
      acc.weightSum += weight;
      acc.rSum += r * weight;
      acc.gSum += g * weight;
      acc.bSum += b * weight;
    }
  }

  const populated = buckets
    .filter((b) => b.weightSum > 0)
    .sort((a, b) => b.weightSum - a.weightSum);

  if (populated.length === 0) {
    if (neutralWeight > 0) {
      const avg: RgbColor = {
        r: Math.round(neutralR / neutralWeight),
        g: Math.round(neutralG / neutralWeight),
        b: Math.round(neutralB / neutralWeight),
      };
      const primary = {
        r: Math.max(58, Math.min(110, avg.r)),
        g: Math.max(58, Math.min(110, avg.g)),
        b: Math.max(66, Math.min(120, avg.b)),
      };
      const secondary = {
        r: Math.max(36, primary.r - 18),
        g: Math.max(36, primary.g - 18),
        b: Math.max(44, primary.b - 12),
      };
      return buildTonalPalette(
        primary,
        secondary,
        { r: 218, g: 222, b: 232 },
        true,
        true,
      );
    }
    return DEFAULT_THEME_PALETTE;
  }

  const primaryBucket = populated[0];
  const rawPrimary: RgbColor = {
    r: Math.round(primaryBucket.rSum / primaryBucket.weightSum),
    g: Math.round(primaryBucket.gSum / primaryBucket.weightSum),
    b: Math.round(primaryBucket.bSum / primaryBucket.weightSum),
  };
  const primaryHsl = rgbToHsl(rawPrimary.r, rawPrimary.g, rawPrimary.b);

  const distinctSecondary = populated.find(
    (b) => hueDistance(b.hueCenter, primaryBucket.hueCenter) >= 35,
  );

  let secondary: RgbColor;
  if (distinctSecondary) {
    secondary = {
      r: Math.round(distinctSecondary.rSum / distinctSecondary.weightSum),
      g: Math.round(distinctSecondary.gSum / distinctSecondary.weightSum),
      b: Math.round(distinctSecondary.bSum / distinctSecondary.weightSum),
    };
  } else {
    secondary = hslToRgb(
      (primaryHsl.h + 38) % 360,
      Math.max(0.32, Math.min(0.68, primaryHsl.s)),
      0.34,
    );
  }

  let vibrantColor = rawPrimary;
  let bestVibrancy = -1;
  for (const bucket of populated) {
    const avg: RgbColor = {
      r: Math.round(bucket.rSum / bucket.weightSum),
      g: Math.round(bucket.gSum / bucket.weightSum),
      b: Math.round(bucket.bSum / bucket.weightSum),
    };
    const hsl = rgbToHsl(avg.r, avg.g, avg.b);
    const score =
      hsl.s * 0.7 + Math.min(1, bucket.weightSum / primaryBucket.weightSum) * 0.3;
    if (score > bestVibrancy) {
      bestVibrancy = score;
      vibrantColor = avg;
    }
  }

  return buildTonalPalette(rawPrimary, secondary, vibrantColor, true, false);
}

function getSamplingUrl(coverUrl: string): string {
  if (coverUrl.includes("googleusercontent.com")) {
    return coverUrl.replace(/=w\d+-h\d+([^&]*)$/, "=w64-h64$1");
  }
  return coverUrl;
}

function loadHtmlImage(src: string, useCrossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCrossOrigin) {
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
    }
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

function sampleImageOnCanvas(img: HTMLImageElement): ThemePalette {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return DEFAULT_THEME_PALETTE;

  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return extractPaletteFromPixels(imageData.data, SAMPLE_SIZE, SAMPLE_SIZE);
}

function cachePalette(trackId: string, palette: ThemePalette): void {
  if (paletteCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey) {
      paletteCache.delete(oldestKey);
    }
  }
  paletteCache.set(trackId, palette);
}

export async function extractTrackPalette(
  trackId: string,
  coverUrl: string,
): Promise<ThemePalette> {
  const cached = paletteCache.get(trackId);
  if (cached) {
    return cached;
  }

  if (!coverUrl) {
    return DEFAULT_THEME_PALETTE;
  }

  const samplingUrl = getSamplingUrl(coverUrl);

  // Percorso 1: campionamento diretto tramite Image con crossOrigin anonymous
  if (!samplingUrl.startsWith("data:")) {
    try {
      const img = await loadHtmlImage(samplingUrl, true);
      const palette = sampleImageOnCanvas(img);
      cachePalette(trackId, palette);
      return palette;
    } catch {
      // Fallback via tauriFetch se il server o la cache WebKit negano CORS
    }
  }

  // Percorso 2: fallback data-URI o fetch dal backend Rust -> Blob -> Canvas 64x64
  try {
    if (samplingUrl.startsWith("data:")) {
      const img = await loadHtmlImage(samplingUrl, false);
      const palette = sampleImageOnCanvas(img);
      cachePalette(trackId, palette);
      return palette;
    }

    const res = await tauriFetch(samplingUrl);
    if (!res.ok) {
      return DEFAULT_THEME_PALETTE;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await loadHtmlImage(objectUrl, false);
      const palette = sampleImageOnCanvas(img);
      cachePalette(trackId, palette);
      return palette;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return DEFAULT_THEME_PALETTE;
  }
}
