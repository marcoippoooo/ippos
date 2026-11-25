export interface TrackArtist {
  name: string;
  id?: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artists?: TrackArtist[];
  album?: string;
  duration: string;
  durationSeconds: number;
  cover: string;
  itemType?: "song" | "video";
  isExplicit?: boolean;
  accentRgb?: string;
}

export interface ArtistSummary {
  id: string;
  name: string;
  subtitle?: string;
  thumbnail: string;
}

export interface ArtistRelease {
  id: string;
  title: string;
  subtitle?: string;
  year?: string;
  type: "album" | "single";
  cover: string;
}

export interface ArtistPageData {
  id: string;
  name: string;
  description?: string;
  subscribers?: string;
  thumbnail: string;
  banner?: string;
  topTracks: Track[];
  albums: ArtistRelease[];
  singles: ArtistRelease[];
  relatedArtists: ArtistSummary[];
}

export interface SelectedArtist {
  id?: string;
  name: string;
}

export type HomeMoodFilter = "all" | "workout" | "energize" | "relax" | "podcasts";

export interface HomePlaylist {
  id: string;
  title: string;
  subtitle?: string;
  cover: string;
  previewCovers?: string[];
  trackCount?: string;
  isComposite?: boolean;
  tracks?: Track[];
}

export interface TrackPlayStat {
  track: Track;
  playCount: number;
  lastPlayedAt: number;
  playTimestamps?: number[];
}

export type PlaylistSortBy = "recent" | "name" | "count";

export interface UserPlaylist {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
}

export type LibrarySortBy = "recent" | "title" | "artist";

export interface ThemePalette {
  primaryRgb: string;
  secondaryRgb: string;
  accentRgb: string;
  surfaceBaseRgb: string;
  surfaceContainerLowRgb: string;
  surfaceContainerRgb: string;
  surfaceContainerHighRgb: string;
  primaryContainerRgb: string;
  onPrimaryContainerRgb: string;
  secondaryContainerRgb: string;
  onSecondaryContainerRgb: string;
  accentPrimaryRgb: string;
  onAccentRgb: string;
  outlineRgb: string;
  onSurfaceRgb: string;
  onSurfaceVariantRgb: string;
  isDynamic: boolean;
}

export interface LyricLine {
  time: number; // secondi; -1 per testi statici non sincronizzati
  text: string;
}

export type LyricsMode = "synced" | "plain" | "instrumental" | "none";

export interface LyricsData {
  trackId: string;
  mode: LyricsMode;
  lines: LyricLine[];
  source?: string;
}

export interface FeedSection {
  id: string;
  title: string;
  tracks: Track[];
}

export type SearchFilter = "song" | "video" | "all";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type ViewMode =
  | "home"
  | "explore"
  | "library"
  | "lyrics"
  | "artist"
  | "search"
  | "settings";

export type VibrancyIntensity = "subtle" | "balanced" | "vivid";
export type ThemeDarkMode = "system" | "dark";
export type CloseBehavior = "tray" | "quit";
export type AudioFormatPreference = "mp4_aac" | "webm_opus";
export type AudioQualityLevel = "max" | "high" | "normal";
export type SleepTimerFadeSeconds = 5 | 10 | 15 | 20;
export type LyricsProviderPriority = "lrclib" | "ytmusic";
export type LyricsFontSize = "normal" | "large" | "xlarge";
export type LyricsFontPx = 20 | 24 | 26 | 30;
export type LyricsLineHeight = 1.2 | 1.3 | 1.5;

export interface AppPreferences {
  dynamicThemeEnabled: boolean;
  vibrancyIntensity: VibrancyIntensity;
  darkThemeMode: ThemeDarkMode;
  pureBlackOled: boolean;
  disableBlur: boolean;
  disableAnimations: boolean;
  closeBehavior: CloseBehavior;
  preferredAudioFormat: AudioFormatPreference;
  audioQuality: AudioQualityLevel;
  preferOfficialAudio: boolean;
  lowDataMode: boolean;
  preloadNextTrack: boolean;
  contentLang: string;
  contentCountry: string;
  saveListeningHistory: boolean;
  sleepTimerFadeSeconds: SleepTimerFadeSeconds;
  lyricsProviderPriority: LyricsProviderPriority;
  lyricsFontSize: LyricsFontSize;
  lyricsClickToSeek: boolean;
  lyricsAutoScroll: boolean;
  lyricsBlurInactive: boolean;
  lyricsFontPx: LyricsFontPx;
  lyricsLineHeight: LyricsLineHeight;
  lyricsSyncOffsetSec: number;
}

export type LibraryTab = "overview" | "liked" | "recent" | "top" | "playlists";

export type RepeatMode = "off" | "all" | "one";

export interface AuthUser {
  name: string;
  handle?: string;
  avatar?: string;
}

export type AuthStatus = "guest" | "authenticating" | "authenticated";

export interface RemotePlaylist {
  id: string;
  title: string;
  subtitle?: string;
  cover: string;
  trackCount?: string;
  isLikedSongs?: boolean;
}

export interface StreamTechnicalDetails {
  videoId: string;
  mimeType: string;
  codec: string;
  bitrate: number;
  itag?: number;
  sampleRate?: number;
  audioChannels?: number;
  audioQuality?: string;
  contentLength?: number;
  durationSeconds: number;
  clientUsed: string;
}

export interface SleepTimerState {
  active: boolean;
  endsAt: number | null;
  durationMinutes: number;
  finishCurrentSong: boolean;
  fadeOut: boolean;
  waitingForTrackEnd: boolean;
}
