const DURATION_PATTERN = /^\d+(?::[0-5]\d){1,2}$/;

/**
 * Converte un valore grezzo di durata (in secondi) in un intero non negativo.
 * Non moltiplica né converte unità: garantisce sempre secondi reali.
 */
export function sanitizeDurationSeconds(raw: unknown): number {
  const num =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.round(num);
}

/**
 * Effettua il parsing di una stringa durata (`m:ss`, `mm:ss`, `h:mm:ss`)
 * restituendo il numero intero di secondi reali.
 */
export function parseDurationToSeconds(text: string): number {
  const trimmed = text.trim();
  if (!DURATION_PATTERN.test(trimmed)) return 0;
  const parts = trimmed.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Formatta un numero di secondi in `m:ss` (o `h:mm:ss` se >= 1 ora).
 */
export function formatTime(seconds: number): string {
  const safe =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/**
 * Formatta il tempo rimanente negativo `-m:ss` (o `-h:mm:ss`).
 */
export function formatRemainingTime(
  currentSeconds: number,
  totalSeconds: number,
): string {
  const safeTotal =
    Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const safeCurrent =
    Number.isFinite(currentSeconds) && currentSeconds > 0 ? currentSeconds : 0;
  const remaining = Math.max(0, safeTotal - safeCurrent);
  return `-${formatTime(remaining)}`;
}

/**
 * Protegge dal bug di AVFoundation/WKWebView su macOS con stream DASH fMP4 (`itag=140`),
 * in cui `HTMLAudioElement.duration` può risultare esattamente raddoppiata (2.0x).
 */
export function isPlausibleAudioDuration(
  audioSeconds: number,
  authoritativeSeconds: number,
): boolean {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) {
    return false;
  }
  if (!Number.isFinite(authoritativeSeconds) || authoritativeSeconds <= 0) {
    return true;
  }
  const tolerance = Math.max(5, authoritativeSeconds * 0.15);
  return Math.abs(audioSeconds - authoritativeSeconds) <= tolerance;
}
