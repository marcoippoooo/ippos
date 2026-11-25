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
const LRCLIB_USER_AGENT = "Ippos/1.0.0 (macOS Desktop Client)";
const SYNC_LEAD_SECONDS = 0.12;

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
      /\s*[\(\[](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyrics?|hd|4k|remastered(?:\s*\d{4})?|explicit|radio\s*edit|feat\.?[^\)\]]*|ft\.?[^\)\]]*)[\)\]]/gi,
      "",
    )
    .replace(/\s+-\s+remastered.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function extractPrimaryArtist(artist: string): string {
  return artist
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b)\s*/i)[0]
    ?.trim() || artist.trim();
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
  const url = new URL(`${LRCLIB_BASE}/get`);
  url.searchParams.set("track_name", params.trackName);
  url.searchParams.set("artist_name", params.artistName);
  if (params.albumName) {
    url.searchParams.set("album_name", params.albumName);
  }
  if (params.durationSec && params.durationSec > 0) {
    url.searchParams.set("duration", String(Math.round(params.durationSec)));
  }

  const res = await tauriFetch(url.toString(), {
    headers: { "User-Agent": LRCLIB_USER_AGENT },
  });

  if (res.status === 404) {
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
    headers: { "User-Agent": LRCLIB_USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`LRCLIB search status ${res.status}`);
  }

  const results = (await res.json()) as LrcLibRecord[];
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const durationSec = params.durationSec ?? 0;
  const withSynced = results.filter(
    (r) => typeof r.syncedLyrics === "string" && r.syncedLyrics.trim().length > 0,
  );
  const pool = withSynced.length > 0 ? withSynced : results;

  if (durationSec > 0) {
    const scored = [...pool].sort((a, b) => {
      const diffA = a.duration ? Math.abs(a.duration - durationSec) : 9999;
      const diffB = b.duration ? Math.abs(b.duration - durationSec) : 9999;
      return diffA - diffB;
    });
    const best = scored[0];
    if (!best.duration || Math.abs(best.duration - durationSec) <= 15) {
      return best;
    }
  }

  return pool[0];
}

async function fetchFromLrcLib(
  track: Track,
  durationHint?: number,
): Promise<LrcLibRecord | null> {
  const durationSec =
    durationHint && durationHint > 0 ? durationHint : track.durationSeconds;

  const exact = await queryLrcLibGet({
    trackName: track.title,
    artistName: track.artist,
    albumName: track.album,
    durationSec,
  });
  if (exact) return exact;

  const cleanedTitle = cleanTrackTitle(track.title);
  const primaryArtist = extractPrimaryArtist(track.artist);

  if (cleanedTitle !== track.title || primaryArtist !== track.artist) {
    const cleaned = await queryLrcLibGet({
      trackName: cleanedTitle,
      artistName: primaryArtist,
      durationSec,
    });
    if (cleaned) return cleaned;
  }

  return queryLrcLibSearch({
    trackName: cleanedTitle || track.title,
    artistName: primaryArtist || track.artist,
    durationSec,
  });
}

export async function fetchLyricsForTrack(
  track: Track,
  durationHint?: number,
  priority: LyricsProviderPriority = "lrclib",
): Promise<LyricsData> {
  const cacheKey = `${track.id}::${priority}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let ytText: string | undefined;
  let ytFooter: string | undefined;
  let ytFailed = false;
  let lrcRecord: any = null;
  let lrcFailed = false;

  const tryYouTubeMusic = async (): Promise<LyricsData | null> => {
    try {
      const ytResult = await fetchYoutubeMusicLyrics(track.id);
      if (ytResult) {
        ytText = ytResult.text;
        ytFooter = ytResult.footer;
        const ytSynced = parseLrc(ytText);
        if (ytSynced.length >= 2) {
          return {
            trackId: track.id,
            mode: "synced",
            lines: ytSynced,
            source: ytFooter || "YouTube Music",
          };
        }
        if (priority === "ytmusic") {
          const ytPlain = parsePlainLyrics(ytText);
          if (ytPlain.length > 0) {
            return {
              trackId: track.id,
              mode: "plain",
              lines: ytPlain,
              source: ytFooter || "YouTube Music",
            };
          }
        }
      }
    } catch {
      ytFailed = true;
    }
    return null;
  };

  const tryLrcLib = async (): Promise<LyricsData | null> => {
    try {
      lrcRecord = await fetchFromLrcLib(track, durationHint);
    } catch {
      lrcFailed = true;
      return null;
    }

    if (lrcRecord?.syncedLyrics) {
      const syncedLines = parseLrc(lrcRecord.syncedLyrics);
      if (syncedLines.length > 0) {
        return {
          trackId: track.id,
          mode: "synced",
          lines: syncedLines,
          source: "LRCLIB • Sincronizzato",
        };
      }
    }
    return null;
  };

  if (priority === "lrclib") {
    const lrcSynced = await tryLrcLib();
    if (lrcSynced) {
      cacheLyrics(cacheKey, lrcSynced);
      return lrcSynced;
    }

    const ytSynced = await tryYouTubeMusic();
    if (ytSynced) {
      cacheLyrics(cacheKey, ytSynced);
      return ytSynced;
    }

    if (lrcRecord?.instrumental && !ytText) {
      const inst: LyricsData = {
        trackId: track.id,
        mode: "instrumental",
        lines: [],
        source: "LRCLIB",
      };
      cacheLyrics(cacheKey, inst);
      return inst;
    }

    if (lrcRecord?.plainLyrics) {
      const plainLines = parsePlainLyrics(lrcRecord.plainLyrics);
      if (plainLines.length > 0) {
        const plain: LyricsData = {
          trackId: track.id,
          mode: "plain",
          lines: plainLines,
          source: "LRCLIB",
        };
        cacheLyrics(cacheKey, plain);
        return plain;
      }
    }

    if (ytText) {
      const plainLines = parsePlainLyrics(ytText);
      if (plainLines.length > 0) {
        const plain: LyricsData = {
          trackId: track.id,
          mode: "plain",
          lines: plainLines,
          source: ytFooter || "YouTube Music",
        };
        cacheLyrics(cacheKey, plain);
        return plain;
      }
    }
  } else {
    const ytMatch = await tryYouTubeMusic();
    if (ytMatch) {
      cacheLyrics(cacheKey, ytMatch);
      return ytMatch;
    }

    const lrcSynced = await tryLrcLib();
    if (lrcSynced) {
      cacheLyrics(cacheKey, lrcSynced);
      return lrcSynced;
    }

    if (lrcRecord?.instrumental) {
      const inst: LyricsData = {
        trackId: track.id,
        mode: "instrumental",
        lines: [],
        source: "LRCLIB",
      };
      cacheLyrics(cacheKey, inst);
      return inst;
    }

    if (lrcRecord?.plainLyrics) {
      const plainLines = parsePlainLyrics(lrcRecord.plainLyrics);
      if (plainLines.length > 0) {
        const plain: LyricsData = {
          trackId: track.id,
          mode: "plain",
          lines: plainLines,
          source: "LRCLIB",
        };
        cacheLyrics(cacheKey, plain);
        return plain;
      }
    }
  }

  if (ytFailed && lrcFailed) {
    throw new Error("Impossibile raggiungere i servizi testi in questo momento.");
  }

  const emptyData: LyricsData = {
    trackId: track.id,
    mode: "none",
    lines: [],
  };
  cacheLyrics(cacheKey, emptyData);
  return emptyData;
}
