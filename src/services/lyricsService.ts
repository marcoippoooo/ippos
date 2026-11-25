import {
  LyricLine,
  LyricsData,
  LyricsProviderPriority,
  Track,
} from "../types/music";
import { tauriFetch } from "./tauriFetch";
import { getYTMusicClient } from "./ytmusic";

const MAX_CACHE_ENTRIES = 100;
const LRCLIB_BASE = "https://lrclib.net/api";
const LRCLIB_USER_AGENT = "IPPOS/1.0.0 (macOS Desktop Client)";
const SYNC_LEAD_SECONDS = 0.12;

const LRCLIB_HEADERS = {
  "User-Agent": LRCLIB_USER_AGENT,
  "Lrclib-Client": LRCLIB_USER_AGENT,
};

const lyricsCache = new Map<string, LyricsData>();

export function getLyricsCacheStats(): {
  entries: number;
  estimatedBytes: number;
} {
  let estimatedBytes = 0;
  for (const entry of lyricsCache.values()) {
    estimatedBytes += 128;
    for (const line of entry.lines) {
      estimatedBytes += 32 + line.text.length * 2;
    }
  }
  return { entries: lyricsCache.size, estimatedBytes };
}

export function clearLyricsCache(): void {
  lyricsCache.clear();
}

interface LrcLibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const TIMESTAMP_TAG_REGEX = /\[(\d{1,3}):([0-5]?\d)(?:[.,](\d{1,3}))?\]/g;
const OFFSET_TAG_REGEX = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
const META_TAG_REGEX = /^\[(?:ar|ti|al|au|by|length|re|ve):.*\]$/i;

function cacheLyrics(cacheKey: string, data: LyricsData): void {
  if (lyricsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = lyricsCache.keys().next().value;
    if (oldestKey) {
      lyricsCache.delete(oldestKey);
    }
  }
  lyricsCache.set(cacheKey, data);
}

/**
 * Effettua il parsing di una stringa LRC gestendo:
 * - fine riga CRLF/LF
 * - tag [offset:+/-ms]
 * - timestamp multipli per riga (es. [00:12.00][01:24.50] Testo)
 * - decimali a 2 o 3 cifre con punto o virgola
 */
export function parseLrc(raw: string): LyricLine[] {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const rawLines = normalized.split("\n");

  // Pre-scansione per tag [offset:+/-ms] (standard LRC: positivo = anticipa il testo)
  let offsetSec = 0;
  for (const rawLine of rawLines) {
    const offsetMatch = rawLine.trim().match(OFFSET_TAG_REGEX);
    if (offsetMatch) {
      const ms = Number(offsetMatch[1]);
      if (Number.isFinite(ms)) {
        offsetSec = ms / 1000;
      }
    }
  }

  const parsed: LyricLine[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (OFFSET_TAG_REGEX.test(trimmed) || META_TAG_REGEX.test(trimmed)) {
      continue;
    }

    const timestamps: number[] = [];
    TIMESTAMP_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP_TAG_REGEX.exec(trimmed)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fracRaw = match[3] ?? "";
      const frac = fracRaw
        ? Number(fracRaw) / Math.pow(10, fracRaw.length)
        : 0;
      const totalSeconds = minutes * 60 + seconds + frac - offsetSec;
      timestamps.push(Math.max(0, Number(totalSeconds.toFixed(3))));
    }

    if (timestamps.length === 0) continue;

    TIMESTAMP_TAG_REGEX.lastIndex = 0;
    const text = trimmed.replace(TIMESTAMP_TAG_REGEX, "").trim();
    if (!text) continue;

    for (const time of timestamps) {
      parsed.push({ time, text });
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  return parsed;
}

/**
 * Formatta un testo statico non sincronizzato preservando al massimo una riga
 * vuota tra le strofe.
 */
export function parsePlainLyrics(raw: string): LyricLine[] {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const result: LyricLine[] = [];
  let prevBlank = false;

  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!prevBlank && result.length > 0) {
        result.push({ time: -1, text: "" });
        prevBlank = true;
      }
      continue;
    }
    result.push({ time: -1, text: trimmed });
    prevBlank = false;
  }

  while (result.length > 0 && result[result.length - 1].text === "") {
    result.pop();
  }

  return result;
}

/**
 * Ricerca binaria O(log n) della riga corrispondente a `currentTime`.
 * Applica un lieve anticipo visivo (120ms) per reattività naturale.
 */
export function findActiveLyricIndex(
  lines: LyricLine[],
  currentTime: number,
): number {
  if (lines.length === 0) return -1;

  const target = currentTime + SYNC_LEAD_SECONDS;
  if (target < lines[0].time) return -1;

  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].time <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

export function cleanTrackTitle(title: string): string {
  return title
    .replace(
      /\s*[\(\[](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyrics?|hd|4k|remastered(?:\s*\d{4})?|explicit|radio\s*edit|single\s*version|album\s*version|(?:feat|ft)\.?[^\)\]]*)[\)\]]/gi,
      "",
    )
    .replace(/\s+(?:feat|ft)\.?\s+[^-]+$/i, "")
    .replace(
      /\s+-\s+(?:remastered(?:\s*\d{4})?|radio\s*edit|official\s*(?:audio|video|music\s*video)|single\s*version).*$/i,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function extractPrimaryArtist(artist: string): string {
  const withoutTopic = artist
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .trim();
  return (
    withoutTopic
      .split(/\s*(?:,|&|•|·|×|\sx\s|\/|\bfeat\.?\b|\bft\.?\b)\s*/i)[0]
      ?.trim() || withoutTopic
  );
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const normA = normalizeForMatch(a);
  const normB = normalizeForMatch(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.85;

  const setA = new Set(normA.split(" ").filter(Boolean));
  const setB = new Set(normB.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  return (2 * overlap) / (setA.size + setB.size);
}

function hasValidSyncedLyrics(record: LrcLibRecord | null | undefined): boolean {
  return (
    typeof record?.syncedLyrics === "string" &&
    record.syncedLyrics.trim().length > 0 &&
    parseLrc(record.syncedLyrics).length > 0
  );
}

function scoreCandidateMatch(
  candidate: LrcLibRecord,
  targetTitle: string,
  targetArtist: string,
  durationSec?: number,
): number {
  const titleSim = tokenSimilarity(candidate.trackName ?? "", targetTitle);
  const artistSim = tokenSimilarity(candidate.artistName ?? "", targetArtist);
  let score = titleSim * 50 + artistSim * 35;

  if (durationSec && durationSec > 0 && candidate.duration && candidate.duration > 0) {
    const diff = Math.abs(candidate.duration - durationSec);
    if (diff <= 5) {
      score += 25;
    } else if (diff <= 15) {
      score += 12 - diff * 0.5;
    } else if (diff <= 25) {
      score -= 8;
    } else {
      score -= 35;
    }
  }

  if (hasValidSyncedLyrics(candidate)) {
    score += 20;
  }

  return score;
}

function pickBestLrcLibRecord(
  results: LrcLibRecord[],
  targetTitle: string,
  targetArtist: string,
  durationSec?: number,
): LrcLibRecord | null {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const withSynced = results.filter((r) => hasValidSyncedLyrics(r));
  const pool = withSynced.length > 0 ? withSynced : results;

  const ranked = [...pool]
    .map((record) => ({
      record,
      score: scoreCandidateMatch(record, targetTitle, targetArtist, durationSec),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  if (
    durationSec &&
    durationSec > 0 &&
    best.record.duration &&
    best.record.duration > 0 &&
    Math.abs(best.record.duration - durationSec) > 30
  ) {
    return null;
  }

  return best.record;
}

async function fetchYoutubeMusicLyrics(videoId: string): Promise<{
  text: string;
  footer?: string;
} | null> {
  const client = await getYTMusicClient();
  const shelf = await client.music.getLyrics(videoId);
  const text = shelf?.description?.toString()?.trim();
  if (!text) return null;
  const footer = shelf?.footer?.toString()?.trim() || undefined;
  return { text, footer };
}

async function queryLrcLibGet(params: {
  trackName: string;
  artistName: string;
  albumName?: string;
  durationSec?: number;
}): Promise<LrcLibRecord | null> {
  if (
    !params.trackName.trim() ||
    !params.artistName.trim() ||
    !params.albumName?.trim() ||
    !params.durationSec ||
    params.durationSec <= 0
  ) {
    return null;
  }

  const url = new URL(`${LRCLIB_BASE}/get`);
  url.searchParams.set("track_name", params.trackName.trim());
  url.searchParams.set("artist_name", params.artistName.trim());
  url.searchParams.set("album_name", params.albumName.trim());
  url.searchParams.set("duration", String(Math.round(params.durationSec)));

  const res = await tauriFetch(url.toString(), {
    headers: LRCLIB_HEADERS,
  });

  if (res.status === 404 || res.status === 400) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`LRCLIB status ${res.status}`);
  }
  return (await res.json()) as LrcLibRecord;
}

async function queryLrcLibSearch(params: {
  trackName: string;
  artistName: string;
  durationSec?: number;
}): Promise<LrcLibRecord | null> {
  const url = new URL(`${LRCLIB_BASE}/search`);
  url.searchParams.set("track_name", params.trackName);
  url.searchParams.set("artist_name", params.artistName);

  const res = await tauriFetch(url.toString(), {
    headers: LRCLIB_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`LRCLIB search status ${res.status}`);
  }

  const results = (await res.json()) as LrcLibRecord[];
  return pickBestLrcLibRecord(
    results,
    params.trackName,
    params.artistName,
    params.durationSec,
  );
}

async function queryLrcLibSearchByQuery(params: {
  query: string;
  targetTitle: string;
  targetArtist: string;
  durationSec?: number;
}): Promise<LrcLibRecord | null> {
  const trimmed = params.query.trim();
  if (!trimmed) return null;

  const url = new URL(`${LRCLIB_BASE}/search`);
  url.searchParams.set("q", trimmed);

  const res = await tauriFetch(url.toString(), {
    headers: LRCLIB_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`LRCLIB query search status ${res.status}`);
  }

  const results = (await res.json()) as LrcLibRecord[];
  return pickBestLrcLibRecord(
    results,
    params.targetTitle,
    params.targetArtist,
    params.durationSec,
  );
}

async function fetchFromLrcLib(
  track: Track,
  durationHint?: number,
): Promise<LrcLibRecord | null> {
  const durationSec =
    durationHint && durationHint > 0 ? durationHint : track.durationSeconds;
  const cleanedTitle = cleanTrackTitle(track.title) || track.title;
  const primaryArtist = extractPrimaryArtist(track.artist) || track.artist;

  let bestFallback: LrcLibRecord | null = null;
  let hadNetworkError = false;

  try {
    const exact = await queryLrcLibGet({
      trackName: track.title,
      artistName: track.artist,
      albumName: track.album,
      durationSec,
    });
    if (hasValidSyncedLyrics(exact)) return exact;
    if (exact) bestFallback = exact;
  } catch {
    hadNetworkError = true;
  }

  try {
    const searched = await queryLrcLibSearch({
      trackName: cleanedTitle,
      artistName: primaryArtist,
      durationSec,
    });
    if (hasValidSyncedLyrics(searched)) return searched;
    if (searched && !bestFallback) bestFallback = searched;
  } catch {
    hadNetworkError = true;
  }

  try {
    const byQuery = await queryLrcLibSearchByQuery({
      query: `${cleanedTitle} ${primaryArtist}`,
      targetTitle: cleanedTitle,
      targetArtist: primaryArtist,
      durationSec,
    });
    if (hasValidSyncedLyrics(byQuery)) return byQuery;
    if (byQuery && !bestFallback) bestFallback = byQuery;
  } catch {
    hadNetworkError = true;
  }

  if (bestFallback) {
    return bestFallback;
  }
  if (hadNetworkError) {
    throw new Error("LRCLIB unreachable");
  }
  return null;
}

export async function fetchLyricsForTrack(
  track: Track,
  durationHint?: number,
  _priority: LyricsProviderPriority = "lrclib",
): Promise<LyricsData> {
  const effectiveDuration =
    durationHint && durationHint > 0 ? durationHint : track.durationSeconds;
  const cacheKey = track.id;
  const cached = lyricsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let lrcFailed = false;
  let ytFailed = false;
  let lrcRecord: LrcLibRecord | null = null;

  // Priorità assoluta a LRCLIB (`syncedLyrics`) per ottenere i timestamp `[mm:ss.xx]`
  try {
    lrcRecord = await fetchFromLrcLib(track, effectiveDuration);
  } catch {
    lrcFailed = true;
  }

  if (lrcRecord?.syncedLyrics) {
    const syncedLines = parseLrc(lrcRecord.syncedLyrics);
    if (syncedLines.length > 0) {
      const syncedData: LyricsData = {
        trackId: track.id,
        mode: "synced",
        lines: syncedLines,
        source: "LRCLIB • Sincronizzato",
      };
      cacheLyrics(cacheKey, syncedData);
      return syncedData;
    }
  }

  if (lrcRecord?.plainLyrics) {
    const plainLines = parsePlainLyrics(lrcRecord.plainLyrics);
    if (plainLines.length > 0) {
      const plainData: LyricsData = {
        trackId: track.id,
        mode: "plain",
        lines: plainLines,
        source: "LRCLIB",
      };
      cacheLyrics(cacheKey, plainData);
      return plainData;
    }
  }

  if (lrcRecord?.instrumental) {
    const instData: LyricsData = {
      trackId: track.id,
      mode: "instrumental",
      lines: [],
      source: "LRCLIB",
    };
    cacheLyrics(cacheKey, instData);
    return instData;
  }

  // Fallback su YouTube Music / LyricFind solo se LRCLIB non trova corrispondenze
  try {
    const ytResult = await fetchYoutubeMusicLyrics(track.id);
    if (ytResult) {
      const ytSynced = parseLrc(ytResult.text);
      if (ytSynced.length >= 2) {
        const ytSyncedData: LyricsData = {
          trackId: track.id,
          mode: "synced",
          lines: ytSynced,
          source: ytResult.footer || "YouTube Music",
        };
        cacheLyrics(cacheKey, ytSyncedData);
        return ytSyncedData;
      }

      const ytPlain = parsePlainLyrics(ytResult.text);
      if (ytPlain.length > 0) {
        const ytPlainData: LyricsData = {
          trackId: track.id,
          mode: "plain",
          lines: ytPlain,
          source: ytResult.footer || "YouTube Music",
        };
        cacheLyrics(cacheKey, ytPlainData);
        return ytPlainData;
      }
    }
  } catch {
    ytFailed = true;
  }

  if (ytFailed && lrcFailed) {
    throw new Error("Impossibile raggiungere i servizi testi in questo momento.");
  }

  const emptyData: LyricsData = {
    trackId: track.id,
    mode: "none",
    lines: [],
  };
  if (effectiveDuration > 0) {
    cacheLyrics(cacheKey, emptyData);
  }
  return emptyData;
}
