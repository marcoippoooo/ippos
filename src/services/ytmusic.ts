import Innertube, {
  GridContinuation,
  MusicShelfContinuation,
  YTNodes,
} from "youtubei.js/web";
import { tauriFetch } from "./tauriFetch";
import {
  formatTime,
  parseDurationToSeconds,
  sanitizeDurationSeconds,
} from "../utils/formatTime";
import {
  ArtistPageData,
  ArtistRelease,
  ArtistSummary,
  AudioFormatPreference,
  AudioQualityLevel,
  AuthUser,
  FeedSection,
  HomeMoodFilter,
  HomePlaylist,
  PlaylistPrivacyStatus,
  RemotePlaylist,
  SearchFilter,
  SelectedArtist,
  Track,
  TrackArtist,
} from "../types/music";

let activeAuthCookie: string | null = null;
let preferredAudioFormat: AudioFormatPreference = "mp4_aac";
let preferredAudioQuality: AudioQualityLevel = "max";
let lowDataModeEnabled = false;
let preferOfficialAudioEnabled = true;
let contentLangCode = "it";
let contentCountryCode = "IT";
let clientPromise: Promise<Innertube> | null = null;
let guestStreamClientPromise: Promise<Innertube> | null = null;

export function setPreferredAudioFormat(format: AudioFormatPreference): void {
  preferredAudioFormat = format;
}

export function setPlaybackAndContentConfig(cfg: {
  preferredAudioFormat: AudioFormatPreference;
  audioQuality: AudioQualityLevel;
  lowDataMode: boolean;
  preferOfficialAudio: boolean;
  contentLang: string;
  contentCountry: string;
}): void {
  const audioChanged =
    preferredAudioFormat !== cfg.preferredAudioFormat ||
    preferredAudioQuality !== cfg.audioQuality ||
    lowDataModeEnabled !== cfg.lowDataMode;
  const regionChanged =
    contentLangCode !== cfg.contentLang ||
    contentCountryCode !== cfg.contentCountry;

  preferredAudioFormat = cfg.preferredAudioFormat;
  preferredAudioQuality = cfg.audioQuality;
  lowDataModeEnabled = cfg.lowDataMode;
  preferOfficialAudioEnabled = cfg.preferOfficialAudio;
  contentLangCode = cfg.contentLang;
  contentCountryCode = cfg.contentCountry;

  if (audioChanged) {
    invalidateAudioStreamCache();
  }
  if (regionChanged) {
    clientPromise = null;
    guestStreamClientPromise = null;
    homeFeedCache.clear();
    artistPageCache.clear();
    albumTracksCache.clear();
  }
}

export function getMusicCacheStats(): {
  streamEntries: number;
  metadataEntries: number;
  streamBytes: number;
  metadataBytes: number;
} {
  const streamEntries = streamCache.size;
  const metadataEntries =
    homeFeedCache.size +
    remotePlaylistTracksCache.size +
    artistPageCache.size +
    albumTracksCache.size;
  return {
    streamEntries,
    metadataEntries,
    streamBytes: streamEntries * 2048,
    metadataBytes: metadataEntries * 8192,
  };
}

export function clearMusicCaches(): void {
  streamCache.clear();
  homeFeedCache.clear();
  remotePlaylistTracksCache.clear();
  artistPageCache.clear();
  albumTracksCache.clear();
}

export interface HomeFeedData {
  sections: FeedSection[];
  playlists: HomePlaylist[];
}

const MAX_ARTIST_CACHE_ENTRIES = 30;
const remotePlaylistTracksCache = new Map<string, Track[]>();
const homeFeedCache = new Map<HomeMoodFilter, HomeFeedData>();
const artistPageCache = new Map<string, ArtistPageData>();
const albumTracksCache = new Map<string, Track[]>();

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  if (cache.size >= limit) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
}

export class AuthExpiredError extends Error {
  constructor(message = "Sessione YouTube Music scaduta o non valida.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export function isAuthExpiredError(err: unknown): boolean {
  if (err instanceof AuthExpiredError) return true;
  const raw = err instanceof Error ? err.message : String(err);
  return (
    /status code (401|403)\b/i.test(raw) ||
    /unauthenticated/i.test(raw) ||
    /you must be signed in/i.test(raw) ||
    /login_required/i.test(raw) ||
    /authentication credentials/i.test(raw)
  );
}

export function isYTMusicAuthenticated(): boolean {
  return activeAuthCookie !== null;
}

export function clearRemotePlaylistCache(playlistId?: string): void {
  if (playlistId) {
    remotePlaylistTracksCache.delete(playlistId.replace(/^VL/, ""));
  } else {
    remotePlaylistTracksCache.clear();
  }
}

export function seedRemotePlaylistCache(
  playlistId: string,
  tracks: Track[],
): void {
  const cleanId = playlistId.trim().replace(/^VL/, "");
  if (!cleanId) return;
  remotePlaylistTracksCache.set(cleanId, deduplicateTracks(tracks));
}

export function setYTMusicAuthCookie(cookie: string | null): void {
  const normalized = cookie?.trim() ? cookie.trim() : null;
  if (normalized === activeAuthCookie) return;
  activeAuthCookie = normalized;
  clientPromise = null;
  invalidateAudioStreamCache();
  remotePlaylistTracksCache.clear();
  homeFeedCache.clear();
  artistPageCache.clear();
  albumTracksCache.clear();
}

const FALLBACK_COVER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1b1b22"/>
        <stop offset="100%" stop-color="#0e0e12"/>
      </linearGradient>
    </defs>
    <rect width="300" height="300" fill="url(#bg)"/>
    <circle cx="150" cy="150" r="64" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
    <circle cx="150" cy="150" r="14" fill="#fa2d48" fill-opacity="0.6"/>
  </svg>`,
)}`;

interface ThumbnailLike {
  url: string;
  width?: number;
}

const DURATION_PATTERN = /^\d+(?::[0-5]\d)+$/;
const VIEWS_PATTERN = /\b(?:visualizzazioni|views)\b/i;

/**
 * Restituisce un'istanza singleton del client Innertube instradata
 * attraverso `tauriFetch`. Se la creazione fallisce, azzera la cache
 * per consentire tentativi successivi.
 */
export async function getYTMusicClient(): Promise<Innertube> {
  if (!clientPromise) {
    const cookie = activeAuthCookie ?? undefined;
    clientPromise = Innertube.create({
      fetch: tauriFetch,
      cookie,
      retrieve_player: false,
      lang: contentLangCode,
      location: contentCountryCode,
      generate_session_locally: false,
      enable_session_cache: false,
    }).catch((err: unknown) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

async function getGuestStreamClient(): Promise<Innertube> {
  if (!activeAuthCookie) {
    return getYTMusicClient();
  }
  if (!guestStreamClientPromise) {
    guestStreamClientPromise = Innertube.create({
      fetch: tauriFetch,
      retrieve_player: false,
      lang: contentLangCode,
      location: contentCountryCode,
      generate_session_locally: false,
      enable_session_cache: false,
    }).catch((err: unknown) => {
      guestStreamClientPromise = null;
      throw err;
    });
  }
  return guestStreamClientPromise;
}

export interface SearchCatalogResult {
  tracks: Track[];
  artists: ArtistSummary[];
}

export function parseArtistsFromString(artistStr: string): TrackArtist[] {
  const trimmed = artistStr.trim();
  if (!trimmed || trimmed === "Artista sconosciuto") {
    return trimmed ? [{ name: trimmed }] : [];
  }
  const parts = trimmed
    .split(/\s*(?:,\s*|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return [{ name: trimmed }];
  }
  return parts.map((name) => ({ name }));
}

function isArtistBrowseId(id: unknown): id is string {
  return typeof id === "string" && /^UC[\w-]+$/.test(id.trim());
}

function extractTrackArtists(
  rawList?: Array<{ name?: string; channel_id?: string | null; endpoint?: { payload?: Record<string, unknown> } }>,
): { artists: TrackArtist[]; artistNames: string; primaryArtistId?: string } {
  if (!rawList || rawList.length === 0) {
    return { artists: [], artistNames: "" };
  }
  const artists: TrackArtist[] = [];
  for (const entry of rawList) {
    const name = entry.name?.trim();
    if (!name) continue;
    const candidateId =
      entry.channel_id ??
      (entry.endpoint?.payload?.browseId as string | undefined);
    const id = isArtistBrowseId(candidateId) ? candidateId.trim() : undefined;
    artists.push({ name, id });
  }
  return {
    artists,
    artistNames: artists.map((a) => a.name).join(", "),
    primaryArtistId: artists.find((a) => a.id)?.id,
  };
}

function extractFallbackArtistsFromRuns(
  item: YTNodes.MusicResponsiveListItem,
): TrackArtist[] {
  const runs = item.flex_columns?.[1]?.title?.runs;
  if (!runs || runs.length === 0) return [];

  const linked: TrackArtist[] = [];
  let firstPlainText: string | undefined;

  for (const run of runs) {
    const text = run.text?.trim();
    if (!text) continue;
    if (text === "•" || text === "-" || text === "e" || text === "," || text === "&") {
      continue;
    }
    if (DURATION_PATTERN.test(text) || VIEWS_PATTERN.test(text)) {
      continue;
    }
    if (
      text === "Brano" ||
      text === "Song" ||
      text === "Video" ||
      text === "Album"
    ) {
      continue;
    }
    const browseId =
      "endpoint" in run
        ? (run.endpoint?.payload?.browseId as string | undefined)
        : undefined;
    if (isArtistBrowseId(browseId)) {
      linked.push({ name: text, id: browseId.trim() });
    } else if (!firstPlainText) {
      firstPlainText = text;
    }
  }

  if (linked.length > 0) return linked;
  return firstPlainText ? [{ name: firstPlainText }] : [];
}

export function extractBestThumbnail(
  thumbnails?: ThumbnailLike[] | null,
): string {
  if (!thumbnails || thumbnails.length === 0) {
    return FALLBACK_COVER_SVG;
  }

  let best = thumbnails[0];
  for (const thumb of thumbnails) {
    if ((thumb.width ?? 0) > (best.width ?? 0)) {
      best = thumb;
    }
  }

  let url = best?.url;
  if (!url) return FALLBACK_COVER_SVG;

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  // Upgrade risoluzione per le copertine Googleusercontent
  if (url.includes("googleusercontent.com")) {
    url = url.replace(/=w\d+-h\d+([^&]*)$/, "=w544-h544$1");
  }

  return url;
}

const EXCLUDED_PLAYLIST_TRACK_TYPES = new Set([
  "album",
  "playlist",
  "artist",
  "library_artist",
  "podcast_show",
]);

function extractRunVideoId(item: YTNodes.MusicResponsiveListItem): string | undefined {
  const firstRun = item.flex_columns?.[0]?.title?.runs?.[0];
  if (firstRun && "endpoint" in firstRun) {
    const id = firstRun.endpoint?.payload?.videoId;
    return typeof id === "string" && id ? id : undefined;
  }
  return undefined;
}

function hasExplicitBadge(badges: unknown): boolean {
  if (!badges || typeof badges !== "object") return false;
  let items: unknown[] = [];

  if (Array.isArray(badges)) {
    items = badges;
  } else if ("is_array" in badges || "is_node" in badges) {
    const parsed = badges as {
      is_null?: boolean;
      is_array?: boolean;
      is_node?: boolean;
      array?: () => unknown[];
      item?: () => unknown;
    };
    if (parsed.is_null) return false;
    if (parsed.is_array && typeof parsed.array === "function") {
      items = parsed.array();
    } else if (parsed.is_node && typeof parsed.item === "function") {
      items = [parsed.item()];
    }
  } else if (Symbol.iterator in badges) {
    items = Array.from(badges as Iterable<unknown>);
  }

  for (const badge of items) {
    if (!badge || typeof badge !== "object") continue;
    const candidate = badge as { icon_type?: unknown; label?: unknown };
    if (
      candidate.icon_type === "MUSIC_EXPLICIT_BADGE" ||
      (typeof candidate.label === "string" &&
        /explicit|esplicit/i.test(candidate.label))
    ) {
      return true;
    }
  }
  return false;
}

function normalizeResponsiveItem(
  item: YTNodes.MusicResponsiveListItem,
  options?: { allowUnknownWithVideoId?: boolean },
): Track | null {
  const itemType = item.item_type;
  if (options?.allowUnknownWithVideoId) {
    if (itemType && EXCLUDED_PLAYLIST_TRACK_TYPES.has(itemType)) {
      return null;
    }
  } else if (itemType !== "song" && itemType !== "video") {
    return null;
  }

  const videoId =
    item.id ||
    (item.overlay?.content?.endpoint?.payload?.videoId as string | undefined) ||
    (item.endpoint?.payload?.videoId as string | undefined) ||
    extractRunVideoId(item);

  if (!videoId) return null;

  const title =
    item.title?.trim() ||
    item.flex_columns?.[0]?.title?.toString()?.trim() ||
    "Titolo sconosciuto";

  const rawArtistData =
    item.artists && item.artists.length > 0
      ? extractTrackArtists(item.artists)
      : item.authors && item.authors.length > 0
        ? extractTrackArtists(item.authors)
        : (() => {
            const fallbackList = extractFallbackArtistsFromRuns(item);
            return {
              artists: fallbackList,
              artistNames: fallbackList.map((a) => a.name).join(", "),
              primaryArtistId: fallbackList.find((a) => a.id)?.id,
            };
          })();

  const artistNames = rawArtistData.artistNames || "Artista sconosciuto";
  const artists =
    rawArtistData.artists.length > 0
      ? rawArtistData.artists
      : [{ name: artistNames }];

  const albumName = item.album?.name?.trim() || undefined;
  const rawDurationText =
    item.duration?.text?.trim() ||
    item.fixed_columns?.[0]?.title?.toString()?.trim() ||
    "";
  const itemSeconds = sanitizeDurationSeconds(item.duration?.seconds);
  const parsedFromText = parseDurationToSeconds(rawDurationText);
  const durationSeconds = itemSeconds > 0 ? itemSeconds : parsedFromText;
  const durationText =
    rawDurationText || (durationSeconds > 0 ? formatTime(durationSeconds) : "");

  return {
    id: videoId,
    title,
    artist: artistNames,
    artistId: rawArtistData.primaryArtistId,
    artists,
    album: albumName,
    duration: durationText,
    durationSeconds,
    cover: extractBestThumbnail(item.thumbnails),
    itemType: itemType === "video" ? "video" : "song",
    isExplicit: hasExplicitBadge(item.badges) ? true : undefined,
  };
}

function normalizeTwoRowItem(item: YTNodes.MusicTwoRowItem): Track | null {
  if (item.item_type !== "song" && item.item_type !== "video") {
    return null;
  }

  const videoId =
    item.id ||
    (item.endpoint?.payload?.videoId as string | undefined);

  if (!videoId) return null;

  const title = item.title?.toString()?.trim();
  if (!title) return null;

  let artists: TrackArtist[] = [];
  let artist = "";
  let artistId: string | undefined;

  if (item.artists && item.artists.length > 0) {
    const parsed = extractTrackArtists(item.artists);
    artists = parsed.artists;
    artist = parsed.artistNames;
    artistId = parsed.primaryArtistId;
  } else if (item.author?.name) {
    const parsed = extractTrackArtists([item.author]);
    artists = parsed.artists;
    artist = parsed.artistNames;
    artistId = parsed.primaryArtistId;
  } else {
    const subtitleText = item.subtitle?.toString()?.trim() || "";
    const firstPart = subtitleText.split("•")[0]?.trim();
    if (firstPart && !VIEWS_PATTERN.test(firstPart)) {
      artist = firstPart;
      const runs = item.subtitle?.runs;
      const matchedRun = runs?.find((r) => r.text?.trim() === firstPart);
      const runBrowseId =
        matchedRun && "endpoint" in matchedRun
          ? (matchedRun.endpoint?.payload?.browseId as string | undefined)
          : undefined;
      artistId = isArtistBrowseId(runBrowseId) ? runBrowseId.trim() : undefined;
      artists = [{ name: firstPart, id: artistId }];
    }
  }

  const finalArtist = artist || "Artista sconosciuto";
  if (artists.length === 0) {
    artists = [{ name: finalArtist }];
  }

  return {
    id: videoId,
    title,
    artist: finalArtist,
    artistId,
    artists,
    duration: "",
    durationSeconds: 0,
    cover: extractBestThumbnail(item.thumbnail),
    itemType: item.item_type === "video" ? "video" : "song",
    isExplicit: hasExplicitBadge(item.badges) ? true : undefined,
  };
}

function normalizeCardShelfTopResult(
  card: YTNodes.MusicCardShelf,
): Track | null {
  const videoId = card.on_tap?.payload?.videoId as string | undefined;
  if (!videoId) return null;

  const title = card.title?.toString()?.trim();
  if (!title) return null;

  const subtitle = card.subtitle?.toString()?.trim() || "";
  const parts = subtitle
    .split("•")
    .map((p) => p.trim())
    .filter(Boolean);

  let artist = "Artista sconosciuto";
  let duration = "";
  for (const part of parts) {
    if (DURATION_PATTERN.test(part)) {
      duration = part;
    } else if (
      part !== "Brano" &&
      part !== "Song" &&
      part !== "Video" &&
      !VIEWS_PATTERN.test(part) &&
      artist === "Artista sconosciuto"
    ) {
      artist = part;
    }
  }

  const matchedRun = card.subtitle?.runs?.find(
    (r) => r.text?.trim() === artist,
  );
  const runBrowseId =
    matchedRun && "endpoint" in matchedRun
      ? (matchedRun.endpoint?.payload?.browseId as string | undefined)
      : undefined;
  const artistId = isArtistBrowseId(runBrowseId) ? runBrowseId.trim() : undefined;
  const durationSeconds = parseDurationToSeconds(duration);

  return {
    id: videoId,
    title,
    artist,
    artistId,
    artists: [{ name: artist, id: artistId }],
    duration: duration || (durationSeconds > 0 ? formatTime(durationSeconds) : ""),
    durationSeconds,
    cover: extractBestThumbnail(card.thumbnail?.contents),
    itemType: subtitle.toLowerCase().includes("video") ? "video" : "song",
  };
}

function normalizeArtistFromResponsiveItem(
  item: YTNodes.MusicResponsiveListItem,
): ArtistSummary | null {
  const browseId =
    item.id ||
    (item.endpoint?.payload?.browseId as string | undefined);
  const isArtist =
    item.item_type === "artist" ||
    item.item_type === "library_artist" ||
    isArtistBrowseId(browseId);

  if (!isArtist || !isArtistBrowseId(browseId)) {
    return null;
  }

  const name =
    item.name?.trim() ||
    item.title?.trim() ||
    item.flex_columns?.[0]?.title?.toString()?.trim();
  if (!name) return null;

  const rawSub =
    item.subscribers?.trim() ||
    item.flex_columns?.[1]?.title?.toString()?.trim() ||
    item.subtitle?.toString()?.trim();

  return {
    id: browseId.trim(),
    name,
    subtitle: rawSub || "Artista",
    thumbnail: extractBestThumbnail(item.thumbnails),
  };
}

function normalizeArtistFromCardShelf(
  card: YTNodes.MusicCardShelf,
): ArtistSummary | null {
  const browseId = card.on_tap?.payload?.browseId as string | undefined;
  const pageType = (
    card.on_tap?.payload?.browseEndpointContextSupportedConfigs as
      | { browseEndpointContextMusicConfig?: { pageType?: string } }
      | undefined
  )?.browseEndpointContextMusicConfig?.pageType;

  if (
    !isArtistBrowseId(browseId) &&
    pageType !== "MUSIC_PAGE_TYPE_ARTIST"
  ) {
    return null;
  }
  if (!browseId) return null;

  const name = card.title?.toString()?.trim();
  if (!name) return null;

  const subtitle = card.subtitle?.toString()?.trim() || "Artista";

  return {
    id: browseId.trim(),
    name,
    subtitle,
    thumbnail: extractBestThumbnail(card.thumbnail?.contents),
  };
}

function deduplicateArtists(artists: ArtistSummary[]): ArtistSummary[] {
  const seen = new Set<string>();
  const out: ArtistSummary[] = [];
  for (const artist of artists) {
    if (seen.has(artist.id)) continue;
    seen.add(artist.id);
    out.push(artist);
  }
  return out;
}

function deduplicateTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

export async function searchYTMusicCatalog(
  query: string,
  filter: SearchFilter = "song",
): Promise<SearchCatalogResult> {
  const trimmed = query.trim();
  if (!trimmed) return { tracks: [], artists: [] };

  const client = await getYTMusicClient();
  const [primarySearch, artistSearch] = await Promise.all([
    client.music.search(trimmed, filter === "all" ? {} : { type: filter }),
    filter === "video"
      ? Promise.resolve(null)
      : client.music.search(trimmed, { type: "artist" }).catch(() => null),
  ]);

  const collectedTracks: Track[] = [];
  const collectedArtists: ArtistSummary[] = [];

  if (primarySearch.contents) {
    for (const section of primarySearch.contents) {
      if (section.is(YTNodes.MusicCardShelf)) {
        const topArtist = normalizeArtistFromCardShelf(section);
        if (topArtist) collectedArtists.push(topArtist);

        if (filter === "all") {
          const topTrack = normalizeCardShelfTopResult(section);
          if (topTrack) collectedTracks.push(topTrack);
        }

        if (section.contents) {
          for (const child of section.contents) {
            if (child.is(YTNodes.MusicResponsiveListItem)) {
              const t = normalizeResponsiveItem(child);
              if (t) collectedTracks.push(t);
              const art = normalizeArtistFromResponsiveItem(child);
              if (art) collectedArtists.push(art);
            }
          }
        }
      } else if (section.is(YTNodes.MusicShelf)) {
        for (const item of section.contents) {
          if (item.is(YTNodes.MusicResponsiveListItem)) {
            const art = normalizeArtistFromResponsiveItem(item);
            if (art) collectedArtists.push(art);
            const t = normalizeResponsiveItem(item);
            if (t) collectedTracks.push(t);
          }
        }
      }
    }
  }

  if (artistSearch?.contents) {
    for (const section of artistSearch.contents) {
      if (section.is(YTNodes.MusicShelf)) {
        for (const item of section.contents) {
          if (item.is(YTNodes.MusicResponsiveListItem)) {
            const art = normalizeArtistFromResponsiveItem(item);
            if (art) collectedArtists.push(art);
          }
        }
      }
    }
  }

  const dedupedTracks = deduplicateTracks(collectedTracks);
  const orderedTracks =
    preferOfficialAudioEnabled && filter === "all"
      ? [
          ...dedupedTracks.filter((t) => t.itemType !== "video"),
          ...dedupedTracks.filter((t) => t.itemType === "video"),
        ]
      : dedupedTracks;

  return {
    tracks: orderedTracks,
    artists: deduplicateArtists(collectedArtists).slice(0, 6),
  };
}

export async function searchYTMusic(
  query: string,
  filter: SearchFilter = "song",
): Promise<Track[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const client = await getYTMusicClient();
  const search = await client.music.search(
    trimmed,
    filter === "all" ? {} : { type: filter },
  );

  const collected: Track[] = [];

  if (search.contents) {
    for (const section of search.contents) {
      if (section.is(YTNodes.MusicCardShelf) && filter === "all") {
        const topTrack = normalizeCardShelfTopResult(section);
        if (topTrack) collected.push(topTrack);
        if (section.contents) {
          for (const child of section.contents) {
            if (child.is(YTNodes.MusicResponsiveListItem)) {
              const t = normalizeResponsiveItem(child);
              if (t) collected.push(t);
            }
          }
        }
      } else if (section.is(YTNodes.MusicShelf)) {
        for (const item of section.contents) {
          if (item.is(YTNodes.MusicResponsiveListItem)) {
            const t = normalizeResponsiveItem(item);
            if (t) collected.push(t);
          }
        }
      }
    }
  }

  return deduplicateTracks(collected);
}

const HOME_FILTER_CONFIG: Record<
  Exclude<HomeMoodFilter, "all">,
  { chipPatterns: RegExp[]; query: string; label: string }
> = {
  workout: {
    chipPatterns: [/allenamento/i, /workout/i, /fitness/i],
    query: "workout gym training hits",
    label: "Allenamento",
  },
  energize: {
    chipPatterns: [/energia/i, /energize/i, /carica/i, /festa/i, /party/i],
    query: "energia upbeat pop dance hits",
    label: "Energia",
  },
  relax: {
    chipPatterns: [/relax/i, /rilassa/i, /chill/i, /calma/i, /sonno/i],
    query: "relax chill lofi acoustic",
    label: "Relax",
  },
  podcasts: {
    chipPatterns: [/podcast/i],
    query: "podcast musica italia",
    label: "Podcast",
  },
};

function parseHomeFeedSections(
  feedSections:
    | Iterable<YTNodes.MusicCarouselShelf | YTNodes.MusicTastebuilderShelf>
    | undefined,
  prefix: string,
): HomeFeedData {
  const sections: FeedSection[] = [];
  const playlistsMap = new Map<string, HomePlaylist>();

  if (!feedSections) {
    return { sections, playlists: [] };
  }

  let index = 0;
  for (const section of feedSections) {
    const sectionIndex = index++;
    if (!section.is(YTNodes.MusicCarouselShelf)) continue;
    const title =
      section.header?.title?.toString()?.trim() || `Sezione ${sectionIndex + 1}`;
    const tracks: Track[] = [];

    for (const item of section.contents) {
      if (item.is(YTNodes.MusicResponsiveListItem)) {
        const t = normalizeResponsiveItem(item);
        if (t) tracks.push(t);
      } else if (item.is(YTNodes.MusicTwoRowItem)) {
        if (item.item_type === "playlist") {
          const rawId =
            item.id || (item.endpoint?.payload?.browseId as string | undefined);
          const pid = normalizePlaylistId(rawId, true);
          if (pid && !playlistsMap.has(pid)) {
            const rawCover = extractBestThumbnail(item.thumbnail);
            playlistsMap.set(pid, {
              id: pid,
              title: item.title?.toString()?.trim() || "Playlist YouTube Music",
              subtitle: item.subtitle?.toString()?.trim() || undefined,
              cover: rawCover.startsWith("data:") ? "" : rawCover,
              trackCount: item.item_count ?? undefined,
            });
          }
          continue;
        }
        const t = normalizeTwoRowItem(item);
        if (t) tracks.push(t);
      }
    }

    const unique = deduplicateTracks(tracks);
    if (unique.length > 0) {
      sections.push({
        id: `${prefix}-${sectionIndex}-${title}`,
        title,
        tracks: unique,
      });
    }
  }

  return {
    sections,
    playlists: Array.from(playlistsMap.values()),
  };
}

function buildCompositeHomePlaylists(
  sections: FeedSection[],
  existing: HomePlaylist[],
  filter: HomeMoodFilter,
): HomePlaylist[] {
  const out = [...existing];
  if (out.length >= 4 || sections.length === 0) {
    return out.slice(0, 8);
  }

  const allTracks = deduplicateTracks(sections.flatMap((s) => s.tracks));
  if (allTracks.length < 2) {
    return out;
  }

  const filterLabel =
    filter === "all" ? "Per te" : HOME_FILTER_CONFIG[filter].label;
  const presets = [
    { title: `Scelte rapide · ${filterLabel}`, subtitle: "Mix basato sulle tue tendenze" },
    { title: `Dalla community · ${filterLabel}`, subtitle: "Selezione curata da YouTube Music" },
    { title: `Mix continuo · ${filterLabel}`, subtitle: "Brani consigliati per questa sessione" },
    { title: `Scoperte · ${filterLabel}`, subtitle: "Nuovi ascolti selezionati" },
  ];

  const needed = Math.min(4 - out.length, presets.length);
  for (let i = 0; i < needed; i++) {
    const start = (i * 4) % allTracks.length;
    const rotated = [...allTracks.slice(start), ...allTracks.slice(0, start)];
    const chunk = rotated.slice(0, Math.min(8, rotated.length));
    const uniqueCovers = Array.from(
      new Set(
        chunk
          .map((t) => t.cover)
          .filter((c) => Boolean(c) && !c.startsWith("data:image/svg")),
      ),
    ).slice(0, 4);

    if (chunk.length === 0) continue;

    out.push({
      id: `composite-${filter}-${i}`,
      title: presets[i].title,
      subtitle: presets[i].subtitle,
      cover: uniqueCovers[0] || chunk[0].cover,
      previewCovers: uniqueCovers.length >= 2 ? uniqueCovers : undefined,
      trackCount: `${chunk.length} brani`,
      isComposite: true,
      tracks: chunk,
    });
  }

  return out;
}

export async function fetchHomeFeed(
  filter: HomeMoodFilter = "all",
  options?: { forceRefresh?: boolean },
): Promise<HomeFeedData> {
  if (!options?.forceRefresh) {
    const cached = homeFeedCache.get(filter);
    if (cached) return cached;
  }

  const client = await getYTMusicClient();
  const baseFeed = await client.music.getHomeFeed();
  let targetFeed = baseFeed;
  let appliedNativeFilter = filter === "all";

  if (filter !== "all") {
    const config = HOME_FILTER_CONFIG[filter];
    const availableFilters = baseFeed.filters ?? [];
    const matchedChip = availableFilters.find((chip) =>
      config.chipPatterns.some((pattern) => pattern.test(chip.trim())),
    );
    if (matchedChip) {
      try {
        targetFeed = await baseFeed.applyFilter(matchedChip);
        appliedNativeFilter = true;
      } catch (err: unknown) {
        if (isAuthExpiredError(err)) {
          throw err;
        }
        appliedNativeFilter = false;
      }
    }
  }

  let { sections, playlists } = parseHomeFeedSections(
    targetFeed.sections,
    `home-${filter}`,
  );

  if (filter !== "all" && (!appliedNativeFilter || sections.length === 0)) {
    const config = HOME_FILTER_CONFIG[filter];
    const queryTracks = await searchYTMusic(
      config.query,
      filter === "podcasts" ? "all" : "song",
    );
    if (queryTracks.length > 0) {
      const quickSlice = queryTracks.slice(0, 8);
      const communitySlice = queryTracks.slice(8, 20);
      sections = [
        {
          id: `home-${filter}-quick`,
          title: `Scelte rapide · ${config.label}`,
          tracks: quickSlice,
        },
        ...(communitySlice.length > 0
          ? [
              {
                id: `home-${filter}-community`,
                title: `Dalla community · ${config.label}`,
                tracks: communitySlice,
              },
            ]
          : []),
      ];
    }
  }

  const enrichedPlaylists = buildCompositeHomePlaylists(
    sections,
    playlists,
    filter,
  );
  const result: HomeFeedData = { sections, playlists: enrichedPlaylists };
  homeFeedCache.set(filter, result);
  return result;
}

export async function fetchExploreFeed(): Promise<FeedSection[]> {
  const client = await getYTMusicClient();
  const explore = await client.music.getExplore();
  const sections: FeedSection[] = [];

  explore.sections.forEach((section, index) => {
    if (!section.is(YTNodes.MusicCarouselShelf)) return;
    const title =
      section.header?.title?.toString()?.trim() || `Esplora ${index + 1}`;
    const tracks: Track[] = [];

    for (const item of section.contents) {
      if (item.is(YTNodes.MusicResponsiveListItem)) {
        const t = normalizeResponsiveItem(item);
        if (t) tracks.push(t);
      } else if (item.is(YTNodes.MusicTwoRowItem)) {
        const t = normalizeTwoRowItem(item);
        if (t) tracks.push(t);
      }
    }

    const unique = deduplicateTracks(tracks);
    if (unique.length > 0) {
      sections.push({
        id: `explore-${index}-${title}`,
        title,
        tracks: unique,
      });
    }
  });

  return sections;
}

export async function fetchAccountProfile(): Promise<AuthUser> {
  const client = await getYTMusicClient();
  if (!client.session.logged_in) {
    throw new AuthExpiredError("Sessione non autenticata.");
  }

  const accounts = await client.account.getInfo(true);
  const selected = accounts.find((a) => a.is_selected) ?? accounts[0];
  if (!selected) {
    throw new AuthExpiredError("Sessione scaduta o non valida.");
  }

  const name = selected.account_name?.toString()?.trim() || "Account Google";
  const handle =
    selected.channel_handle?.toString()?.trim() ||
    selected.account_byline?.toString()?.trim() ||
    undefined;

  const rawAvatar =
    selected.account_photo && selected.account_photo.length > 0
      ? extractBestThumbnail(selected.account_photo)
      : undefined;
  const avatar =
    rawAvatar && !rawAvatar.startsWith("data:") ? rawAvatar : undefined;

  return { name, handle, avatar };
}

function normalizePlaylistId(
  rawId?: string,
  isPlaylistType?: boolean,
): string | null {
  if (!rawId) return null;
  const trimmed = rawId.trim();
  if (!trimmed) return null;

  const clean = trimmed.startsWith("VL") ? trimmed.slice(2) : trimmed;
  if (!clean) return null;
  if (
    clean.startsWith("FEmusic_") ||
    clean.startsWith("MPRE") ||
    clean.startsWith("UC") ||
    clean.startsWith("SP")
  ) {
    return null;
  }

  if (
    isPlaylistType ||
    clean === "LM" ||
    clean.startsWith("PL") ||
    clean.startsWith("RDCLAK") ||
    clean.startsWith("OLAK")
  ) {
    return clean;
  }

  return null;
}

function collectRemotePlaylistFromNode(
  node: YTNodes.MusicTwoRowItem | YTNodes.MusicResponsiveListItem,
  collected: Map<string, RemotePlaylist>,
): void {
  if (node instanceof YTNodes.MusicTwoRowItem) {
    const rawId =
      node.id || (node.endpoint?.payload?.browseId as string | undefined);
    const id = normalizePlaylistId(rawId, node.item_type === "playlist");
    if (!id || collected.has(id)) return;

    const title =
      node.title?.toString()?.trim() ||
      (id === "LM" ? "Brani che ti piacciono" : "Playlist senza titolo");
    const subtitle = node.subtitle?.toString()?.trim() || undefined;
    const rawCover = extractBestThumbnail(node.thumbnail);

    collected.set(id, {
      id,
      title,
      subtitle,
      cover: rawCover.startsWith("data:") ? "" : rawCover,
      trackCount: node.item_count ?? undefined,
      isLikedSongs: id === "LM",
      isRemote: true,
    });
    return;
  }

  const rawId =
    node.id || (node.endpoint?.payload?.browseId as string | undefined);
  const id = normalizePlaylistId(rawId, node.item_type === "playlist");
  if (!id || collected.has(id)) return;

  const title =
    node.title?.trim() ||
    node.name?.trim() ||
    node.flex_columns?.[0]?.title?.toString()?.trim() ||
    (id === "LM" ? "Brani che ti piacciono" : "Playlist senza titolo");
  const subtitle = node.subtitle?.toString()?.trim() || undefined;
  const rawCover = extractBestThumbnail(node.thumbnails);

  collected.set(id, {
    id,
    title,
    subtitle,
    cover: rawCover.startsWith("data:") ? "" : rawCover,
    trackCount: node.song_count ?? node.item_count ?? undefined,
    isLikedSongs: id === "LM",
    isRemote: true,
  });
}

export function isEditableRemotePlaylist(playlist: RemotePlaylist): boolean {
  const cleanId = playlist.id.trim().replace(/^VL/, "");
  return Boolean(
    playlist.isLikedSongs || cleanId === "LM" || cleanId.startsWith("PL"),
  );
}

function collectPlaylistsFromContainer(
  container: unknown,
  collected: Map<string, RemotePlaylist>,
): void {
  if (!container || typeof container !== "object") return;

  if (
    container instanceof YTNodes.MusicTwoRowItem ||
    container instanceof YTNodes.MusicResponsiveListItem
  ) {
    collectRemotePlaylistFromNode(container, collected);
    return;
  }

  if (container instanceof YTNodes.Grid) {
    for (const item of container.items) {
      if (
        item.is(YTNodes.MusicTwoRowItem) ||
        item.is(YTNodes.MusicResponsiveListItem)
      ) {
        collectRemotePlaylistFromNode(item, collected);
      }
    }
    return;
  }

  if (container instanceof YTNodes.MusicShelf) {
    for (const item of container.contents) {
      collectRemotePlaylistFromNode(item, collected);
    }
    return;
  }

  if (container instanceof YTNodes.MusicCarouselShelf) {
    for (const item of container.contents) {
      if (
        item.is(YTNodes.MusicTwoRowItem) ||
        item.is(YTNodes.MusicResponsiveListItem)
      ) {
        collectRemotePlaylistFromNode(item, collected);
      }
    }
    return;
  }

  if (container instanceof YTNodes.ItemSection) {
    for (const nested of container.contents) {
      collectPlaylistsFromContainer(nested, collected);
    }
  }
}

function collectPlaylistsFromContainers(
  containers: Iterable<unknown> | undefined,
  collected: Map<string, RemotePlaylist>,
): void {
  if (!containers) return;
  for (const container of containers) {
    collectPlaylistsFromContainer(container, collected);
  }
}

function collectPlaylistsFromContinuation(
  contContents: unknown,
  collected: Map<string, RemotePlaylist>,
): void {
  if (!contContents || typeof contContents !== "object") return;
  const node = contContents as {
    is?: (...types: unknown[]) => boolean;
    items?: Iterable<unknown>;
    contents?: Iterable<unknown>;
  };
  if (typeof node.is !== "function") return;
  const items = node.is(GridContinuation)
    ? node.items ?? node.contents
    : node.is(MusicShelfContinuation)
      ? node.contents
      : undefined;
  if (!items) return;
  for (const item of items) {
    collectPlaylistsFromContainer(item, collected);
  }
}

export async function fetchRemotePlaylists(): Promise<RemotePlaylist[]> {
  const client = await getYTMusicClient();
  if (!client.session.logged_in) {
    throw new AuthExpiredError("Sessione non autenticata.");
  }

  const collected = new Map<string, RemotePlaylist>();
  const library = await client.music.getLibrary();

  const playlistChip = library.filters.find((chip) =>
    /playlist/i.test(chip.trim()),
  );

  if (playlistChip) {
    try {
      const filtered = await library.applyFilter(playlistChip);
      collectPlaylistsFromContainers(filtered.contents, collected);

      let contCount = 0;
      if (filtered.has_continuation) {
        let cont = await filtered.getContinuation();
        while (contCount < 2) {
          contCount += 1;
          collectPlaylistsFromContinuation(cont.contents, collected);
          if (!cont.has_continuation) break;
          cont = await cont.getContinuation();
        }
      }
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) {
        throw err;
      }
      // Fallback: leggi comunque le playlist visibili nella vista libreria base
    }
  }

  collectPlaylistsFromContainers(library.contents, collected);

  if (!playlistChip && library.has_continuation) {
    try {
      let cont = await library.getContinuation();
      let contCount = 0;
      while (contCount < 2) {
        contCount += 1;
        collectPlaylistsFromContinuation(cont.contents, collected);
        if (!cont.has_continuation) break;
        cont = await cont.getContinuation();
      }
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) {
        throw err;
      }
    }
  }

  // Fallback diretto a FEmusic_liked_playlists se solo LM (o nessuna playlist) è stato trovato
  const hasNonLikedPlaylist = [...collected.keys()].some((id) => id !== "LM");
  if (!hasNonLikedPlaylist) {
    try {
      const fallback = await client.actions.execute("/browse", {
        browseId: "FEmusic_liked_playlists",
        client: "YTMUSIC",
        parse: true,
      });
      const twoRowItems = fallback.contents_memo?.getType(
        YTNodes.MusicTwoRowItem,
      );
      if (twoRowItems) {
        for (const item of twoRowItems) {
          collectRemotePlaylistFromNode(item, collected);
        }
      }
      const listItems = fallback.contents_memo?.getType(
        YTNodes.MusicResponsiveListItem,
      );
      if (listItems) {
        for (const item of listItems) {
          collectRemotePlaylistFromNode(item, collected);
        }
      }
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) {
        throw err;
      }
    }
  }

  const liked = collected.get("LM");
  collected.delete("LM");
  const likedEntry: RemotePlaylist = liked
    ? { ...liked, isLikedSongs: true, isRemote: true }
    : {
        id: "LM",
        title: "Brani che ti piacciono",
        subtitle: "Playlist YouTube Music",
        cover: "",
        isLikedSongs: true,
        isRemote: true,
      };

  return [likedEntry, ...collected.values()];
}

export async function fetchRemotePlaylistTracks(
  playlistId: string,
  options?: { forceRefresh?: boolean },
): Promise<Track[]> {
  const normalizedId = playlistId.trim().replace(/^VL/, "");
  if (!options?.forceRefresh) {
    const cached = remotePlaylistTracksCache.get(normalizedId);
    if (cached) return cached;
  }

  const client = await getYTMusicClient();
  let page = await client.music.getPlaylist(normalizedId);
  const collected: Track[] = [];

  const collectPage = (current: typeof page) => {
    for (const item of current.items) {
      if (item.is(YTNodes.MusicResponsiveListItem)) {
        const track = normalizeResponsiveItem(item, {
          allowUnknownWithVideoId: true,
        });
        if (track) collected.push(track);
      }
    }
  };

  collectPage(page);

  let pagesLoaded = 1;
  while (page.has_continuation && pagesLoaded < 4 && collected.length < 250) {
    try {
      page = await page.getContinuation();
      collectPage(page);
      pagesLoaded += 1;
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) {
        throw err;
      }
      break;
    }
  }

  const unique = deduplicateTracks(collected);
  remotePlaylistTracksCache.set(normalizedId, unique);
  return unique;
}

async function assertLoggedInClient(): Promise<Innertube> {
  const client = await getYTMusicClient();
  if (!client.session.logged_in) {
    throw new AuthExpiredError("Sessione non autenticata.");
  }
  return client;
}

function assertEditResponseOk(
  response: { success?: boolean; data?: unknown },
  fallbackError: string,
): void {
  const dataRecord =
    response.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : undefined;
  if (response.success === false || dataRecord?.status === "STATUS_FAILED") {
    throw new Error(fallbackError);
  }
}

export async function addTrackToRemotePlaylist(
  playlistId: string,
  videoId: string,
  options?: { allowDuplicate?: boolean },
): Promise<void> {
  const cleanId = playlistId.trim().replace(/^VL/, "");
  const cleanVideoId = videoId.trim();
  if (!cleanId || !cleanVideoId) {
    throw new Error("ID playlist o brano non valido.");
  }

  const client = await assertLoggedInClient();

  if (cleanId === "LM") {
    try {
      const res = await client.actions.execute("/like/like", {
        target: { videoId: cleanVideoId },
        client: "YTMUSIC",
      });
      assertEditResponseOk(
        res,
        "Impossibile aggiungere il brano ai preferiti YouTube Music.",
      );
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) throw err;
      const fallback = await client.interact.like(cleanVideoId);
      assertEditResponseOk(
        fallback,
        "Impossibile aggiungere il brano ai preferiti YouTube Music.",
      );
    }
    clearRemotePlaylistCache("LM");
    return;
  }

  try {
    const res = await client.actions.execute("/browse/edit_playlist", {
      playlistId: cleanId,
      actions: [
        {
          action: "ACTION_ADD_VIDEO",
          addedVideoId: cleanVideoId,
          dedupeOption: options?.allowDuplicate
            ? "DEDUPE_OPTION_SKIP"
            : "DEDUPE_OPTION_CHECK",
        },
      ],
      client: "YTMUSIC",
    });
    assertEditResponseOk(
      res,
      "Impossibile aggiungere il brano alla playlist YouTube Music.",
    );
  } catch (err: unknown) {
    if (isAuthExpiredError(err)) throw err;
    await client.playlist.addVideos(cleanId, [cleanVideoId]);
  }

  clearRemotePlaylistCache(cleanId);
}

export async function removeTrackFromRemotePlaylist(
  playlistId: string,
  videoId: string,
): Promise<void> {
  const cleanId = playlistId.trim().replace(/^VL/, "");
  const cleanVideoId = videoId.trim();
  if (!cleanId || !cleanVideoId) {
    throw new Error("ID playlist o brano non valido.");
  }

  const client = await assertLoggedInClient();

  if (cleanId === "LM") {
    try {
      const res = await client.actions.execute("/like/removelike", {
        target: { videoId: cleanVideoId },
        client: "YTMUSIC",
      });
      assertEditResponseOk(
        res,
        "Impossibile rimuovere il brano dai preferiti YouTube Music.",
      );
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) throw err;
      const fallback = await client.interact.removeRating(cleanVideoId);
      assertEditResponseOk(
        fallback,
        "Impossibile rimuovere il brano dai preferiti YouTube Music.",
      );
    }
    clearRemotePlaylistCache("LM");
    return;
  }

  try {
    await client.playlist.removeVideos(cleanId, [cleanVideoId]);
  } catch (err: unknown) {
    if (isAuthExpiredError(err)) throw err;
    const res = await client.actions.execute("/browse/edit_playlist", {
      playlistId: cleanId,
      actions: [
        {
          action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID",
          removedVideoId: cleanVideoId,
        },
      ],
      client: "YTMUSIC",
    });
    assertEditResponseOk(
      res,
      "Impossibile rimuovere il brano dalla playlist YouTube Music.",
    );
  }

  clearRemotePlaylistCache(cleanId);
}

export async function createRemotePlaylist(
  title: string,
  description?: string,
  privacyStatus: PlaylistPrivacyStatus = "PRIVATE",
  videoIds?: string[],
): Promise<string> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error("Inserisci un nome valido per la playlist.");
  }

  const trimmedDescription = description?.trim() || undefined;
  const normalizedPrivacy: PlaylistPrivacyStatus =
    privacyStatus === "PUBLIC" ||
    privacyStatus === "UNLISTED" ||
    privacyStatus === "PRIVATE"
      ? privacyStatus
      : "PRIVATE";
  const cleanedVideoIds = (videoIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);

  const client = await assertLoggedInClient();
  let createdId: string | undefined;

  try {
    const payload: Record<string, unknown> = {
      title: trimmedTitle,
      privacyStatus: normalizedPrivacy,
      client: "YTMUSIC",
    };
    if (trimmedDescription) {
      payload.description = trimmedDescription;
    }
    if (cleanedVideoIds.length > 0) {
      payload.videoIds = cleanedVideoIds;
    }

    const res = await client.actions.execute("/playlist/create", payload);
    assertEditResponseOk(
      res,
      "Impossibile creare la playlist su YouTube Music.",
    );

    const dataRecord =
      res.data && typeof res.data === "object"
        ? (res.data as { playlistId?: unknown; playlist_id?: unknown })
        : undefined;
    const rawId =
      typeof dataRecord?.playlistId === "string"
        ? dataRecord.playlistId
        : typeof dataRecord?.playlist_id === "string"
          ? dataRecord.playlist_id
          : undefined;
    if (rawId?.trim()) {
      createdId = rawId.trim();
    }
  } catch (err: unknown) {
    if (isAuthExpiredError(err)) throw err;
  }

  if (!createdId) {
    const fallback = await client.playlist.create(
      trimmedTitle,
      cleanedVideoIds,
      normalizedPrivacy,
      trimmedDescription,
    );
    if (fallback.playlist_id?.trim()) {
      createdId = fallback.playlist_id.trim();
    }
  }

  if (!createdId) {
    throw new Error(
      "YouTube Music non ha restituito l'ID della nuova playlist.",
    );
  }

  const cleanId = createdId.replace(/^VL/, "");
  clearRemotePlaylistCache(cleanId);
  return cleanId;
}

export function formatNetworkError(err: unknown): string {
  if (isAuthExpiredError(err)) {
    return "Sessione scaduta, effettua nuovamente l'accesso.";
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("not allowed") || lower.includes("scope") || lower.includes("forbidden")) {
    return "Richiesta bloccata dalle capabilities HTTP di Tauri. Verifica i domini autorizzati.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Connessione scaduta durante il contatto con YouTube Music. Riprova tra qualche secondo.";
  }
  if (
    lower.includes("dns") ||
    lower.includes("network") ||
    lower.includes("connect") ||
    lower.includes("failed to fetch")
  ) {
    return "Impossibile raggiungere YouTube Music. Controlla la connessione internet.";
  }
  if (lower.includes("status code 429")) {
    return "Troppe richieste ravvicinate verso YouTube Music. Attendi un momento e riprova.";
  }

  return "Si è verificato un problema durante il caricamento dei dati da YouTube Music.";
}

export type StreamClientName = "VISIONOS" | "ANDROID_VR" | "IOS";

export interface ResolvedAudioStream {
  url: string;
  mimeType: string;
  codec: string;
  bitrate: number;
  itag?: number;
  sampleRate?: number;
  audioChannels?: number;
  audioQuality?: string;
  durationSeconds: number;
  contentLength?: number;
  userAgent: string;
  clientUsed: StreamClientName;
  expiresAtMs: number;
}

interface StreamClientCandidate {
  client: StreamClientName;
  userAgent: string;
}

const STREAM_CLIENTS: StreamClientCandidate[] = [
  {
    client: "VISIONOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  },
  {
    client: "ANDROID_VR",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
  {
    client: "IOS",
    userAgent:
      "com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)",
  },
];

const streamCache = new Map<string, ResolvedAudioStream>();
const STREAM_EXPIRY_SAFETY_MS = 5 * 60 * 1000;
const DEFAULT_STREAM_TTL_MS = 30 * 60 * 1000;

export function invalidateAudioStreamCache(videoId?: string): void {
  if (videoId) {
    streamCache.delete(videoId);
  } else {
    streamCache.clear();
  }
}

export function getCachedAudioStream(
  videoId: string,
): ResolvedAudioStream | null {
  return streamCache.get(videoId) ?? null;
}

function extractCodecFromMime(rawMime: string): string {
  const codecMatch = rawMime.match(/codecs="([^"]+)"/i);
  if (codecMatch?.[1]) {
    const rawCodec = codecMatch[1].trim();
    if (/^mp4a\.40/i.test(rawCodec)) {
      return `${rawCodec} (AAC)`;
    }
    if (/^opus/i.test(rawCodec)) {
      return "Opus";
    }
    return rawCodec;
  }
  const base = rawMime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mp4") return "AAC";
  if (base === "audio/webm") return "Opus";
  return base || "Sconosciuto";
}

function extractStreamExpiryMs(streamUrl: string): number {
  try {
    const parsed = new URL(streamUrl);
    const expireSec = Number(parsed.searchParams.get("expire"));
    if (Number.isFinite(expireSec) && expireSec > 0) {
      return expireSec * 1000 - STREAM_EXPIRY_SAFETY_MS;
    }
  } catch {
    // fallback TTL
  }
  return Date.now() + DEFAULT_STREAM_TTL_MS;
}

function selectOptimalAudioFormat<
  T extends {
    itag?: number;
    url?: string;
    has_audio: boolean;
    has_video: boolean;
    mime_type: string;
    bitrate: number;
    average_bitrate?: number;
    audio_sample_rate?: number;
    audio_channels?: number;
    audio_quality?: string;
    is_dubbed?: boolean;
    audio_track?: { audio_is_default: boolean };
  },
>(formats: T[]): T | null {
  const candidates = formats.filter(
    (f) => f.has_audio && !f.has_video && typeof f.url === "string" && f.url.length > 0,
  );
  if (candidates.length === 0) return null;

  const originalPool = candidates.filter(
    (f) => !f.is_dubbed && f.audio_track?.audio_is_default !== false,
  );
  const pool = originalPool.length > 0 ? originalPool : candidates;

  const bitrateOf = (f: T) => f.average_bitrate ?? f.bitrate ?? 0;
  const byBitrateDesc = (a: T, b: T) => bitrateOf(b) - bitrateOf(a);
  const byBitrateAsc = (a: T, b: T) => bitrateOf(a) - bitrateOf(b);

  const pickByQuality = (sortedDesc: T[]): T | null => {
    if (sortedDesc.length === 0) return null;
    if (lowDataModeEnabled || preferredAudioQuality === "normal") {
      return [...sortedDesc].sort(byBitrateAsc)[0];
    }
    if (preferredAudioQuality === "high") {
      return (
        sortedDesc.find((f) => bitrateOf(f) <= 165_000) ??
        sortedDesc[sortedDesc.length - 1]
      );
    }
    return sortedDesc[0];
  };

  const mp4Formats = pool
    .filter((f) => f.mime_type.startsWith("audio/mp4"))
    .sort(byBitrateDesc);
  const webmFormats = pool
    .filter((f) => f.mime_type.startsWith("audio/webm"))
    .sort(byBitrateDesc);

  if (preferredAudioFormat === "webm_opus") {
    const webmPick = pickByQuality(webmFormats);
    if (webmPick) return webmPick;
    const mp4Pick = pickByQuality(mp4Formats);
    if (mp4Pick) return mp4Pick;
  } else {
    // Su macOS WKWebView (AVFoundation) audio/mp4 (AAC-LC) garantisce compatibilità hardware e seek senza glitch.
    const mp4Pick = pickByQuality(mp4Formats);
    if (mp4Pick) return mp4Pick;
    const webmPick = pickByQuality(webmFormats);
    if (webmPick) return webmPick;
  }

  return pickByQuality([...pool].sort(byBitrateDesc));
}

export async function resolveAudioStream(
  videoId: string,
  options?: { forceRefresh?: boolean },
): Promise<ResolvedAudioStream> {
  if (!options?.forceRefresh) {
    const cached = streamCache.get(videoId);
    if (cached && Date.now() < cached.expiresAtMs) {
      return cached;
    }
  }

  const primaryClient = await getYTMusicClient();
  let lastReason = "";

  const tryClients = async (client: Innertube): Promise<ResolvedAudioStream | null> => {
    for (const candidate of STREAM_CLIENTS) {
      try {
        const info = await client.getBasicInfo(videoId, { client: candidate.client });
        const status = info.playability_status?.status;
        if (status && status !== "OK") {
          lastReason = info.playability_status?.reason || status;
          continue;
        }

        const adaptiveFormats = info.streaming_data?.adaptive_formats ?? [];
        const bestFormat = selectOptimalAudioFormat(adaptiveFormats);
        if (!bestFormat?.url) {
          continue;
        }

        const basicDuration = sanitizeDurationSeconds(info.basic_info?.duration);
        const approxMs = Number(bestFormat.approx_duration_ms);
        const approxDuration =
          Number.isFinite(approxMs) && approxMs > 0
            ? Math.round(approxMs / 1000)
            : 0;
        const durationSeconds = basicDuration > 0 ? basicDuration : approxDuration;

        return {
          url: bestFormat.url,
          mimeType: bestFormat.mime_type.split(";")[0]?.trim() || "audio/mp4",
          codec: extractCodecFromMime(bestFormat.mime_type),
          bitrate: bestFormat.average_bitrate ?? bestFormat.bitrate ?? 0,
          itag: bestFormat.itag,
          sampleRate: bestFormat.audio_sample_rate,
          audioChannels: bestFormat.audio_channels,
          audioQuality: bestFormat.audio_quality,
          durationSeconds,
          contentLength: bestFormat.content_length,
          userAgent: candidate.userAgent,
          clientUsed: candidate.client,
          expiresAtMs: extractStreamExpiryMs(bestFormat.url),
        };
      } catch (err: unknown) {
        lastReason = err instanceof Error ? err.message : String(err);
      }
    }
    return null;
  };

  let resolved = await tryClients(primaryClient);
  if (!resolved && activeAuthCookie) {
    // Alcuni client stream (VISIONOS/ANDROID_VR/IOS) rifiutano cookie web su /player:
    // ripieghiamo in modo trasparente sul client ospite per mantenere fluido lo streaming.
    const guestClient = await getGuestStreamClient();
    resolved = await tryClients(guestClient);
  }

  if (resolved) {
    streamCache.set(videoId, resolved);
    return resolved;
  }

  throw new Error(
    lastReason
      ? `Impossibile ottenere lo stream audio (${lastReason}).`
      : "Nessun formato audio riproducibile disponibile per questo brano.",
  );
}

function normalizePlaylistPanelVideo(
  item: YTNodes.PlaylistPanelVideo,
): Track | null {
  const videoId =
    item.video_id || (item.endpoint?.payload?.videoId as string | undefined);
  if (!videoId) return null;

  const title = item.title?.toString()?.trim();
  if (!title) return null;

  const rawArtistData =
    item.artists && item.artists.length > 0
      ? extractTrackArtists(item.artists)
      : {
          artists: item.author?.trim() ? [{ name: item.author.trim() }] : [],
          artistNames: item.author?.trim() || "",
          primaryArtistId: undefined,
        };
  const artistNames = rawArtistData.artistNames || "Artista sconosciuto";
  const artists =
    rawArtistData.artists.length > 0
      ? rawArtistData.artists
      : [{ name: artistNames }];

  const rawDurationText = item.duration?.text?.trim() || "";
  const itemSeconds = sanitizeDurationSeconds(item.duration?.seconds);
  const parsedFromText = parseDurationToSeconds(rawDurationText);
  const durationSeconds = itemSeconds > 0 ? itemSeconds : parsedFromText;
  const durationText =
    rawDurationText || (durationSeconds > 0 ? formatTime(durationSeconds) : "");

  return {
    id: videoId,
    title,
    artist: artistNames,
    artistId: rawArtistData.primaryArtistId,
    artists,
    album: item.album?.name?.trim() || undefined,
    duration: durationText,
    durationSeconds,
    cover: extractBestThumbnail(item.thumbnail),
    itemType: "song",
    isExplicit: hasExplicitBadge(item.badges) ? true : undefined,
  };
}

function extractTracksFromPlaylistPanel(
  panel?: YTNodes.PlaylistPanel | null,
): Track[] {
  if (!panel?.contents) return [];
  const collected: Track[] = [];
  for (const entry of panel.contents) {
    if (entry.is(YTNodes.PlaylistPanelVideo)) {
      const parsed = normalizePlaylistPanelVideo(entry);
      if (parsed) collected.push(parsed);
    } else if (
      entry.is(YTNodes.PlaylistPanelVideoWrapper) &&
      entry.primary?.is(YTNodes.PlaylistPanelVideo)
    ) {
      const parsed = normalizePlaylistPanelVideo(entry.primary);
      if (parsed) collected.push(parsed);
    }
  }
  return collected;
}

export async function getRadioTracks(
  videoId: string,
  playlistId?: string,
): Promise<Track[]> {
  const cleanVideoId = videoId.trim();
  if (!cleanVideoId) return [];

  const cleanPlaylistId = playlistId?.trim().replace(/^VL/, "");
  const targetPlaylistId = cleanPlaylistId || `RDAMVM${cleanVideoId}`;
  const client = await getYTMusicClient();
  const collected: Track[] = [];

  try {
    const nextRes = await client.actions.execute("/next", {
      videoId: cleanVideoId,
      playlistId: targetPlaylistId,
      enablePersistentPlaylistPanel: true,
      tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
      client: "YTMUSIC",
      parse: true,
    });

    const panels = nextRes.contents_memo?.getType(YTNodes.PlaylistPanel);
    if (panels) {
      for (const panel of panels) {
        collected.push(...extractTracksFromPlaylistPanel(panel));
      }
    }

    if (collected.length <= 1) {
      const automixPreview = nextRes.contents_memo?.getType(
        YTNodes.AutomixPreviewVideo,
      )?.[0];
      const automixEndpoint = automixPreview?.playlist_video?.endpoint;
      if (automixEndpoint) {
        const automixPage = await automixEndpoint.call(client.actions, {
          videoId: cleanVideoId,
          client: "YTMUSIC",
          parse: true,
        });
        const automixPanels =
          automixPage.contents_memo?.getType(YTNodes.PlaylistPanel);
        if (automixPanels) {
          for (const panel of automixPanels) {
            collected.push(...extractTracksFromPlaylistPanel(panel));
          }
        }
      }
    }

    if (collected.length === 0) {
      const panelVideos = nextRes.contents_memo?.getType(
        YTNodes.PlaylistPanelVideo,
      );
      if (panelVideos) {
        for (const item of panelVideos) {
          const parsed = normalizePlaylistPanelVideo(item);
          if (parsed) collected.push(parsed);
        }
      }
    }
  } catch {
    // Passa ai fallback getUpNext / getRelated
  }

  let filtered = deduplicateTracks(collected).filter(
    (t) => t.id !== cleanVideoId,
  );

  if (filtered.length === 0) {
    try {
      const upNext = await client.music.getUpNext(cleanVideoId, true);
      collected.push(...extractTracksFromPlaylistPanel(upNext));
      filtered = deduplicateTracks(collected).filter(
        (t) => t.id !== cleanVideoId,
      );
    } catch {
      // Passa al fallback getRelated
    }
  }

  if (filtered.length === 0) {
    try {
      const related = await client.music.getRelated(cleanVideoId);
      if (related.is(YTNodes.SectionList)) {
        for (const section of related.contents) {
          if (section.is(YTNodes.MusicCarouselShelf)) {
            for (const item of section.contents) {
              if (item.is(YTNodes.MusicResponsiveListItem)) {
                const t = normalizeResponsiveItem(item);
                if (t) collected.push(t);
              } else if (item.is(YTNodes.MusicTwoRowItem)) {
                const t = normalizeTwoRowItem(item);
                if (t) collected.push(t);
              }
            }
          } else if (section.is(YTNodes.MusicShelf)) {
            for (const item of section.contents) {
              if (item.is(YTNodes.MusicResponsiveListItem)) {
                const t = normalizeResponsiveItem(item);
                if (t) collected.push(t);
              }
            }
          }
        }
        filtered = deduplicateTracks(collected).filter(
          (t) => t.id !== cleanVideoId,
        );
      }
    } catch {
      // Nessun correlato disponibile
    }
  }

  return filtered.slice(0, 20);
}

export async function fetchRelatedTracks(track: Track): Promise<Track[]> {
  const client = await getYTMusicClient();
  const collected: Track[] = [];

  try {
    const upNext = await client.music.getUpNext(track.id, true);
    for (const entry of upNext.contents) {
      if (entry.is(YTNodes.PlaylistPanelVideo)) {
        const parsed = normalizePlaylistPanelVideo(entry);
        if (parsed) collected.push(parsed);
      } else if (
        entry.is(YTNodes.PlaylistPanelVideoWrapper) &&
        entry.primary?.is(YTNodes.PlaylistPanelVideo)
      ) {
        const parsed = normalizePlaylistPanelVideo(entry.primary);
        if (parsed) collected.push(parsed);
      }
    }
  } catch {
    // Passa al fallback getRelated / ricerca correlati
  }

  let filtered = deduplicateTracks(collected).filter((t) => t.id !== track.id);

  if (filtered.length < 3) {
    try {
      const related = await client.music.getRelated(track.id);
      if (related.is(YTNodes.SectionList)) {
        for (const section of related.contents) {
          if (section.is(YTNodes.MusicCarouselShelf)) {
            for (const item of section.contents) {
              if (item.is(YTNodes.MusicResponsiveListItem)) {
                const t = normalizeResponsiveItem(item);
                if (t) collected.push(t);
              } else if (item.is(YTNodes.MusicTwoRowItem)) {
                const t = normalizeTwoRowItem(item);
                if (t) collected.push(t);
              }
            }
          } else if (section.is(YTNodes.MusicShelf)) {
            for (const item of section.contents) {
              if (item.is(YTNodes.MusicResponsiveListItem)) {
                const t = normalizeResponsiveItem(item);
                if (t) collected.push(t);
              }
            }
          }
        }
        filtered = deduplicateTracks(collected).filter((t) => t.id !== track.id);
      }
    } catch {
      // Passa al fallback ricerca
    }
  }

  if (filtered.length === 0) {
    const searched = await searchYTMusic(
      `${track.artist} ${track.title}`,
      "song",
    );
    filtered = deduplicateTracks(searched).filter((t) => t.id !== track.id);
  }

  return filtered.slice(0, 20);
}

function upgradeBannerUrl(thumbnailUrl: string): string | undefined {
  if (!thumbnailUrl || thumbnailUrl.startsWith("data:")) return undefined;
  if (thumbnailUrl.includes("googleusercontent.com")) {
    return thumbnailUrl.replace(/=w\d+-h\d+([^&]*)$/, "=w1200-h500$1");
  }
  return thumbnailUrl;
}

function cleanSubscriberLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^Iscriviti a questo canale\.?\s*/i, "")
    .replace(/^Subscribe to this channel\.?\s*/i, "")
    .trim();
  return cleaned || undefined;
}

export async function fetchArtistPage(
  target: SelectedArtist,
): Promise<ArtistPageData> {
  const trimmedName = target.name.trim() || "Artista";
  let resolvedId = isArtistBrowseId(target.id) ? target.id.trim() : undefined;
  let searchSubtitle: string | undefined;
  let searchThumb: string | undefined;

  const cacheKey = resolvedId || `name:${trimmedName.toLowerCase()}`;
  const cached = artistPageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = await getYTMusicClient();

  if (!resolvedId) {
    try {
      const artistSearch = await client.music.search(trimmedName, {
        type: "artist",
      });
      const candidates: ArtistSummary[] = [];
      for (const section of artistSearch.contents ?? []) {
        if (section.is(YTNodes.MusicShelf)) {
          for (const item of section.contents) {
            if (item.is(YTNodes.MusicResponsiveListItem)) {
              const art = normalizeArtistFromResponsiveItem(item);
              if (art) candidates.push(art);
            }
          }
        }
      }
      const lowerName = trimmedName.toLowerCase();
      const exact =
        candidates.find((c) => c.name.toLowerCase() === lowerName) ??
        candidates.find((c) => c.name.toLowerCase().includes(lowerName)) ??
        candidates[0];

      if (exact) {
        resolvedId = exact.id;
        searchSubtitle = exact.subtitle;
        searchThumb = exact.thumbnail;
        const cachedByResolvedId = artistPageCache.get(resolvedId);
        if (cachedByResolvedId) {
          return cachedByResolvedId;
        }
      }
    } catch {
      // Passa al fallback ricerca brani
    }
  }

  if (!resolvedId) {
    const fallbackTracks = await searchYTMusic(trimmedName, "song");
    const fallbackCover =
      fallbackTracks[0]?.cover || FALLBACK_COVER_SVG;
    const fallbackData: ArtistPageData = {
      id: `name:${trimmedName.toLowerCase()}`,
      name: trimmedName,
      thumbnail: fallbackCover,
      topTracks: fallbackTracks.slice(0, 15),
      albums: [],
      singles: [],
      relatedArtists: [],
    };
    setBoundedCache(
      artistPageCache,
      cacheKey,
      fallbackData,
      MAX_ARTIST_CACHE_ENTRIES,
    );
    return fallbackData;
  }

  const artist = await client.music.getArtist(resolvedId);

  let name = trimmedName;
  let description: string | undefined;
  let subscribers = searchSubtitle;
  let thumbnail = searchThumb || FALLBACK_COVER_SVG;
  let banner: string | undefined;

  const header = artist.header;
  if (header) {
    if (header.is(YTNodes.MusicImmersiveHeader)) {
      name = header.title?.toString()?.trim() || name;
      description = header.description?.toString()?.trim() || undefined;
      subscribers =
        cleanSubscriberLabel(
          header.subscription_button?.subscribe_accessibility_label,
        ) || subscribers;
      const thumbUrl = extractBestThumbnail(header.thumbnail?.contents);
      if (!thumbUrl.startsWith("data:")) {
        thumbnail = thumbUrl;
        banner = upgradeBannerUrl(thumbUrl);
      }
    } else if (header.is(YTNodes.MusicVisualHeader)) {
      name = header.title?.toString()?.trim() || name;
      const fgUrl = extractBestThumbnail(header.foreground_thumbnail);
      const bgUrl = extractBestThumbnail(header.thumbnail);
      if (!fgUrl.startsWith("data:")) {
        thumbnail = fgUrl;
      } else if (!bgUrl.startsWith("data:")) {
        thumbnail = bgUrl;
      }
      if (!bgUrl.startsWith("data:")) {
        banner = upgradeBannerUrl(bgUrl);
      }
    } else if (header.is(YTNodes.MusicHeader)) {
      name = header.title?.toString()?.trim() || name;
    }
  }

  const topTracksCollected: Track[] = [];
  const albumsMap = new Map<string, ArtistRelease>();
  const singlesMap = new Map<string, ArtistRelease>();
  const relatedMap = new Map<string, ArtistSummary>();
  let allSongsBrowseId: string | undefined;

  for (const section of artist.sections ?? []) {
    if (section.is(YTNodes.MusicShelf)) {
      const shelfBrowseId = section.endpoint?.payload?.browseId as
        | string
        | undefined;
      if (shelfBrowseId && !allSongsBrowseId) {
        allSongsBrowseId = shelfBrowseId;
      }

      for (const item of section.contents) {
        if (item.is(YTNodes.MusicResponsiveListItem)) {
          const parsed = normalizeResponsiveItem(item, {
            allowUnknownWithVideoId: true,
          });
          if (parsed) {
            topTracksCollected.push({
              ...parsed,
              artist:
                parsed.artist === "Artista sconosciuto" ? name : parsed.artist,
              artistId: parsed.artistId || resolvedId,
              artists:
                parsed.artists &&
                parsed.artists.length > 0 &&
                parsed.artists[0].name !== "Artista sconosciuto"
                  ? parsed.artists
                  : [{ name, id: resolvedId }],
            });
          }
        }
      }
    } else if (section.is(YTNodes.MusicCarouselShelf)) {
      const sectionTitle = section.header?.title?.toString()?.trim() || "";
      const isSingleSection = /\b(?:singol|single|ep)\b/i.test(sectionTitle);

      for (const item of section.contents) {
        if (!item.is(YTNodes.MusicTwoRowItem)) continue;

        if (item.item_type === "album") {
          const rawId =
            item.id || (item.endpoint?.payload?.browseId as string | undefined);
          if (!rawId) continue;
          const releaseTitle = item.title?.toString()?.trim();
          if (!releaseTitle) continue;
          const subtitle = item.subtitle?.toString()?.trim() || undefined;
          const isSingle =
            isSingleSection ||
            (subtitle ? /\b(?:singol|single|ep)\b/i.test(subtitle) : false);
          const release: ArtistRelease = {
            id: rawId,
            title: releaseTitle,
            subtitle,
            year: item.year?.trim() || undefined,
            type: isSingle ? "single" : "album",
            cover: extractBestThumbnail(item.thumbnail),
          };
          if (isSingle) {
            if (!singlesMap.has(rawId)) singlesMap.set(rawId, release);
          } else {
            if (!albumsMap.has(rawId)) albumsMap.set(rawId, release);
          }
        } else if (item.item_type === "artist") {
          const rawId =
            item.id || (item.endpoint?.payload?.browseId as string | undefined);
          if (!isArtistBrowseId(rawId) || rawId === resolvedId) continue;
          const relName = item.title?.toString()?.trim();
          if (!relName || relatedMap.has(rawId)) continue;
          relatedMap.set(rawId, {
            id: rawId,
            name: relName,
            subtitle: item.subtitle?.toString()?.trim() || undefined,
            thumbnail: extractBestThumbnail(item.thumbnail),
          });
        }
      }
    }
  }

  if (allSongsBrowseId) {
    try {
      const fullTopTracks = await fetchRemotePlaylistTracks(allSongsBrowseId);
      if (fullTopTracks.length > 0) {
        const enrichedById = new Map(fullTopTracks.map((t) => [t.id, t]));
        const merged: Track[] = topTracksCollected.map(
          (t) => enrichedById.get(t.id) ?? t,
        );
        for (const t of fullTopTracks) {
          if (merged.length >= 20) break;
          merged.push({
            ...t,
            artist: t.artist === "Artista sconosciuto" ? name : t.artist,
            artistId: t.artistId || resolvedId,
          });
        }
        topTracksCollected.splice(0, topTracksCollected.length, ...merged);
      }
    } catch {
      // Mantiene i brani già estratti dalla shelf principale dell'artista
    }
  }

  let topTracks = deduplicateTracks(topTracksCollected);
  if (topTracks.length === 0) {
    const searched = await searchYTMusic(name, "song");
    topTracks = deduplicateTracks(searched).slice(0, 15);
  }

  const pageData: ArtistPageData = {
    id: resolvedId,
    name,
    description,
    subscribers,
    thumbnail,
    banner,
    topTracks,
    albums: Array.from(albumsMap.values()),
    singles: Array.from(singlesMap.values()),
    relatedArtists: Array.from(relatedMap.values()).slice(0, 10),
  };

  setBoundedCache(
    artistPageCache,
    resolvedId,
    pageData,
    MAX_ARTIST_CACHE_ENTRIES,
  );
  if (cacheKey !== resolvedId) {
    setBoundedCache(
      artistPageCache,
      cacheKey,
      pageData,
      MAX_ARTIST_CACHE_ENTRIES,
    );
  }

  return pageData;
}

export async function fetchAlbumTracks(
  albumId: string,
  fallback?: { title?: string; artist?: string; artistId?: string; cover?: string },
): Promise<Track[]> {
  const cleanId = albumId.trim();
  if (!cleanId) return [];

  const cached = albumTracksCache.get(cleanId);
  if (cached) return cached;

  const client = await getYTMusicClient();
  const album = await client.music.getAlbum(cleanId);

  let albumTitle = fallback?.title;
  let albumCover = fallback?.cover;
  let albumArtist = fallback?.artist;
  let albumArtistId = fallback?.artistId;

  const header = album.header;
  if (header) {
    if (header.is(YTNodes.MusicDetailHeader)) {
      albumTitle = header.title?.toString()?.trim() || albumTitle;
      const thumb = extractBestThumbnail(header.thumbnails);
      if (!thumb.startsWith("data:")) {
        albumCover = thumb;
      }
      if (header.author?.name) {
        albumArtist = header.author.name.trim();
        albumArtistId = isArtistBrowseId(header.author.channel_id)
          ? header.author.channel_id.trim()
          : albumArtistId;
      }
    } else if (header.is(YTNodes.MusicResponsiveHeader)) {
      albumTitle = header.title?.toString()?.trim() || albumTitle;
      const thumb = extractBestThumbnail(header.thumbnail?.contents);
      if (!thumb.startsWith("data:")) {
        albumCover = thumb;
      }
    }
  }

  const tracks: Track[] = [];
  for (const item of album.contents ?? []) {
    if (!item.is(YTNodes.MusicResponsiveListItem)) continue;
    const parsed = normalizeResponsiveItem(item, {
      allowUnknownWithVideoId: true,
    });
    if (!parsed) continue;
    const resolvedArtist =
      parsed.artist === "Artista sconosciuto" && albumArtist
        ? albumArtist
        : parsed.artist;
    const resolvedArtistId = parsed.artistId || albumArtistId;
    tracks.push({
      ...parsed,
      album: parsed.album || albumTitle,
      cover:
        parsed.cover.startsWith("data:") && albumCover
          ? albumCover
          : parsed.cover,
      artist: resolvedArtist,
      artistId: resolvedArtistId,
      artists:
        parsed.artists &&
        parsed.artists.length > 0 &&
        parsed.artists[0].name !== "Artista sconosciuto"
          ? parsed.artists
          : [{ name: resolvedArtist, id: resolvedArtistId }],
    });
  }

  const unique = deduplicateTracks(tracks);
  setBoundedCache(
    albumTracksCache,
    cleanId,
    unique,
    MAX_ARTIST_CACHE_ENTRIES,
  );
  return unique;
}
