type Props = {
  /** 0–100 */
  value: number;
  label: string;
  /** Short text to the right (e.g. "3 of 8"). */
  caption?: string;
  size?: "sm" | "md";
};

export function ProgressBar({ value, label, caption, size = "sm" }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const done = pct >= 100;
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={`flex-1 overflow-hidden rounded-pill bg-hairline ${size === "sm" ? "h-1.5" : "h-2.5"}`}
      >
        <div
          className={`h-full rounded-pill transition-[width] duration-300 ${done ? "bg-success" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {caption && <span className="shrink-0 text-xs font-medium tabular-nums text-muted">{caption}</span>}
    </div>
  );
}
