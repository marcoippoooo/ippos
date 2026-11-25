import { ReactNode } from "react";
import { ListMusic } from "lucide-react";

interface PlaylistCollageCoverProps {
  covers: string[];
  alt: string;
  className?: string;
  iconClassName?: string;
  fallback?: ReactNode;
}

export function PlaylistCollageCover({
  covers,
  alt,
  className = "w-full h-full",
  iconClassName = "w-6 h-6",
  fallback,
}: PlaylistCollageCoverProps) {
  const validCovers = Array.from(
    new Set(
      covers.filter(
        (src) => Boolean(src) && !src.startsWith("data:image/svg"),
      ),
    ),
  );

  if (validCovers.length >= 2) {
    const tiles =
      validCovers.length >= 4
        ? validCovers.slice(0, 4)
        : [
            validCovers[0],
            validCovers[1],
            validCovers[2] ?? validCovers[1],
            validCovers[0],
          ];

    return (
      <div
        className={`grid grid-cols-2 grid-rows-2 gap-[2px] overflow-hidden ${className}`}
        style={{ backgroundColor: "rgb(var(--md-surface-base-rgb) / 0.65)" }}
      >
        {tiles.map((src, idx) => (
          <img
            key={`${src}-${idx}`}
            src={src}
            alt={`${alt} ${idx + 1}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ))}
      </div>
    );
  }

  if (validCovers.length === 1) {
    return (
      <img
        src={validCovers[0]}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`object-cover ${className}`}
      />
    );
  }

  if (fallback) {
    return <div className={`overflow-hidden ${className}`}>{fallback}</div>;
  }

  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{
        background:
          "linear-gradient(135deg, rgb(var(--md-primary-container-rgb) / 0.72), rgb(var(--md-secondary-container-rgb) / 0.85))",
      }}
    >
      <ListMusic
        className={iconClassName}
        style={{ color: "rgb(var(--md-on-secondary-container-rgb))" }}
      />
    </div>
  );
}
