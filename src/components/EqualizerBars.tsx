interface EqualizerBarsProps {
  playing: boolean;
  className?: string;
}

const BAR_CONFIG = [
  { duration: "0.78s", delay: "0s", idleScale: "0.42" },
  { duration: "0.94s", delay: "0.18s", idleScale: "0.74" },
  { duration: "0.68s", delay: "0.34s", idleScale: "0.52" },
];

export function EqualizerBars({ playing, className = "h-3.5" }: EqualizerBarsProps) {
  return (
    <div
      className={`flex items-end gap-[2px] ${className}`}
      aria-hidden="true"
    >
      {BAR_CONFIG.map((bar, idx) => (
        <span
          key={idx}
          className={`w-[2.5px] h-full rounded-full transition-colors duration-500 ${
            playing ? "at-eq-bar" : ""
          }`}
          style={{
            backgroundColor: "rgb(var(--theme-accent-rgb))",
            animationDuration: playing ? bar.duration : undefined,
            animationDelay: playing ? bar.delay : undefined,
            transform: playing ? undefined : `scaleY(${bar.idleScale})`,
            transformOrigin: "bottom",
          }}
        />
      ))}
    </div>
  );
}
