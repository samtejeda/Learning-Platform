/** The "this row opens something" arrow at the end of a tappable row. Decorative. */
export function RowChevron() {
  return (
    <span className="shrink-0 text-muted-soft" aria-hidden>
      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 3l5 5-5 5" />
      </svg>
    </span>
  );
}
