import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import type { Track } from "../types/music";

interface TrackDownloadButtonProps {
  track: Track;
  className?: string;
}

export function TrackDownloadButton({
  track,
  className = "",
}: TrackDownloadButtonProps) {
  const isDownloaded = usePlayerStore((s) =>
    s.downloadedTrackIds.includes(track.id),
  );
  const isDownloading = usePlayerStore((s) =>
    Boolean(s.downloadingTrackIds[track.id]),
  );
  const downloadTrack = usePlayerStore((s) => s.downloadTrack);
  const removeDownloadedTrack = usePlayerStore(
    (s) => s.removeDownloadedTrack,
  );

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isDownloading) return;
    if (isDownloaded) {
      void removeDownloadedTrack(track.id);
    } else {
      void downloadTrack(track);
    }
  };

  const title = isDownloading
    ? "Download offline in corso..."
    : isDownloaded
      ? "Scaricato offline · Clicca per rimuovere"
      : "Scarica per ascolto offline";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDownloading}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded-full transition-all ${
        isDownloading
          ? "text-sky-300 opacity-100 cursor-wait"
          : isDownloaded
            ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 opacity-100"
            : `text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 focus:opacity-100 ${className}`
      }`}
    >
      {isDownloading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : isDownloaded ? (
        <CheckCircle2 className="w-3.5 h-3.5" />
      ) : (
        <Download className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
