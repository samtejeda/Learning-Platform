/** App name + mark. Generic on purpose (tenant branding is a later concern). */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg aria-hidden viewBox="0 0 32 32" className="size-7 shrink-0">
        <rect width="32" height="32" rx="8" className="fill-surface-card" />
        <path d="M8 9.5c3.2-1.6 5.6-1.6 8 0v14c-2.4-1.6-4.8-1.6-8 0z" className="fill-ink" />
        <path d="M16 9.5c2.4-1.6 4.8-1.6 8 0v14c-3.2-1.6-5.6-1.6-8 0z" className="fill-primary" />
      </svg>
      <span className="font-display text-xl font-semibold tracking-tight text-ink">Learning Platform</span>
    </span>
  );
}
