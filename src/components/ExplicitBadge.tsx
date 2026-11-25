interface ExplicitBadgeProps {
  className?: string;
}

export function ExplicitBadge({ className = "" }: ExplicitBadgeProps) {
  return (
    <span
      title="Contenuto esplicito"
      aria-label="Esplicito"
      className={`inline-flex items-center justify-center w-[15px] h-[15px] rounded-[4px] text-[9px] font-bold leading-none shrink-0 select-none ${className}`}
      style={{
        backgroundColor: "rgb(var(--md-on-surface-variant-rgb) / 0.24)",
        color: "rgb(var(--md-on-surface-rgb))",
      }}
    >
      E
    </span>
  );
}
