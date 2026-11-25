import { load, Store } from "@tauri-apps/plugin-store";
import {
  AppPreferences,
  AudioFormatPreference,
  AudioQualityLevel,
  CloseBehavior,
  LyricsFontPx,
  LyricsFontSize,
  LyricsLineHeight,
  LyricsProviderPriority,
  RepeatMode,
  SleepTimerFadeSeconds,
  ThemeDarkMode,
  Track,
  TrackArtist,
  TrackPlayStat,
  UserPlaylist,
  VibrancyIntensity,
} from "../types/music";

const STORE_FILENAME = "library.json";
const LOCAL_STORAGE_KEY = "ippos.library.v1";
const LEGACY_LOCAL_STORAGE_KEY = "archivetune.library.v1";
const SAVE_DEBOUNCE_MS = 350;
const MAX_RECENT_TRACKS = 50;
const MAX_PLAY_STATS = 200;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  dynamicThemeEnabled: true,
  vibrancyIntensity: "balanced",
  darkThemeMode: "dark",
  pureBlackOled: false,
  disableBlur: false,
  disableAnimations: false,
  closeBehavior: "tray",
  preferredAudioFormat: "mp4_aac",
  audioQuality: "max",
  preferOfficialAudio: true,
  lowDataMode: false,
  preloadNextTrack: true,
  contentLang: "it",
  contentCountry: "IT",
  saveListeningHistory: true,
  sleepTimerFadeSeconds: 10,
  lyricsProviderPriority: "lrclib",
  lyricsFontSize: "large",
  lyricsClickToSeek: true,
  lyricsAutoScroll: true,
  lyricsBlurInactive: true,
  lyricsFontPx: 26,
  lyricsLineHeight: 1.3,
  lyricsSyncOffsetSec: 0,
};

export interface PersistedSettings {
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface PersistedLibrary {
  likedTracks: Track[];
  recentTracks: Track[];
  playlists: UserPlaylist[];
  playStats: Record<string, TrackPlayStat>;
  preferences: AppPreferences;
  settings: PersistedSettings;
}

export const DEFAULT_PERSISTED_LIBRARY: PersistedLibrary = {
  likedTracks: [],
  recentTracks: [],
  playlists: [],
  playStats: {},
  preferences: DEFAULT_APP_PREFERENCES,
  settings: {
    volume: 0.8,
    shuffle: false,
    repeat: "off",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeTrack(raw: unknown): Track | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.title !== "string" || !raw.title.trim()) return null;
  if (typeof raw.artist !== "string") return null;
  if (typeof raw.cover !== "string") return null;

  const durationSeconds =
    typeof raw.durationSeconds === "number" &&
    Number.isFinite(raw.durationSeconds) &&
    raw.durationSeconds >= 0
      ? Math.round(raw.durationSeconds)
      : 0;

  const artistId =
    typeof raw.artistId === "string" && raw.artistId.trim()
      ? raw.artistId.trim()
      : undefined;

  let artists: TrackArtist[] | undefined;
  if (Array.isArray(raw.artists)) {
    const valid: TrackArtist[] = [];
    for (const entry of raw.artists) {
      if (!isRecord(entry) || typeof entry.name !== "string") continue;
      const name = entry.name.trim();
      if (!name) continue;
      const id =
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : undefined;
      valid.push({ name, id });
    }
    if (valid.length > 0) {
      artists = valid;
    }
  }

  return {
    id: raw.id,
    title: raw.title,
    artist: raw.artist || "Artista sconosciuto",
    artistId,
    artists,
    album: typeof raw.album === "string" && raw.album.trim() ? raw.album : undefined,
    duration: typeof raw.duration === "string" ? raw.duration : "",
    durationSeconds,
    cover: raw.cover,
    itemType:
      raw.itemType === "song" || raw.itemType === "video"
        ? raw.itemType
        : undefined,
    isExplicit: raw.isExplicit === true ? true : undefined,
  };
}

function sanitizeTrackArray(raw: unknown, limit?: number): Track[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const item of raw) {
    const track = sanitizeTrack(item);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
    if (limit && out.length >= limit) break;
  }
  return out;
}

function sanitizePlaylist(raw: unknown): UserPlaylist | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;

  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now();

  return {
    id: raw.id,
    name: raw.name.trim(),
    createdAt,
    tracks: sanitizeTrackArray(raw.tracks),
  };
}

function sanitizeSettings(raw: unknown): PersistedSettings {
  if (!isRecord(raw)) {
    return DEFAULT_PERSISTED_LIBRARY.settings;
  }
  const volume =
    typeof raw.volume === "number" && Number.isFinite(raw.volume)
      ? Math.max(0, Math.min(1, raw.volume))
      : DEFAULT_PERSISTED_LIBRARY.settings.volume;
  const shuffle =
    typeof raw.shuffle === "boolean"
      ? raw.shuffle
      : DEFAULT_PERSISTED_LIBRARY.settings.shuffle;
  const repeat: RepeatMode =
    raw.repeat === "off" || raw.repeat === "all" || raw.repeat === "one"
      ? raw.repeat
      : DEFAULT_PERSISTED_LIBRARY.settings.repeat;

  return { volume, shuffle, repeat };
}

function sanitizePlayStats(raw: unknown): Record<string, TrackPlayStat> {
  if (!isRecord(raw)) return {};
  const collected: TrackPlayStat[] = [];
  for (const value of Object.values(raw)) {
    if (!isRecord(value)) continue;
    const track = sanitizeTrack(value.track);
    if (!track) continue;
    const playCount =
      typeof value.playCount === "number" &&
      Number.isFinite(value.playCount) &&
      value.playCount >= 1
        ? Math.floor(value.playCount)
        : 1;
    const lastPlayedAt =
      typeof value.lastPlayedAt === "number" &&
      Number.isFinite(value.lastPlayedAt) &&
      value.lastPlayedAt >= 0
        ? value.lastPlayedAt
        : 0;
    const playTimestamps = Array.isArray(value.playTimestamps)
      ? value.playTimestamps
          .filter(
            (ts): ts is number =>
              typeof ts === "number" && Number.isFinite(ts) && ts > 0,
          )
          .slice(-60)
      : lastPlayedAt > 0
        ? [lastPlayedAt]
        : undefined;
    collected.push({ track, playCount, lastPlayedAt, playTimestamps });
  }

  collected.sort(
    (a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt,
  );

  const out: Record<string, TrackPlayStat> = {};
  for (const item of collected.slice(0, MAX_PLAY_STATS)) {
    if (!out[item.track.id]) {
      out[item.track.id] = item;
    }
  }
  return out;
}

export function validatePersistedLibrary(raw: unknown): PersistedLibrary {
  if (!isRecord(raw)) {
    return DEFAULT_PERSISTED_LIBRARY;
  }

  const playlistsRaw = Array.isArray(raw.playlists) ? raw.playlists : [];
  const seenPlaylists = new Set<string>();
  const playlists: UserPlaylist[] = [];
  for (const entry of playlistsRaw) {
    const pl = sanitizePlaylist(entry);
    if (!pl || seenPlaylists.has(pl.id)) continue;
    seenPlaylists.add(pl.id);
    playlists.push(pl);
  }

  return {
    likedTracks: sanitizeTrackArray(raw.likedTracks),
    recentTracks: sanitizeTrackArray(raw.recentTracks, MAX_RECENT_TRACKS),
    playlists,
    playStats: sanitizePlayStats(raw.playStats),
    preferences: sanitizePreferences(raw.preferences),
    settings: sanitizeSettings(raw.settings),
  };
}

function sanitizePreferences(raw: unknown): AppPreferences {
  if (!isRecord(raw)) {
    return DEFAULT_APP_PREFERENCES;
  }

  const dynamicThemeEnabled =
    typeof raw.dynamicThemeEnabled === "boolean"
      ? raw.dynamicThemeEnabled
      : DEFAULT_APP_PREFERENCES.dynamicThemeEnabled;

  const vibrancyIntensity: VibrancyIntensity =
    raw.vibrancyIntensity === "subtle" ||
    raw.vibrancyIntensity === "balanced" ||
    raw.vibrancyIntensity === "vivid"
      ? raw.vibrancyIntensity
      : DEFAULT_APP_PREFERENCES.vibrancyIntensity;

  const closeBehavior: CloseBehavior =
    raw.closeBehavior === "tray" || raw.closeBehavior === "quit"
      ? raw.closeBehavior
      : DEFAULT_APP_PREFERENCES.closeBehavior;

  const preferredAudioFormat: AudioFormatPreference =
    raw.preferredAudioFormat === "mp4_aac" ||
    raw.preferredAudioFormat === "webm_opus"
      ? raw.preferredAudioFormat
      : DEFAULT_APP_PREFERENCES.preferredAudioFormat;

  const sleepTimerFadeSeconds: SleepTimerFadeSeconds =
    raw.sleepTimerFadeSeconds === 5 ||
    raw.sleepTimerFadeSeconds === 10 ||
    raw.sleepTimerFadeSeconds === 15 ||
    raw.sleepTimerFadeSeconds === 20
      ? raw.sleepTimerFadeSeconds
      : DEFAULT_APP_PREFERENCES.sleepTimerFadeSeconds;

  const lyricsProviderPriority: LyricsProviderPriority =
    raw.lyricsProviderPriority === "lrclib" ||
    raw.lyricsProviderPriority === "ytmusic"
      ? raw.lyricsProviderPriority
      : DEFAULT_APP_PREFERENCES.lyricsProviderPriority;

  const lyricsFontSize: LyricsFontSize =
    raw.lyricsFontSize === "normal" ||
    raw.lyricsFontSize === "large" ||
    raw.lyricsFontSize === "xlarge"
      ? raw.lyricsFontSize
      : DEFAULT_APP_PREFERENCES.lyricsFontSize;

  const darkThemeMode: ThemeDarkMode =
    raw.darkThemeMode === "system" || raw.darkThemeMode === "dark"
      ? raw.darkThemeMode
      : DEFAULT_APP_PREFERENCES.darkThemeMode;

  const pureBlackOled =
    typeof raw.pureBlackOled === "boolean"
      ? raw.pureBlackOled
      : DEFAULT_APP_PREFERENCES.pureBlackOled;

  const disableBlur =
    typeof raw.disableBlur === "boolean"
      ? raw.disableBlur
      : DEFAULT_APP_PREFERENCES.disableBlur;

  const disableAnimations =
    typeof raw.disableAnimations === "boolean"
      ? raw.disableAnimations
      : DEFAULT_APP_PREFERENCES.disableAnimations;

  const audioQuality: AudioQualityLevel =
    raw.audioQuality === "max" ||
    raw.audioQuality === "high" ||
    raw.audioQuality === "normal"
      ? raw.audioQuality
      : DEFAULT_APP_PREFERENCES.audioQuality;

  const preferOfficialAudio =
    typeof raw.preferOfficialAudio === "boolean"
      ? raw.preferOfficialAudio
      : DEFAULT_APP_PREFERENCES.preferOfficialAudio;

  const lowDataMode =
    typeof raw.lowDataMode === "boolean"
      ? raw.lowDataMode
      : DEFAULT_APP_PREFERENCES.lowDataMode;

  const preloadNextTrack =
    typeof raw.preloadNextTrack === "boolean"
      ? raw.preloadNextTrack
      : DEFAULT_APP_PREFERENCES.preloadNextTrack;

  const contentLang =
    typeof raw.contentLang === "string" && /^[a-z]{2}$/i.test(raw.contentLang.trim())
      ? raw.contentLang.trim().toLowerCase()
      : DEFAULT_APP_PREFERENCES.contentLang;

  const contentCountry =
    typeof raw.contentCountry === "string" &&
    /^[A-Z]{2}$/i.test(raw.contentCountry.trim())
      ? raw.contentCountry.trim().toUpperCase()
      : DEFAULT_APP_PREFERENCES.contentCountry;

  const saveListeningHistory =
    typeof raw.saveListeningHistory === "boolean"
      ? raw.saveListeningHistory
      : DEFAULT_APP_PREFERENCES.saveListeningHistory;

  const lyricsClickToSeek =
    typeof raw.lyricsClickToSeek === "boolean"
      ? raw.lyricsClickToSeek
      : DEFAULT_APP_PREFERENCES.lyricsClickToSeek;

  const lyricsAutoScroll =
    typeof raw.lyricsAutoScroll === "boolean"
      ? raw.lyricsAutoScroll
      : DEFAULT_APP_PREFERENCES.lyricsAutoScroll;

  const lyricsBlurInactive =
    typeof raw.lyricsBlurInactive === "boolean"
      ? raw.lyricsBlurInactive
      : DEFAULT_APP_PREFERENCES.lyricsBlurInactive;

  const lyricsFontPx: LyricsFontPx =
    raw.lyricsFontPx === 20 ||
    raw.lyricsFontPx === 24 ||
    raw.lyricsFontPx === 26 ||
    raw.lyricsFontPx === 30
      ? raw.lyricsFontPx
      : DEFAULT_APP_PREFERENCES.lyricsFontPx;

  const lyricsLineHeight: LyricsLineHeight =
    raw.lyricsLineHeight === 1.2 ||
    raw.lyricsLineHeight === 1.3 ||
    raw.lyricsLineHeight === 1.5
      ? raw.lyricsLineHeight
      : DEFAULT_APP_PREFERENCES.lyricsLineHeight;

  const lyricsSyncOffsetSec =
    typeof raw.lyricsSyncOffsetSec === "number" &&
    Number.isFinite(raw.lyricsSyncOffsetSec)
      ? Math.max(
          -5,
          Math.min(5, Math.round(raw.lyricsSyncOffsetSec * 10) / 10),
        )
      : DEFAULT_APP_PREFERENCES.lyricsSyncOffsetSec;

  return {
    dynamicThemeEnabled,
    vibrancyIntensity,
    darkThemeMode,
    pureBlackOled,
    disableBlur,
    disableAnimations,
    closeBehavior,
    preferredAudioFormat,
    audioQuality,
    preferOfficialAudio,
    lowDataMode,
    preloadNextTrack,
    contentLang,
    contentCountry,
    saveListeningHistory,
    sleepTimerFadeSeconds,
    lyricsProviderPriority,
    lyricsFontSize,
    lyricsClickToSeek,
    lyricsAutoScroll,
    lyricsBlurInactive,
    lyricsFontPx,
    lyricsLineHeight,
    lyricsSyncOffsetSec,
  };
}

let tauriStorePromise: Promise<Store | null> | null = null;
let saveTimer: number | null = null;

async function getTauriStore(): Promise<Store | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  if (!tauriStorePromise) {
    tauriStorePromise = load(STORE_FILENAME, {
      autoSave: false,
      defaults: {},
    }).catch(() => null);
  }
  return tauriStorePromise;
}

export async function loadPersistedLibrary(): Promise<PersistedLibrary> {
  try {
    const store = await getTauriStore();
    if (store) {
      const [liked, recent, playlists, playStats, preferences, settings] =
        await Promise.all([
          store.get<unknown>("likedTracks"),
          store.get<unknown>("recentTracks"),
          store.get<unknown>("playlists"),
          store.get<unknown>("playStats"),
          store.get<unknown>("preferences"),
          store.get<unknown>("settings"),
        ]);
      return validatePersistedLibrary({
        likedTracks: liked,
        recentTracks: recent,
        playlists,
        playStats,
        preferences,
        settings,
      });
    }

    const raw =
      window.localStorage.getItem(LOCAL_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_PERSISTED_LIBRARY;
    const validated = validatePersistedLibrary(JSON.parse(raw));
    if (!window.localStorage.getItem(LOCAL_STORAGE_KEY)) {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(validated));
    }
    return validated;
  } catch {
    return DEFAULT_PERSISTED_LIBRARY;
  }
}

async function writeLibraryNow(data: PersistedLibrary): Promise<void> {
  try {
    const store = await getTauriStore();
    if (store) {
      await Promise.all([
        store.set("likedTracks", data.likedTracks),
        store.set("recentTracks", data.recentTracks),
        store.set("playlists", data.playlists),
        store.set("playStats", data.playStats),
        store.set("preferences", data.preferences),
        store.set("settings", data.settings),
      ]);
      await store.save();
      return;
    }

    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Non bloccare mai la UI per errori di I/O su disco
  }
}

export function scheduleLibrarySave(data: PersistedLibrary): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void writeLibraryNow(data);
  }, SAVE_DEBOUNCE_MS);
}
