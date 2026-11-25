import type { KeyboardEvent, MouseEvent } from "react";
import { parseArtistsFromString } from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { TrackArtist } from "../types/music";

interface ArtistLinksProps {
  artist: string;
  artistId?: string;
  artists?: TrackArtist[];
  className?: string;
  /** Usa il colore del container parent invece di `.text-accent` (es. su card primary-container). */
  inheritColor?: boolean;
  onBeforeNavigate?: () => void;
}

const NON_NAVIGABLE_LABELS = new Set([
  "Artista sconosciuto",
  "YouTube Music",
]);

export function ArtistLinks({
  artist,
  artistId,
  artists,
  className = "",
  inheritColor = false,
  onBeforeNavigate,
}: ArtistLinksProps) {
  const openArtist = usePlayerStore((s) => s.openArtist);

  const resolved: TrackArtist[] =
    artists && artists.length > 0
      ? artists
      : artistId
        ? [{ name: artist, id: artistId }]
        : parseArtistsFromString(artist);

  if (resolved.length === 0) {
    return null;
  }

  const navigate = (entry: TrackArtist) => {
    if (!entry.name || NON_NAVIGABLE_LABELS.has(entry.name)) return;
    onBeforeNavigate?.();
    openArtist({ id: entry.id, name: entry.name });
  };

  const handleClick = (
    e: MouseEvent<HTMLSpanElement>,
    entry: TrackArtist,
  ) => {
    e.stopPropagation();
    navigate(entry);
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLSpanElement>,
    entry: TrackArtist,
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      navigate(entry);
    }
  };

  return (
    <span className={className}>
      {resolved.map((entry, idx) => {
        const clickable = !NON_NAVIGABLE_LABELS.has(entry.name);
        return (
          <span key={`${entry.name}-${entry.id ?? idx}`}>
            {idx > 0 && <span className="opacity-70">, </span>}
            {clickable ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleClick(e, entry)}
                onKeyDown={(e) => handleKeyDown(e, entry)}
                className={`cursor-pointer hover:underline transition-opacity hover:opacity-90 focus:outline-none focus:underline ${
                  inheritColor ? "hover:text-accent" : "text-accent"
                }`}
              >
                {entry.name}
              </span>
            ) : (
              <span>{entry.name}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
