import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Crown,
  Database,
  Disc3,
  Download,
  FolderOpen,
  Gamepad2,
  Globe,
  HardDrive,
  Info,
  Keyboard,
  Loader2,
  LogIn,
  LogOut,
  Music,
  Palette,
  Play,
  Quote,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  SlidersVertical,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import {
  clearPaletteCache,
  getPaletteCacheStats,
} from "../services/colorExtractor";
import { validatePersistedLibrary } from "../services/libraryStorage";
import { clearLyricsCache, getLyricsCacheStats } from "../services/lyricsService";
import {
  clearMusicCaches,
  getMusicCacheStats,
  invalidateAudioStreamCache,
  parseArtistsFromString,
} from "../services/ytmusic";
import { EQUALIZER_PRESETS } from "../services/audioEngine";
import { usePlayerStore } from "../store/playerStore";
import { useToastStore } from "../store/toastStore";
import {
  AudioFormatPreference,
  AudioQualityLevel,
  CloseBehavior,
  LyricsFontPx,
  LyricsLineHeight,
  LyricsProviderPriority,
  SleepTimerFadeSeconds,
  ThemeDarkMode,
  TrackPlayStat,
  VibrancyIntensity,
} from "../types/music";
import { formatTime } from "../utils/formatTime";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerPanel } from "./EqualizerPanel";
import { ExpressiveSlider } from "./ExpressiveSlider";
import { ScallopedArtwork } from "./ScallopedArtwork";
import {
  M3ExpressiveSwitch,
  ScallopedWatermark,
  ShapedIconBadge,
  WavyBar,
} from "./SettingsPrimitives";

interface SettingsViewProps {
  onLogin: () => void;
  onLogout: () => void;
}

type SettingsSection =
  | "main"
  | "appearance"
  | "playback"
  | "equalizer"
  | "lyrics"
  | "stats"
  | "storage"
  | "media"
  | "content"
  | "behavior"
  | "about";

type StatsTimeRange = "continuous" | "week" | "month" | "quarter" | "all";

const SECTION_TITLES: Record<SettingsSection, string> = {
  main: "Impostazioni",
  appearance: "Aspetto",
  playback: "Lettore e audio",
  equalizer: "Equalizzatore Audio",
  lyrics: "Testi",
  stats: "Statistiche",
  storage: "Stoccaggio e cache",
  media: "IPPOS Island & Media Player",
  content: "Contenuto",
  behavior: "Comportamento",
  about: "Informazioni su IPPOS",
};

const VIBRANCY_OPTIONS: {
  id: VibrancyIntensity;
  label: string;
  index: number;
}[] = [
  { id: "subtle", label: "Sottile", index: 0 },
  { id: "balanced", label: "Bilanciato", index: 1 },
  { id: "vivid", label: "Vivido", index: 2 },
];

const DARK_THEME_OPTIONS: { id: ThemeDarkMode; label: string }[] = [
  { id: "system", label: "Segui il sistema" },
  { id: "dark", label: "Scuro" },
];

const AUDIO_QUALITY_OPTIONS: {
  id: AudioQualityLevel;
  label: string;
  badge: string;
}[] = [
  { id: "max", label: "Massima", badge: "Lossless-grade AAC/Opus" },
  { id: "high", label: "Alta", badge: "~160 kbps" },
  { id: "normal", label: "Normale", badge: "Risparmio banda" },
];

const AUDIO_FORMAT_OPTIONS: {
  id: AudioFormatPreference;
  label: string;
  detail: string;
}[] = [
  {
    id: "mp4_aac",
    label: "audio/mp4 · AAC (140)",
    detail: "Decodifica hardware macOS",
  },
  {
    id: "webm_opus",
    label: "audio/webm · Opus",
    detail: "Alta efficienza WebM",
  },
];

const CLOSE_BEHAVIOR_OPTIONS: {
  id: CloseBehavior;
  label: string;
  hint: string;
}[] = [
  {
    id: "tray",
    label: "Minimizza nella Menu Bar (Tray)",
    hint: "Continua l'ascolto in background",
  },
  {
    id: "quit",
    label: "Chiudi IPPOS",
    hint: "Arresta audio e chiude la finestra",
  },
];

const SLEEP_FADE_OPTIONS: SleepTimerFadeSeconds[] = [5, 10, 15, 20];

const LYRICS_MODE_OPTIONS: {
  id: LyricsProviderPriority;
  label: string;
  badge: string;
}[] = [
  { id: "lrclib", label: "Enhanced / LRCLIB", badge: "Sincronizzato" },
  { id: "ytmusic", label: "Standard / YouTube Music", badge: "Catalogo" },
];

const LYRICS_FONT_PX_OPTIONS: LyricsFontPx[] = [20, 24, 26, 30];
const LYRICS_LINE_HEIGHT_OPTIONS: LyricsLineHeight[] = [1.2, 1.3, 1.5];

const STATS_RANGES: { id: StatsTimeRange; label: string; windowMs: number | null }[] = [
  { id: "continuous", label: "Continuo", windowMs: 24 * 60 * 60 * 1000 },
  { id: "week", label: "1 settimana", windowMs: 7 * 24 * 60 * 60 * 1000 },
  { id: "month", label: "1 mese", windowMs: 30 * 24 * 60 * 60 * 1000 },
  { id: "quarter", label: "3 mesi", windowMs: 90 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "Tutto", windowMs: null },
];

const CONTENT_LANGUAGES = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
];

const CONTENT_COUNTRIES = [
  { code: "IT", label: "Italia" },
  { code: "US", label: "Stati Uniti" },
  { code: "GB", label: "Regno Unito" },
  { code: "DE", label: "Germania" },
  { code: "FR", label: "Francia" },
];

function formatBytesReadable(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTotalMinutesHero(seconds: number): {
  headline: string;
  unit: string;
  exact: string;
} {
  const safe = Math.max(0, Math.round(seconds));
  const totalMins = Math.floor(safe / 60);
  if (totalMins >= 60) {
    const hours = (safe / 3600).toFixed(1).replace(".0", "");
    return {
      headline: hours,
      unit: Number(hours) === 1 ? "ora" : "ore",
      exact: formatTime(safe),
    };
  }
  return {
    headline: String(totalMins),
    unit: totalMins === 1 ? "minuto" : "minuti",
    exact: formatTime(safe),
  };
}

export function SettingsView({ onLogin, onLogout }: SettingsViewProps) {
  const authStatus = usePlayerStore((s) => s.authStatus);
  const authUser = usePlayerStore((s) => s.authUser);
  const preferences = usePlayerStore((s) => s.preferences);
  const playStats = usePlayerStore((s) => s.playStats);
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const recentTracks = usePlayerStore((s) => s.recentTracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const downloadedTrackIds = usePlayerStore((s) => s.downloadedTrackIds);
  const offlineCacheRevision = usePlayerStore((s) => s.offlineCacheRevision);
  const volume = usePlayerStore((s) => s.volume);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const autoplayEnabled = usePlayerStore((s) => s.autoplayEnabled);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackStatus = usePlayerStore((s) => s.playbackStatus);

  const updatePreferences = usePlayerStore((s) => s.updatePreferences);
  const setAutoplayEnabled = usePlayerStore((s) => s.setAutoplayEnabled);
  const clearPlayStats = usePlayerStore((s) => s.clearPlayStats);
  const clearRecentTracks = usePlayerStore((s) => s.clearRecentTracks);
  const clearAllDownloadedTracks = usePlayerStore(
    (s) => s.clearAllDownloadedTracks,
  );
  const hydrateLibrary = usePlayerStore((s) => s.hydrateLibrary);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const openArtist = usePlayerStore((s) => s.openArtist);
  const showToast = useToastStore((s) => s.showToast);

  const [section, setSection] = useState<SettingsSection>("main");
  const [statsRange, setStatsRange] = useState<StatsTimeRange>("all");
  const [confirmResetStats, setConfirmResetStats] = useState(false);
  const [cacheNonce, setCacheNonce] = useState(0);
  const [offlineCacheStats, setOfflineCacheStats] = useState<{
    totalBytes: number;
    trackCount: number;
    cacheDir: string;
  }>({
    totalBytes: 0,
    trackCount: 0,
    cacheDir: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<{
      totalBytes: number;
      trackCount: number;
      cacheDir: string;
    }>("get_offline_cache_stats")
      .then((res) => {
        if (!cancelled && res && typeof res.totalBytes === "number") {
          setOfflineCacheStats(res);
        }
      })
      .catch(() => {
        // Ignore outside Tauri runtime
      });
    return () => {
      cancelled = true;
    };
  }, [offlineCacheRevision, cacheNonce, section]);

  const displayName = authUser?.name || "Account Google";
  const vibrancyIndex =
    VIBRANCY_OPTIONS.find((opt) => opt.id === preferences.vibrancyIntensity)
      ?.index ?? 1;

  // Statistiche reali filtrate per intervallo temporale
  const statsSummary = useMemo(() => {
    const rangeCfg = STATS_RANGES.find((r) => r.id === statsRange);
    const cutoff =
      rangeCfg?.windowMs !== null && rangeCfg?.windowMs !== undefined
        ? Date.now() - rangeCfg.windowMs
        : 0;

    const computedEntries: TrackPlayStat[] = [];
    for (const entry of Object.values(playStats)) {
      if (cutoff === 0) {
        computedEntries.push(entry);
        continue;
      }
      const timestamps = entry.playTimestamps;
      if (timestamps && timestamps.length > 0) {
        const recentCount = timestamps.filter((ts) => ts >= cutoff).length;
        if (recentCount > 0) {
          computedEntries.push({
            ...entry,
            playCount: recentCount,
          });
        }
      } else if (entry.lastPlayedAt >= cutoff) {
        computedEntries.push(entry);
      }
    }

    computedEntries.sort(
      (a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt,
    );

    let totalPlays = 0;
    let totalSeconds = 0;
    const artistMap = new Map<
      string,
      { name: string; id?: string; plays: number }
    >();
    const albumSet = new Set<string>();

    for (const entry of computedEntries) {
      totalPlays += entry.playCount;
      const trackDur =
        entry.track.durationSeconds > 0 ? entry.track.durationSeconds : 210;
      totalSeconds += trackDur * entry.playCount;

      if (entry.track.album?.trim()) {
        albumSet.add(entry.track.album.trim().toLowerCase());
      }

      const primaryArtist =
        entry.track.artists?.[0] ??
        parseArtistsFromString(entry.track.artist)[0];
      const rawName = primaryArtist?.name?.trim() || entry.track.artist.trim();
      if (!rawName || rawName === "Artista sconosciuto") continue;

      const key = rawName.toLowerCase();
      const existing = artistMap.get(key);
      if (existing) {
        existing.plays += entry.playCount;
        if (!existing.id && (primaryArtist?.id || entry.track.artistId)) {
          existing.id = primaryArtist?.id || entry.track.artistId;
        }
      } else {
        artistMap.set(key, {
          name: rawName,
          id: primaryArtist?.id || entry.track.artistId,
          plays: entry.playCount,
        });
      }
    }

    const topArtists = Array.from(artistMap.values())
      .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name, "it"))
      .slice(0, 5);

    return {
      totalPlays,
      uniqueTracks: computedEntries.length,
      uniqueArtists: artistMap.size,
      uniqueAlbums: albumSet.size,
      totalSeconds,
      heroTime: formatTotalMinutesHero(totalSeconds),
      topTracks: computedEntries.slice(0, 5),
      allSortedTracks: computedEntries.map((e) => e.track),
      topArtists,
      maxArtistPlays: topArtists[0]?.plays ?? 1,
      rangeLabel: rangeCfg?.label ?? "Tutto",
    };
  }, [playStats, statsRange]);

  // Calcolo stoccaggio e cache locali reali
  const storageStats = useMemo(() => {
    void cacheNonce;
    const music = getMusicCacheStats();
    const palettes = getPaletteCacheStats();
    const lyrics = getLyricsCacheStats();

    const libraryJson = JSON.stringify({
      likedTracks,
      recentTracks,
      playlists,
      playStats,
      preferences,
    });
    const libraryBytes = new TextEncoder().encode(libraryJson).length;

    const tracksCacheBytes = music.streamBytes;
    const offlineAudioBytes = offlineCacheStats.totalBytes;
    const imagesCacheBytes = palettes.estimatedBytes + music.metadataBytes;
    const lyricsCacheBytes = lyrics.estimatedBytes;
    const totalBytes = Math.max(
      1,
      tracksCacheBytes +
        offlineAudioBytes +
        imagesCacheBytes +
        lyricsCacheBytes +
        libraryBytes,
    );

    return {
      totalBytes,
      tracksCacheBytes,
      offlineAudioBytes,
      offlineAudioTracks: offlineCacheStats.trackCount,
      offlineAudioDir: offlineCacheStats.cacheDir,
      imagesCacheBytes,
      lyricsCacheBytes,
      libraryBytes,
      streamEntries: music.streamEntries,
      paletteEntries: palettes.entries,
      lyricsEntries: lyrics.entries,
    };
  }, [
    cacheNonce,
    likedTracks,
    recentTracks,
    playlists,
    playStats,
    preferences,
    offlineCacheStats,
  ]);

  const handleExportBackup = () => {
    const payload = {
      app: "IPPOS",
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      data: {
        likedTracks,
        recentTracks,
        playlists,
        playStats,
        downloadedTrackIds,
        preferences,
        settings: { volume, shuffle, repeat, autoplayEnabled },
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ippos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup locale esportato in JSON");
  };

  const handleImportBackup = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { data?: unknown };
      const rawLibrary = parsed?.data ?? parsed;
      const validated = validatePersistedLibrary(rawLibrary);
      hydrateLibrary(validated);
      showToast("Backup ripristinato con successo");
    } catch {
      showToast("File di backup JSON non valido");
    }
  };

  const renderSectionHeader = () => (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {section !== "main" && (
          <button
            type="button"
            onClick={() => setSection("main")}
            aria-label="Torna alle Impostazioni"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-110 active:scale-95 transition shrink-0 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.88)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
              color: "rgb(var(--md-on-surface-rgb))",
            }}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <h1
          className="text-[28px] font-bold tracking-[-0.03em] truncate"
          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
        >
          {SECTION_TITLES[section]}
        </h1>
      </div>

      <div
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-medium shrink-0 at-tonal"
        style={{
          backgroundColor: "rgb(var(--md-secondary-container-rgb) / 0.85)",
          border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
          color: "rgb(var(--md-on-secondary-container-rgb))",
        }}
      >
        <Cpu className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="hidden sm:inline">
          IPPOS macOS v1.0.0 — Architettura nativa Apple Silicon
        </span>
        <span className="sm:hidden">IPPOS v1.0.0</span>
      </div>
    </div>
  );

  const renderListItemCard = ({
    icon,
    shape,
    badgeBg,
    badgeFg,
    title,
    subtitle,
    trailing,
    onClick,
  }: {
    icon: React.ReactNode;
    shape: "scalloped" | "clover" | "cloud" | "circle";
    badgeBg: string;
    badgeFg: string;
    title: string;
    subtitle: string;
    trailing?: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-3.5 flex items-center justify-between gap-4 text-left hover:bg-white/[0.04] transition-colors cursor-pointer group"
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <ShapedIconBadge
          shape={shape}
          bgColor={badgeBg}
          fgColor={badgeFg}
          size={40}
        >
          {icon}
        </ShapedIconBadge>
        <div className="min-w-0">
          <p
            className="text-[14px] font-semibold truncate"
            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
          >
            {title}
          </p>
          <p
            className="text-[12px] truncate"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {trailing}
        <ChevronRight
          className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform"
          style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
        />
      </div>
    </button>
  );

  return (
    <div className="max-w-5xl space-y-6 pb-12">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => void handleImportBackup(e)}
      />

      {renderSectionHeader()}

      {/* ============================================================
          SCHERMATA PRINCIPALE (main)
         ============================================================ */}
      {section === "main" && (
        <div className="space-y-7 at-view-fade">
          {/* Card Account in testata con gradiente blu/viola e forme decorative */}
          <section
            className="relative rounded-[28px] overflow-hidden p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5 at-tonal"
            style={{
              background:
                "linear-gradient(135deg, rgb(42 54 114 / 0.92), rgb(69 44 110 / 0.92))",
              border: "1px solid rgb(138 148 232 / 0.30)",
            }}
          >
            <ScallopedWatermark className="absolute -right-8 -top-10 w-52 h-52 text-indigo-300/10" />
            <ScallopedWatermark className="absolute left-1/3 -bottom-16 w-40 h-40 text-purple-300/10" />

            <div className="relative z-10 flex items-center gap-4 min-w-0">
              <ScallopedArtwork
                src={
                  authStatus === "authenticated" ? authUser?.avatar : undefined
                }
                alt={authStatus === "authenticated" ? displayName : "Ospite"}
                size={72}
                variant="cookie10"
                active={authStatus === "authenticated"}
                fallback={
                  authStatus === "authenticated" ? (
                    <span className="w-full h-full flex items-center justify-center text-[24px] font-bold bg-indigo-400 text-slate-950">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  ) : (
                    <UserRound className="w-7 h-7 text-indigo-200/80" />
                  )
                }
              />

              <div className="min-w-0 space-y-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wide bg-white/15 text-indigo-100">
                  {authStatus === "authenticated"
                    ? "Account collegato"
                    : authStatus === "authenticating"
                      ? "Accesso in corso"
                      : "Ospite"}
                </span>

                <h2 className="text-[20px] font-bold tracking-tight text-white truncate">
                  {authStatus === "authenticated"
                    ? displayName
                    : "Benvenuto su IPPOS"}
                </h2>

                <p className="text-[12.5px] text-indigo-100/80 truncate">
                  {authStatus === "authenticated"
                    ? authUser?.handle || "@account-ytmusic"
                    : "Accedi con Google per sincronizzare playlist e preferiti"}
                </p>
              </div>
            </div>

            <div className="relative z-10 flex flex-wrap items-center gap-2 shrink-0">
              {authStatus === "authenticated" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSection("content")}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[12.5px] font-semibold bg-white text-indigo-950 hover:bg-indigo-50 transition active:scale-95"
                  >
                    Gestisci account
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[12.5px] font-semibold bg-black/30 text-white hover:bg-black/45 border border-white/15 transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Disconnetti
                  </button>
                </>
              ) : authStatus === "authenticating" ? (
                <button
                  type="button"
                  onClick={onLogin}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[12.5px] font-semibold bg-white/20 text-white"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Completa nella finestra Google...
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onLogin}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold bg-white text-indigo-950 hover:bg-indigo-50 shadow-md transition active:scale-95"
                >
                  <LogIn className="w-4 h-4" />
                  Accedi con Google
                </button>
              )}
            </div>
          </section>

          {/* Sezione Essentials (Griglia Bento 2x2 colorata) */}
          <section className="space-y-3">
            <h2
              className="text-[12.5px] font-semibold uppercase tracking-[0.08em] px-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Essentials
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 1. Aspetto (Blu Indaco) */}
              <button
                type="button"
                onClick={() => setSection("appearance")}
                className="group relative overflow-hidden rounded-[26px] p-5 text-left flex flex-col justify-between gap-5 min-h-[152px] hover:brightness-110 transition-all active:scale-[0.99] cursor-pointer"
                style={{
                  background:
                    "linear-gradient(145deg, rgb(41 58 118 / 0.92), rgb(31 43 89 / 0.92))",
                  border: "1px solid rgb(129 152 248 / 0.28)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <ShapedIconBadge
                    shape="scalloped"
                    bgColor="rgb(99 124 235)"
                    fgColor="#ffffff"
                    size={46}
                  >
                    <Palette className="w-5 h-5" />
                  </ShapedIconBadge>
                  <ChevronRight className="w-4 h-4 text-indigo-200/70 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white">Aspetto</h3>
                  <p className="text-[12.5px] text-indigo-100/80 mt-0.5">
                    Temi, layout e stile visivo
                  </p>
                </div>
              </button>

              {/* 2. Playback (Viola/Malva) */}
              <button
                type="button"
                onClick={() => setSection("playback")}
                className="group relative overflow-hidden rounded-[26px] p-5 text-left flex flex-col justify-between gap-5 min-h-[152px] hover:brightness-110 transition-all active:scale-[0.99] cursor-pointer"
                style={{
                  background:
                    "linear-gradient(145deg, rgb(79 44 102 / 0.92), rgb(59 32 78 / 0.92))",
                  border: "1px solid rgb(192 132 252 / 0.28)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <ShapedIconBadge
                    shape="clover"
                    bgColor="rgb(168 85 247)"
                    fgColor="#ffffff"
                    size={46}
                  >
                    <Music className="w-5 h-5" />
                  </ShapedIconBadge>
                  <ChevronRight className="w-4 h-4 text-purple-200/70 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white">Playback</h3>
                  <p className="text-[12.5px] text-purple-100/80 mt-0.5">
                    Comportamento audio, qualità e background
                  </p>
                </div>
              </button>

              {/* 3. Testi (Grigio-blu scuro) */}
              <button
                type="button"
                onClick={() => setSection("lyrics")}
                className="group relative overflow-hidden rounded-[26px] p-5 text-left flex flex-col justify-between gap-5 min-h-[152px] hover:brightness-110 transition-all active:scale-[0.99] cursor-pointer"
                style={{
                  background:
                    "linear-gradient(145deg, rgb(42 58 72 / 0.94), rgb(31 44 56 / 0.94))",
                  border: "1px solid rgb(125 166 196 / 0.26)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <ShapedIconBadge
                    shape="scalloped"
                    bgColor="rgb(74 134 168)"
                    fgColor="#ffffff"
                    size={46}
                  >
                    <Quote className="w-5 h-5" />
                  </ShapedIconBadge>
                  <ChevronRight className="w-4 h-4 text-sky-200/70 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white">Testi</h3>
                  <p className="text-[12.5px] text-sky-100/75 mt-0.5">
                    Provider testi, stile e sincronizzazione
                  </p>
                </div>
              </button>

              {/* 4. Statistiche (Antracite) */}
              <button
                type="button"
                onClick={() => setSection("stats")}
                className="group relative overflow-hidden rounded-[26px] p-5 text-left flex flex-col justify-between gap-5 min-h-[152px] hover:brightness-110 transition-all active:scale-[0.99] cursor-pointer"
                style={{
                  background:
                    "linear-gradient(145deg, rgb(44 45 52 / 0.96), rgb(31 32 38 / 0.96))",
                  border: "1px solid rgb(140 144 160 / 0.25)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <ShapedIconBadge
                    shape="cloud"
                    bgColor="rgb(100 105 124)"
                    fgColor="#ffffff"
                    size={46}
                  >
                    <BarChart3 className="w-5 h-5" />
                  </ShapedIconBadge>
                  <ChevronRight className="w-4 h-4 text-zinc-300/70 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div>
                  <h3 className="text-[17px] font-bold text-white">
                    Statistiche
                  </h3>
                  <p className="text-[12.5px] text-zinc-300/80 mt-0.5">
                    Brani più ascoltati, artisti e tempo totale
                  </p>
                </div>
              </button>
            </div>
          </section>

          {/* Sezione Player e contenuto */}
          <section className="space-y-2.5">
            <h2
              className="text-[12.5px] font-semibold uppercase tracking-[0.08em] px-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Player e contenuto
            </h2>
            <div
              className="rounded-3xl overflow-hidden divide-y divide-white/[0.06] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              }}
            >
              {renderListItemCard({
                icon: <SlidersVertical className="w-4 h-4" />,
                shape: "clover",
                badgeBg: "rgb(239 68 68 / 0.2)",
                badgeFg: "rgb(252 165 165)",
                title: "Equalizzatore Audio",
                subtitle: "5 bande parametriche (60 Hz – 12 kHz) e preset salvati",
                trailing: (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      preferences.equalizer.enabled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-white/[0.06] text-zinc-400"
                    }`}
                  >
                    {preferences.equalizer.enabled
                      ? preferences.equalizer.preset === "custom"
                        ? "Custom"
                        : EQUALIZER_PRESETS[preferences.equalizer.preset].label
                      : "Bypass"}
                  </span>
                ),
                onClick: () => setSection("equalizer"),
              })}
              {renderListItemCard({
                icon: <Radio className="w-4 h-4" />,
                shape: "scalloped",
                badgeBg: "rgb(var(--md-primary-container-rgb))",
                badgeFg: "rgb(var(--md-accent-primary-rgb))",
                title: "IPPOS Island & Media Player",
                subtitle: "Stato bridge macOS, controlli nel notch e notifiche di sistema",
                trailing: (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300">
                    Attivo
                  </span>
                ),
                onClick: () => setSection("media"),
              })}
              {renderListItemCard({
                icon: <Globe className="w-4 h-4" />,
                shape: "clover",
                badgeBg: "rgb(var(--md-secondary-container-rgb))",
                badgeFg: "rgb(var(--md-on-secondary-container-rgb))",
                title: "Contenuto",
                subtitle: `Lingua (${preferences.contentLang.toUpperCase()}), paese (${preferences.contentCountry}) e preferenze consigliati`,
                onClick: () => setSection("content"),
              })}
              {renderListItemCard({
                icon: <SlidersHorizontal className="w-4 h-4" />,
                shape: "circle",
                badgeBg: "rgb(var(--md-surface-container-high-rgb))",
                badgeFg: "rgb(var(--md-on-surface-rgb))",
                title: "Comportamento",
                subtitle: "Cronologia di ascolto e chiusura finestra (Tray vs Esci)",
                onClick: () => setSection("behavior"),
              })}
              <div className="px-4 py-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <ShapedIconBadge
                    shape="clover"
                    bgColor="rgb(88 101 242)"
                    fgColor="#ffffff"
                    size={40}
                  >
                    <Gamepad2 className="w-4 h-4" />
                  </ShapedIconBadge>
                  <div className="min-w-0">
                    <p
                      className="text-[14px] font-semibold truncate"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Condividi stato su Discord
                    </p>
                    <p
                      className="text-[12px] truncate"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      Mostra brano corrente, artista e copertina su Discord Rich Presence
                    </p>
                  </div>
                </div>
                <M3ExpressiveSwitch
                  checked={preferences.discordRichPresenceEnabled}
                  onChange={(val) =>
                    updatePreferences({ discordRichPresenceEnabled: val })
                  }
                  ariaLabel="Condividi stato su Discord"
                />
              </div>
            </div>
          </section>

          {/* Sezione Stoccaggio */}
          <section className="space-y-2.5">
            <h2
              className="text-[12.5px] font-semibold uppercase tracking-[0.08em] px-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Stoccaggio
            </h2>
            <div
              className="rounded-3xl overflow-hidden divide-y divide-white/[0.06] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              }}
            >
              {renderListItemCard({
                icon: <HardDrive className="w-4 h-4" />,
                shape: "cloud",
                badgeBg: "rgb(45 78 134)",
                badgeFg: "#ffffff",
                title: "Stoccaggio",
                subtitle: "Cache, spazio occupato e pulizia",
                trailing: (
                  <span
                    className="text-[12px] font-semibold tabular-nums"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {formatBytesReadable(storageStats.totalBytes)}
                  </span>
                ),
                onClick: () => setSection("storage"),
              })}

              <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <ShapedIconBadge
                    shape="clover"
                    bgColor="rgb(16 185 129 / 0.2)"
                    fgColor="rgb(110 231 183)"
                    size={40}
                  >
                    <Download className="w-4 h-4" />
                  </ShapedIconBadge>
                  <div className="min-w-0">
                    <p
                      className="text-[14px] font-semibold"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Spazio di archiviazione cache
                    </p>
                    <p
                      className="text-[12px] tabular-nums"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      {formatBytesReadable(storageStats.offlineAudioBytes)} occupati ·{" "}
                      {storageStats.offlineAudioTracks}{" "}
                      {storageStats.offlineAudioTracks === 1
                        ? "brano offline"
                        : "brani offline"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={
                    storageStats.offlineAudioTracks === 0 &&
                    storageStats.offlineAudioBytes === 0
                  }
                  onClick={() => {
                    void clearAllDownloadedTracks().then(() =>
                      setCacheNonce((n) => n + 1),
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold hover:brightness-110 transition active:scale-95 disabled:opacity-45 disabled:pointer-events-none shrink-0"
                  style={{
                    backgroundColor: "rgb(244 63 94 / 0.16)",
                    color: "#fda4af",
                    border: "1px solid rgb(244 63 94 / 0.28)",
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Svuota cache offline
                </button>
              </div>

              <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <ShapedIconBadge
                    shape="scalloped"
                    bgColor="rgb(var(--md-secondary-container-rgb))"
                    fgColor="rgb(var(--md-on-secondary-container-rgb))"
                    size={40}
                  >
                    <Database className="w-4 h-4" />
                  </ShapedIconBadge>
                  <div className="min-w-0">
                    <p
                      className="text-[14px] font-semibold"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Backup e ripristino
                    </p>
                    <p
                      className="text-[12px]"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      Esporta o importa i dati locali di IPPOS in formato JSON
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold hover:brightness-110 transition active:scale-95"
                    style={{
                      backgroundColor: "rgb(var(--md-primary-container-rgb))",
                      color: "rgb(var(--md-on-primary-container-rgb))",
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Esporta
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold hover:brightness-110 transition active:scale-95"
                    style={{
                      backgroundColor:
                        "rgb(var(--md-surface-container-high-rgb))",
                      border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
                      color: "rgb(var(--md-on-surface-rgb))",
                    }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Importa
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Sezione Circa */}
          <section className="space-y-2.5">
            <h2
              className="text-[12.5px] font-semibold uppercase tracking-[0.08em] px-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Circa
            </h2>
            <div
              className="rounded-3xl overflow-hidden divide-y divide-white/[0.06] at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              }}
            >
              {renderListItemCard({
                icon: <Sparkles className="w-4 h-4" />,
                shape: "scalloped",
                badgeBg: "rgb(var(--md-primary-container-rgb))",
                badgeFg: "rgb(var(--md-accent-primary-rgb))",
                title: "Aggiornamenti",
                subtitle: "IPPOS è aggiornato all'ultima build macOS",
                trailing: (
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums"
                    style={{
                      backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                      color: "rgb(var(--md-on-accent-rgb))",
                    }}
                  >
                    1.0.0
                  </span>
                ),
                onClick: () => setSection("about"),
              })}
              {renderListItemCard({
                icon: <Info className="w-4 h-4" />,
                shape: "circle",
                badgeBg: "rgb(var(--md-surface-container-high-rgb))",
                badgeFg: "rgb(var(--md-on-surface-rgb))",
                title: "Circa",
                subtitle: "IPPOS macOS · Apple Silicon, licenze e crediti",
                onClick: () => setSection("about"),
              })}
            </div>
          </section>
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINA: ASPETTO (appearance)
         ============================================================ */}
      {section === "appearance" && (
        <div className="space-y-5 at-view-fade">
          <div
            className="rounded-3xl p-5 space-y-5 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold">
                  Abilita tema dinamico
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Estrae automaticamente i colori dominanti dalla copertina in riproduzione
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.dynamicThemeEnabled}
                onChange={(val) =>
                  updatePreferences({ dynamicThemeEnabled: val })
                }
                ariaLabel="Abilita tema dinamico"
              />
            </div>

            {/* Intensità vibranza */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                backgroundColor:
                  "rgb(var(--md-surface-container-low-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-semibold">
                  Intensità vibranza & glass
                </span>
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                    color: "rgb(var(--md-on-secondary-container-rgb))",
                  }}
                >
                  {VIBRANCY_OPTIONS[vibrancyIndex]?.label}
                </span>
              </div>
              <ExpressiveSlider
                size="md"
                min={0}
                max={2}
                step={1}
                value={vibrancyIndex}
                disabled={!preferences.dynamicThemeEnabled}
                ariaLabel="Intensità vibranza"
                formatTooltip={(v) =>
                  VIBRANCY_OPTIONS[Math.round(v)]?.label ?? "Bilanciato"
                }
                onChange={(val) => {
                  const opt = VIBRANCY_OPTIONS[Math.round(val)];
                  if (opt) updatePreferences({ vibrancyIntensity: opt.id });
                }}
              />
              <div className="flex items-center justify-between">
                {VIBRANCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!preferences.dynamicThemeEnabled}
                    onClick={() =>
                      updatePreferences({ vibrancyIntensity: opt.id })
                    }
                    className="text-[11.5px] font-medium disabled:opacity-40"
                    style={{
                      color:
                        preferences.vibrancyIntensity === opt.id
                          ? "rgb(var(--md-accent-primary-rgb))"
                          : "rgb(var(--md-on-surface-variant-rgb))",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Selettore Tema oscuro */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div>
                <p className="text-[14.5px] font-semibold">Tema oscuro</p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Preferenza modalità scura dell'interfaccia macOS
                </p>
              </div>
              <div
                className="inline-flex p-1 rounded-full"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                }}
              >
                {DARK_THEME_OPTIONS.map((opt) => {
                  const active = preferences.darkThemeMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        updatePreferences({ darkThemeMode: opt.id })
                      }
                      className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition"
                      style={
                        active
                          ? {
                              backgroundColor:
                                "rgb(var(--md-primary-container-rgb))",
                              color: "rgb(var(--md-on-primary-container-rgb))",
                            }
                          : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className="rounded-3xl p-5 divide-y divide-white/[0.06] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="pb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">Nero puro</p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Sfondo OLED #000000 assoluto per schermi ad alto contrasto
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.pureBlackOled}
                onChange={(val) => updatePreferences({ pureBlackOled: val })}
                ariaLabel="Nero puro OLED"
              />
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Disattiva gli effetti di sfocatura
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Rimuove backdrop-blur su pannelli, modali e barra player
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.disableBlur}
                onChange={(val) => updatePreferences({ disableBlur: val })}
                ariaLabel="Disattiva effetti di sfocatura"
              />
            </div>

            <div className="pt-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Disabilita animazioni
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Riduce al minimo tutte le transizioni e animazioni CSS
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.disableAnimations}
                onChange={(val) =>
                  updatePreferences({ disableAnimations: val })
                }
                ariaLabel="Disabilita animazioni"
              />
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINA: EQUALIZZATORE AUDIO (equalizer)
         ============================================================ */}
      {section === "equalizer" && (
        <div className="space-y-5 at-view-fade">
          <EqualizerPanel />
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINA: LETTORE E AUDIO (playback)
         ============================================================ */}
      {section === "playback" && (
        <div className="space-y-5 at-view-fade">
          <div
            className="rounded-3xl p-5 space-y-5 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14.5px] font-semibold">
                  Qualità audio YouTube
                </p>
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: "rgb(var(--md-primary-container-rgb))",
                    color: "rgb(var(--md-on-primary-container-rgb))",
                  }}
                >
                  {AUDIO_QUALITY_OPTIONS.find(
                    (o) => o.id === preferences.audioQuality,
                  )?.badge ?? "Massima"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {AUDIO_QUALITY_OPTIONS.map((opt) => {
                  const active = preferences.audioQuality === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updatePreferences({ audioQuality: opt.id })}
                      className="rounded-2xl p-3 text-left transition-all"
                      style={
                        active
                          ? {
                              backgroundColor:
                                "rgb(var(--md-primary-container-rgb) / 0.9)",
                              border:
                                "1px solid rgb(var(--md-accent-primary-rgb) / 0.7)",
                              color: "rgb(var(--md-on-primary-container-rgb))",
                            }
                          : {
                              backgroundColor:
                                "rgb(var(--md-surface-container-low-rgb))",
                              border:
                                "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                              color: "rgb(var(--md-on-surface-rgb))",
                            }
                      }
                    >
                      <span className="block text-[13px] font-bold">
                        {opt.label}
                      </span>
                      <span className="block text-[11px] opacity-75 mt-0.5">
                        {opt.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[13.5px] font-semibold">
                Codec stream preferito
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {AUDIO_FORMAT_OPTIONS.map((opt) => {
                  const active = preferences.preferredAudioFormat === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        updatePreferences({ preferredAudioFormat: opt.id })
                      }
                      className="rounded-2xl p-3 text-left transition-all"
                      style={
                        active
                          ? {
                              backgroundColor:
                                "rgb(var(--md-primary-container-rgb) / 0.9)",
                              border:
                                "1px solid rgb(var(--md-accent-primary-rgb) / 0.7)",
                              color: "rgb(var(--md-on-primary-container-rgb))",
                            }
                          : {
                              backgroundColor:
                                "rgb(var(--md-surface-container-low-rgb))",
                              border:
                                "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                              color: "rgb(var(--md-on-surface-rgb))",
                            }
                      }
                    >
                      <span className="block text-[12.5px] font-semibold font-mono">
                        {opt.label}
                      </span>
                      <span className="block text-[11px] opacity-75 mt-0.5">
                        {opt.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className="rounded-3xl p-5 divide-y divide-white/[0.06] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="pb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Autoplay / Radio infinita
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Avvia automaticamente brani consigliati correlati al termine della coda
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={autoplayEnabled}
                onChange={(val) => setAutoplayEnabled(val)}
                ariaLabel="Autoplay e radio infinita"
              />
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Riproduci video come audio ufficiale
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Preferisce sempre la traccia audio ufficiale ai video musicali nei risultati
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.preferOfficialAudio}
                onChange={(val) =>
                  updatePreferences({ preferOfficialAudio: val })
                }
                ariaLabel="Riproduci video come audio ufficiale"
              />
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">Low Data Mode</p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Seleziona stream più leggeri e disattiva il precaricamento automatico
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.lowDataMode}
                onChange={(val) => updatePreferences({ lowDataMode: val })}
                ariaLabel="Low Data Mode"
              />
            </div>

            <div className="pt-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">Preload Mode</p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Precarica lo stream del prossimo brano in coda durante la riproduzione
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.preloadNextTrack}
                disabled={preferences.lowDataMode}
                onChange={(val) => updatePreferences({ preloadNextTrack: val })}
                ariaLabel="Preload Mode"
              />
            </div>
          </div>

          <EqualizerPanel />

          {/* Crossfade / Transizione sfumata */}
          <div
            className="rounded-3xl p-5 space-y-3 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Crossfade (transizione sfumata)
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Sfuma gradualmente la fine del brano corrente con l&apos;inizio del successivo
                </p>
              </div>
              <span
                className="px-3 py-1 rounded-full text-[11.5px] font-bold tabular-nums shrink-0"
                style={
                  preferences.crossfadeSeconds > 0
                    ? {
                        backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                        color: "rgb(var(--md-on-accent-rgb))",
                      }
                    : {
                        backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                        color: "rgb(var(--md-on-secondary-container-rgb))",
                      }
                }
              >
                {preferences.crossfadeSeconds === 0
                  ? "Disattivato"
                  : `${preferences.crossfadeSeconds}s`}
              </span>
            </div>

            <ExpressiveSlider
              size="md"
              min={0}
              max={8}
              step={1}
              value={preferences.crossfadeSeconds}
              ariaLabel="Durata crossfade in secondi"
              formatTooltip={(v) => (v === 0 ? "Off" : `${Math.round(v)}s`)}
              onChange={(val) =>
                updatePreferences({ crossfadeSeconds: Math.round(val) })
              }
            />

            <div className="flex items-center justify-between text-[11px] font-medium">
              {[0, 2, 4, 6, 8].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => updatePreferences({ crossfadeSeconds: sec })}
                  className="tabular-nums transition-colors"
                  style={{
                    color:
                      preferences.crossfadeSeconds === sec
                        ? "rgb(var(--md-accent-primary-rgb))"
                        : "rgb(var(--md-on-surface-variant-rgb))",
                  }}
                >
                  {sec === 0 ? "Off" : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          <div
            className="rounded-3xl p-5 space-y-4 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="space-y-2">
              <p className="text-[13.5px] font-semibold">
                Comportamento alla chiusura
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {CLOSE_BEHAVIOR_OPTIONS.map((opt) => {
                  const active = preferences.closeBehavior === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        updatePreferences({ closeBehavior: opt.id })
                      }
                      className="rounded-2xl p-3 text-left transition-all"
                      style={
                        active
                          ? {
                              backgroundColor:
                                "rgb(var(--md-primary-container-rgb) / 0.9)",
                              border:
                                "1px solid rgb(var(--md-accent-primary-rgb) / 0.7)",
                              color: "rgb(var(--md-on-primary-container-rgb))",
                            }
                          : {
                              backgroundColor:
                                "rgb(var(--md-surface-container-low-rgb))",
                              border:
                                "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                              color: "rgb(var(--md-on-surface-rgb))",
                            }
                      }
                    >
                      <span className="block text-[12.5px] font-semibold">
                        {opt.label}
                      </span>
                      <span className="block text-[11px] opacity-75 mt-0.5">
                        {opt.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-[13.5px] font-semibold">
                Fade-out Sleep Timer
              </span>
              <div className="flex items-center gap-1.5">
                {SLEEP_FADE_OPTIONS.map((sec) => {
                  const active = preferences.sleepTimerFadeSeconds === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() =>
                        updatePreferences({ sleepTimerFadeSeconds: sec })
                      }
                      className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold tabular-nums transition"
                      style={
                        active
                          ? {
                              backgroundColor:
                                "rgb(var(--md-accent-primary-rgb))",
                              color: "rgb(var(--md-on-accent-rgb))",
                            }
                          : {
                              backgroundColor:
                                "rgb(var(--md-surface-container-low-rgb))",
                              color: "rgb(var(--md-on-surface-variant-rgb))",
                            }
                      }
                    >
                      {sec}s
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINA: TESTI (lyrics)
         ============================================================ */}
      {section === "lyrics" && (
        <div className="space-y-5 at-view-fade">
          <div
            className="rounded-3xl p-5 space-y-4 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14.5px] font-semibold">Lyrics mode</p>
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                style={{
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }}
              >
                {LYRICS_MODE_OPTIONS.find(
                  (o) => o.id === preferences.lyricsProviderPriority,
                )?.badge ?? "Sincronizzato"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {LYRICS_MODE_OPTIONS.map((opt) => {
                const active = preferences.lyricsProviderPriority === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      updatePreferences({ lyricsProviderPriority: opt.id })
                    }
                    className="rounded-2xl p-3.5 text-left transition-all"
                    style={
                      active
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb) / 0.9)",
                            border:
                              "1px solid rgb(var(--md-accent-primary-rgb) / 0.7)",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : {
                            backgroundColor:
                              "rgb(var(--md-surface-container-low-rgb))",
                            border:
                              "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                            color: "rgb(var(--md-on-surface-rgb))",
                          }
                    }
                  >
                    <span className="block text-[13px] font-bold">
                      {opt.label}
                    </span>
                    <span className="block text-[11px] opacity-75 mt-0.5">
                      {opt.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="rounded-3xl p-5 divide-y divide-white/[0.06] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="pb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Cambia testo con un clic
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Tocca una riga sincronizzata per saltare istantaneamente a quel secondo
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.lyricsClickToSeek}
                onChange={(val) =>
                  updatePreferences({ lyricsClickToSeek: val })
                }
                ariaLabel="Cambia testo con un clic"
              />
            </div>

            <div className="py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">
                  Testo a scorrimento automatico
                </p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Centra automaticamente la riga in esecuzione
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.lyricsAutoScroll}
                onChange={(val) => updatePreferences({ lyricsAutoScroll: val })}
                ariaLabel="Testo a scorrimento automatico"
              />
            </div>

            <div className="pt-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[14.5px] font-semibold">Sfoca righe testo</p>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Applica una leggera sfocatura alle righe passate e successive
                </p>
              </div>
              <M3ExpressiveSwitch
                checked={preferences.lyricsBlurInactive}
                onChange={(val) =>
                  updatePreferences({ lyricsBlurInactive: val })
                }
                ariaLabel="Sfoca righe testo"
              />
            </div>
          </div>

          <div
            className="rounded-3xl p-5 space-y-5 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[13px] font-semibold">
                  Dimensioni del testo del brano
                </p>
                <div className="flex items-center gap-1.5">
                  {LYRICS_FONT_PX_OPTIONS.map((px) => {
                    const active = preferences.lyricsFontPx === px;
                    return (
                      <button
                        key={px}
                        type="button"
                        onClick={() => updatePreferences({ lyricsFontPx: px })}
                        className="flex-1 py-2 rounded-full text-[12px] font-semibold tabular-nums transition"
                        style={
                          active
                            ? {
                                backgroundColor:
                                  "rgb(var(--md-primary-container-rgb))",
                                color:
                                  "rgb(var(--md-on-primary-container-rgb))",
                              }
                            : {
                                backgroundColor:
                                  "rgb(var(--md-surface-container-low-rgb))",
                                color:
                                  "rgb(var(--md-on-surface-variant-rgb))",
                              }
                        }
                      >
                        {px}px
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[13px] font-semibold">
                  Interlinea del testo
                </p>
                <div className="flex items-center gap-1.5">
                  {LYRICS_LINE_HEIGHT_OPTIONS.map((lh) => {
                    const active = preferences.lyricsLineHeight === lh;
                    return (
                      <button
                        key={lh}
                        type="button"
                        onClick={() =>
                          updatePreferences({ lyricsLineHeight: lh })
                        }
                        className="flex-1 py-2 rounded-full text-[12px] font-semibold tabular-nums transition"
                        style={
                          active
                            ? {
                                backgroundColor:
                                  "rgb(var(--md-primary-container-rgb))",
                                color:
                                  "rgb(var(--md-on-primary-container-rgb))",
                              }
                            : {
                                backgroundColor:
                                  "rgb(var(--md-surface-container-low-rgb))",
                                color:
                                  "rgb(var(--md-on-surface-variant-rgb))",
                              }
                        }
                      >
                        {lh}x
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Anteprima tipografica live */}
            <div
              className="rounded-2xl p-4 space-y-1"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
              }}
            >
              <p
                style={{
                  fontSize: `${preferences.lyricsFontPx}px`,
                  lineHeight: preferences.lyricsLineHeight,
                }}
                className="font-bold text-white"
              >
                Riga attiva in primo piano
              </p>
              <p
                style={{
                  fontSize: `${Math.max(16, preferences.lyricsFontPx - 3)}px`,
                  lineHeight: preferences.lyricsLineHeight,
                }}
                className={`font-semibold text-white/40 ${
                  preferences.lyricsBlurInactive ? "blur-[0.5px]" : ""
                }`}
              >
                Riga successiva sincronizzata
              </p>
            </div>

            {/* Offset sincronizzazione testo */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13.5px] font-semibold">
                    Offset sincronizzazione testo
                  </p>
                  <p
                    className="text-[11.5px]"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    Compensa anticipi (+) o ritardi (−) in tempo reale
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updatePreferences({
                        lyricsSyncOffsetSec: Math.max(
                          -5,
                          Math.round(
                            (preferences.lyricsSyncOffsetSec - 0.1) * 10,
                          ) / 10,
                        ),
                      })
                    }
                    className="px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums hover:brightness-110"
                    style={{
                      backgroundColor:
                        "rgb(var(--md-surface-container-high-rgb))",
                    }}
                  >
                    −0.1s
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updatePreferences({ lyricsSyncOffsetSec: 0 })
                    }
                    title="Ripristina a 0.0s"
                    className="px-3 py-1 rounded-full text-[12px] font-bold tabular-nums"
                    style={{
                      backgroundColor: "rgb(var(--md-primary-container-rgb))",
                      color: "rgb(var(--md-on-primary-container-rgb))",
                    }}
                  >
                    {preferences.lyricsSyncOffsetSec > 0 ? "+" : ""}
                    {preferences.lyricsSyncOffsetSec.toFixed(1)}s
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updatePreferences({
                        lyricsSyncOffsetSec: Math.min(
                          5,
                          Math.round(
                            (preferences.lyricsSyncOffsetSec + 0.1) * 10,
                          ) / 10,
                        ),
                      })
                    }
                    className="px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums hover:brightness-110"
                    style={{
                      backgroundColor:
                        "rgb(var(--md-surface-container-high-rgb))",
                    }}
                  >
                    +0.1s
                  </button>
                </div>
              </div>

              <ExpressiveSlider
                size="sm"
                min={-3}
                max={3}
                step={0.1}
                value={Math.max(-3, Math.min(3, preferences.lyricsSyncOffsetSec))}
                ariaLabel="Offset sincronizzazione testo"
                formatTooltip={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
                onChange={(val) =>
                  updatePreferences({
                    lyricsSyncOffsetSec: Math.round(val * 10) / 10,
                  })
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINA: STATISTICHE (stats)
         ============================================================ */}
      {section === "stats" && (
        <div className="space-y-5 at-view-fade">
          {/* Card Time range con pillole */}
          <div
            className="rounded-3xl p-4 flex flex-wrap items-center justify-between gap-3 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
            }}
          >
            <span
              className="text-[12.5px] font-semibold uppercase tracking-wide px-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Time range
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {STATS_RANGES.map((r) => {
                const active = statsRange === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setStatsRange(r.id)}
                    className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition"
                    style={
                      active
                        ? {
                            backgroundColor:
                              "rgb(var(--md-accent-primary-rgb))",
                            color: "rgb(var(--md-on-accent-rgb))",
                          }
                        : {
                            backgroundColor:
                              "rgb(var(--md-surface-container-low-rgb))",
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }
                    }
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hero Card blu/indaco con watermark scalloped */}
          <section
            className="relative rounded-[28px] overflow-hidden p-6 sm:p-7 at-tonal"
            style={{
              background:
                "linear-gradient(135deg, rgb(39 60 128 / 0.94), rgb(55 44 114 / 0.94))",
              border: "1px solid rgb(135 162 246 / 0.30)",
            }}
          >
            <ScallopedWatermark className="absolute -right-10 -bottom-12 w-60 h-60 text-indigo-200/10" />

            <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-2">
                <span className="inline-flex px-3 py-1 rounded-full text-[11px] font-semibold bg-white/15 text-indigo-100">
                  {statsSummary.rangeLabel}
                </span>
                <p className="text-[14px] font-medium text-indigo-100/85">
                  Tempo totale di ascolto
                </p>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[48px] sm:text-[56px] font-bold tracking-tight leading-none text-white tabular-nums">
                    {statsSummary.heroTime.headline}
                  </span>
                  <span className="text-[18px] font-semibold text-indigo-100/90">
                    {statsSummary.heroTime.unit}
                  </span>
                </div>
                <p className="text-[12.5px] font-mono text-indigo-100/75 tabular-nums">
                  Dettaglio esatto: {statsSummary.heroTime.exact}
                </p>
              </div>

              {statsSummary.totalPlays > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirmResetStats) {
                      clearPlayStats();
                      setConfirmResetStats(false);
                      showToast("Statistiche di ascolto azzerate");
                    } else {
                      setConfirmResetStats(true);
                    }
                  }}
                  onMouseLeave={() => setConfirmResetStats(false)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold bg-black/30 hover:bg-black/45 text-white border border-white/15 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmResetStats ? "Conferma azzeramento" : "Azzera dati"}
                </button>
              )}
            </div>
          </section>

          {/* Griglia 2x2 mini-card statistiche con icone sagomate */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[
              {
                label: "Total Plays",
                value: statsSummary.totalPlays,
                shape: "scalloped" as const,
                icon: <Play className="w-4 h-4 fill-current" />,
                bg: "rgb(99 124 235)",
              },
              {
                label: "Brani unici",
                value: statsSummary.uniqueTracks,
                shape: "clover" as const,
                icon: <Music className="w-4 h-4" />,
                bg: "rgb(168 85 247)",
              },
              {
                label: "Artisti unici",
                value: statsSummary.uniqueArtists,
                shape: "cloud" as const,
                icon: <UserRound className="w-4 h-4" />,
                bg: "rgb(74 134 168)",
              },
              {
                label: "Album unici",
                value: statsSummary.uniqueAlbums,
                shape: "circle" as const,
                icon: <Disc3 className="w-4 h-4" />,
                bg: "rgb(100 105 124)",
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-3xl p-4 space-y-2.5 at-tonal"
                style={{
                  backgroundColor:
                    "rgb(var(--md-surface-container-rgb) / 0.85)",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                }}
              >
                <ShapedIconBadge
                  shape={card.shape}
                  bgColor={card.bg}
                  fgColor="#ffffff"
                  size={36}
                >
                  {card.icon}
                </ShapedIconBadge>
                <div>
                  <p className="text-[24px] font-bold tabular-nums leading-tight">
                    {card.value}
                  </p>
                  <p
                    className="text-[12px]"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {card.label}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Classifica reale Top 5 Brani & Top 5 Artisti */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div
              className="rounded-3xl p-5 space-y-3.5 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              }}
            >
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-accent" />
                <h3 className="text-[15px] font-bold">Top 5 Brani</h3>
              </div>

              {statsSummary.topTracks.length === 0 ? (
                <p
                  className="text-[12.5px] py-4"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Nessuna riproduzione in questo intervallo.
                </p>
              ) : (
                <div className="space-y-2">
                  {statsSummary.topTracks.map((entry, idx) => (
                    <div
                      key={entry.track.id}
                      onClick={() =>
                        playTrack(entry.track, statsSummary.allSortedTracks)
                      }
                      className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-white/[0.05] cursor-pointer transition"
                    >
                      <span className="w-5 text-center text-[12px] font-bold tabular-nums text-accent">
                        {idx + 1}
                      </span>
                      <img
                        src={entry.track.cover}
                        alt={entry.track.title}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-xl object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold truncate">
                          {entry.track.title}
                        </p>
                        <p
                          className="text-[11.5px] truncate"
                          style={{
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }}
                        >
                          <ArtistLinks
                            artist={entry.track.artist}
                            artistId={entry.track.artistId}
                            artists={entry.track.artists}
                          />
                        </p>
                      </div>
                      <span
                        className="px-2.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums shrink-0"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-primary-container-rgb))",
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }}
                      >
                        {entry.playCount}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              className="rounded-3xl p-5 space-y-3.5 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
              }}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-accent" />
                <h3 className="text-[15px] font-bold">Top 5 Artisti</h3>
              </div>

              {statsSummary.topArtists.length === 0 ? (
                <p
                  className="text-[12.5px] py-4"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Ascolta qualche brano per popolare la classifica artisti.
                </p>
              ) : (
                <div className="space-y-3">
                  {statsSummary.topArtists.map((artist, idx) => {
                    const pct = Math.max(
                      8,
                      Math.round(
                        (artist.plays / statsSummary.maxArtistPlays) * 100,
                      ),
                    );
                    return (
                      <button
                        key={artist.name}
                        type="button"
                        onClick={() =>
                          openArtist({ id: artist.id, name: artist.name })
                        }
                        className="w-full text-left group space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="font-semibold truncate group-hover:underline group-hover:text-accent">
                            {idx + 1}. {artist.name}
                          </span>
                          <span
                            className="tabular-nums text-[11.5px] shrink-0 pl-2"
                            style={{
                              color: "rgb(var(--md-on-surface-variant-rgb))",
                            }}
                          >
                            {artist.plays}{" "}
                            {artist.plays === 1 ? "ascolto" : "ascolti"}
                          </span>
                        </div>
                        <div
                          className="h-2 w-full rounded-full overflow-hidden"
                          style={{
                            backgroundColor:
                              "rgb(var(--md-surface-container-low-rgb))",
                          }}
                        >
                          <div
                            className="h-full rounded-full transition-[width] duration-500 ease-out"
                            style={{
                              width: `${pct}%`,
                              backgroundColor:
                                "rgb(var(--md-accent-primary-rgb))",
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINA: STOCCAGGIO (storage)
         ============================================================ */}
      {section === "storage" && (
        <div className="space-y-5 at-view-fade">
          {/* Hero Card blu */}
          <section
            className="relative rounded-[28px] overflow-hidden p-6 space-y-5 at-tonal"
            style={{
              background:
                "linear-gradient(135deg, rgb(34 62 122 / 0.94), rgb(26 45 88 / 0.94))",
              border: "1px solid rgb(125 168 245 / 0.30)",
            }}
          >
            <ScallopedWatermark className="absolute -right-8 -top-10 w-48 h-48 text-sky-200/10" />

            <div className="relative z-10 space-y-1">
              <p className="text-[13px] font-medium text-sky-100/80">
                IPPOS sta usando
              </p>
              <p className="text-[38px] font-bold tracking-tight text-white tabular-nums">
                {formatBytesReadable(storageStats.totalBytes)}
              </p>
            </div>

            {/* Barra di progresso segmentata a colori */}
            <div className="relative z-10 h-3.5 w-full rounded-full overflow-hidden bg-black/30 flex gap-0.5 p-0.5">
              {[
                {
                  bytes: storageStats.offlineAudioBytes,
                  color: "#38bdf8",
                },
                {
                  bytes: storageStats.tracksCacheBytes,
                  color: "#60a5fa",
                },
                {
                  bytes: storageStats.imagesCacheBytes,
                  color: "#c084fc",
                },
                {
                  bytes: storageStats.lyricsCacheBytes,
                  color: "#34d399",
                },
                {
                  bytes: storageStats.libraryBytes,
                  color: "#fbbf24",
                },
              ].map((seg, i) => {
                const widthPct = Math.max(
                  seg.bytes > 0 ? 4 : 0,
                  Math.round((seg.bytes / storageStats.totalBytes) * 100),
                );
                return (
                  <div
                    key={i}
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: seg.color,
                    }}
                    className="h-full rounded-full transition-all duration-300"
                  />
                );
              })}
            </div>

            {/* Legenda con pallini sagomati */}
            <div className="relative z-10 grid grid-cols-2 gap-3 pt-1">
              {[
                {
                  label: "Cache audio offline",
                  bytes: storageStats.offlineAudioBytes,
                  color: "#38bdf8",
                },
                {
                  label: "Cache stream URL",
                  bytes: storageStats.tracksCacheBytes,
                  color: "#60a5fa",
                },
                {
                  label: "Cache delle immagini",
                  bytes: storageStats.imagesCacheBytes,
                  color: "#c084fc",
                },
                {
                  label: "Cache dei testi",
                  bytes: storageStats.lyricsCacheBytes,
                  color: "#34d399",
                },
                {
                  label: "Dati libreria",
                  bytes: storageStats.libraryBytes,
                  color: "#fbbf24",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 text-[12px] text-sky-50/90"
                >
                  <ShapedIconBadge
                    shape="scalloped"
                    bgColor={item.color}
                    fgColor="#0b1020"
                    size={16}
                  >
                    <span className="sr-only">{item.label}</span>
                  </ShapedIconBadge>
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto font-semibold tabular-nums text-white">
                    {formatBytesReadable(item.bytes)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Card Cartella di archiviazione con barra ondulata */}
          <div
            className="rounded-3xl p-5 space-y-4 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="flex items-center gap-3">
              <ShapedIconBadge
                shape="scalloped"
                bgColor="rgb(var(--md-primary-container-rgb))"
                fgColor="rgb(var(--md-accent-primary-rgb))"
                size={40}
              >
                <FolderOpen className="w-4 h-4" />
              </ShapedIconBadge>
              <div>
                <h3 className="text-[15px] font-bold">
                  Cartella di archiviazione
                </h3>
                <p
                  className="text-[12px] font-mono"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  App Support · IPPOS · library.json
                </p>
              </div>
            </div>

            <WavyBar className="text-accent opacity-65" />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div
                className="sm:col-span-3 rounded-2xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                  border: "1px solid rgb(56 189 248 / 0.28)",
                }}
              >
                <div className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">
                    Spazio di archiviazione cache
                  </span>
                  <span
                    className="block text-[11.5px] mt-0.5 tabular-nums"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    {formatBytesReadable(storageStats.offlineAudioBytes)} occupati su disco ·{" "}
                    {storageStats.offlineAudioTracks}{" "}
                    {storageStats.offlineAudioTracks === 1
                      ? "brano scaricato"
                      : "brani scaricati"}
                  </span>
                  {storageStats.offlineAudioDir && (
                    <span
                      className="block text-[10.5px] font-mono mt-0.5 truncate max-w-[440px]"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      {storageStats.offlineAudioDir}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  disabled={
                    storageStats.offlineAudioTracks === 0 &&
                    storageStats.offlineAudioBytes === 0
                  }
                  onClick={() => {
                    void clearAllDownloadedTracks().then(() =>
                      setCacheNonce((n) => n + 1),
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold hover:brightness-110 transition active:scale-95 disabled:opacity-45 disabled:pointer-events-none shrink-0"
                  style={{
                    backgroundColor: "rgb(244 63 94 / 0.16)",
                    color: "#fda4af",
                    border: "1px solid rgb(244 63 94 / 0.28)",
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Svuota cache offline
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  clearPaletteCache();
                  clearMusicCaches();
                  setCacheNonce((n) => n + 1);
                  showToast("Cache immagini e feed svuotata");
                }}
                className="rounded-2xl px-4 py-3 text-left hover:brightness-110 transition active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                }}
              >
                <span className="block text-[13px] font-semibold">
                  Svuota cache immagini
                </span>
                <span
                  className="block text-[11px] mt-0.5 tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {storageStats.paletteEntries} palette in memoria
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  clearLyricsCache();
                  setCacheNonce((n) => n + 1);
                  showToast("Cache testi svuotata");
                }}
                className="rounded-2xl px-4 py-3 text-left hover:brightness-110 transition active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                }}
              >
                <span className="block text-[13px] font-semibold">
                  Svuota cache testi
                </span>
                <span
                  className="block text-[11px] mt-0.5 tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {storageStats.lyricsEntries} testi memorizzati
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  invalidateAudioStreamCache();
                  setCacheNonce((n) => n + 1);
                  showToast("Cache URL stream audio azzerata");
                }}
                className="rounded-2xl px-4 py-3 text-left hover:brightness-110 transition active:scale-95"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
                  border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
                }}
              >
                <span className="block text-[13px] font-semibold">
                  Svuota cache brani
                </span>
                <span
                  className="block text-[11px] mt-0.5 tabular-nums"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {storageStats.streamEntries} stream risolti
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          SOTTO-PAGINE: MEDIA / CONTENUTO / COMPORTAMENTO / CIRCA
         ============================================================ */}
      {section === "media" && (
        <div
          className="rounded-3xl p-5 space-y-4 at-view-fade at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
          }}
        >
          <div className="flex items-center gap-3">
            <ShapedIconBadge
              shape="scalloped"
              bgColor="rgb(var(--md-primary-container-rgb))"
              fgColor="rgb(var(--md-accent-primary-rgb))"
              size={44}
            >
              <Radio className="w-5 h-5" />
            </ShapedIconBadge>
            <div>
              <h2 className="text-[16px] font-bold">
                Bridge nativo IPPOS Island & macOS Media Center
              </h2>
              <p
                className="text-[12px]"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Sincronizzazione bidirezionale via MPNowPlayingInfoCenter e NSDistributedNotificationCenter
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px]">
            <div
              className="rounded-2xl p-3.5"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
              }}
            >
              <p
                className="text-[11px] uppercase font-semibold"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Stato playback
              </p>
              <p className="font-bold mt-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                {currentTrack
                  ? `${currentTrack.title} (${playbackStatus})`
                  : "In attesa"}
              </p>
            </div>
            <div
              className="rounded-2xl p-3.5"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
              }}
            >
              <p
                className="text-[11px] uppercase font-semibold"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Modalità Shuffle & Loop
              </p>
              <p className="font-bold mt-1">
                Shuffle: {shuffle ? "Attivo" : "Off"} · Repeat: {repeat}
              </p>
            </div>
            <div
              className="rounded-2xl p-3.5"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
              }}
            >
              <p
                className="text-[11px] uppercase font-semibold"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Comandi esterni
              </p>
              <p className="font-bold mt-1">
                Play/Pause, Seek, Shuffle, Loop attivi
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <ShapedIconBadge
                shape="clover"
                bgColor="rgb(88 101 242)"
                fgColor="#ffffff"
                size={38}
              >
                <Gamepad2 className="w-4 h-4" />
              </ShapedIconBadge>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">
                  Condividi stato su Discord
                </p>
                <p
                  className="text-[12px]"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Aggiorna automaticamente la tua Discord Rich Presence tramite socket IPC locale
                </p>
              </div>
            </div>
            <M3ExpressiveSwitch
              checked={preferences.discordRichPresenceEnabled}
              onChange={(val) =>
                updatePreferences({ discordRichPresenceEnabled: val })
              }
              ariaLabel="Condividi stato su Discord"
            />
          </div>
        </div>
      )}

      {section === "content" && (
        <div
          className="rounded-3xl p-5 space-y-5 at-view-fade at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
          }}
        >
          <div className="space-y-2">
            <p className="text-[13.5px] font-semibold">
              Lingua catalogo YouTube Music
            </p>
            <div className="flex flex-wrap gap-2">
              {CONTENT_LANGUAGES.map((lang) => {
                const active = preferences.contentLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => updatePreferences({ contentLang: lang.code })}
                    className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition"
                    style={
                      active
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : {
                            backgroundColor:
                              "rgb(var(--md-surface-container-low-rgb))",
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }
                    }
                  >
                    {lang.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[13.5px] font-semibold">Paese consigliati</p>
            <div className="flex flex-wrap gap-2">
              {CONTENT_COUNTRIES.map((country) => {
                const active = preferences.contentCountry === country.code;
                return (
                  <button
                    key={country.code}
                    type="button"
                    onClick={() =>
                      updatePreferences({ contentCountry: country.code })
                    }
                    className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition"
                    style={
                      active
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : {
                            backgroundColor:
                              "rgb(var(--md-surface-container-low-rgb))",
                            color: "rgb(var(--md-on-surface-variant-rgb))",
                          }
                    }
                  >
                    {country.label} ({country.code})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {section === "behavior" && (
        <div
          className="rounded-3xl p-5 space-y-5 at-view-fade at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[14.5px] font-semibold">
                Salva cronologia e statistiche di ascolto
              </p>
              <p
                className="text-[12px] mt-0.5"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Registra localmente brani recenti e contatori di riproduzione
              </p>
            </div>
            <M3ExpressiveSwitch
              checked={preferences.saveListeningHistory}
              onChange={(val) =>
                updatePreferences({ saveListeningHistory: val })
              }
              ariaLabel="Salva cronologia di ascolto"
            />
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/[0.06]">
            <div>
              <p className="text-[13.5px] font-semibold">
                Pulisci cronologia recente
              </p>
              <p
                className="text-[12px]"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {recentTracks.length} brani nella lista recenti
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                clearRecentTracks();
                showToast("Cronologia recente svuotata");
              }}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold hover:brightness-110 transition"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              Svuota cronologia
            </button>
          </div>

          <div className="pt-2 border-t border-white/[0.06] space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <Keyboard className="w-4 h-4 text-accent" />
              Scorciatoie da tastiera attive
            </div>
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Spazio (Play/Pausa) · ⌘← / ⌘→ (Precedente/Successivo) · ⌘K o ⌘F (Cerca) · ⌘L (Testi) · M (Muto) · ⌘/⌥↑↓ (Volume ±5%) · Esc (Chiudi)
            </p>
          </div>
        </div>
      )}

      {section === "about" && (
        <div
          className="rounded-3xl p-6 space-y-4 at-view-fade at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
          }}
        >
          <div className="flex items-center gap-4">
            <ShapedIconBadge
              shape="scalloped"
              bgColor="rgb(var(--md-accent-primary-rgb))"
              fgColor="rgb(var(--md-on-accent-rgb))"
              size={54}
            >
              <ShieldCheck className="w-6 h-6" />
            </ShapedIconBadge>
            <div>
              <h2 className="text-[20px] font-bold">IPPOS per macOS</h2>
              <p
                className="text-[12.5px]"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Versione 1.0.0 · Architettura nativa Apple Silicon · Zero server remoti
              </p>
            </div>
          </div>

          <div
            className="rounded-2xl p-4 space-y-2 text-[12.5px]"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-low-rgb))",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.18)",
            }}
          >
            <p className="font-semibold">Note di rilascio v1.0.0</p>
            <ul
              className="list-disc list-inside space-y-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              <li>Motore cromatico Material 3 Expressive con modalità OLED Nero Puro</li>
              <li>Integrazione nativa macOS MediaRemote e bridge IPPOS Island</li>
              <li>Navigazione completa Artisti, Coda drag-and-drop e Testi sincronizzati</li>
              <li>Scorciatoie da tastiera locali e tasti multimediali di sistema</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
