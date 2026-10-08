import type { SectionId } from "./sections";

// One icon and one colour treatment per section, from palette tokens only.
// The shapes differ as well as the colours, and every use sits beside the
// section's name, so colour is never the only signal.
const PATHS: Record<SectionId, React.ReactNode> = {
  syllabus: <path d="M4 2h5l3 3v9H4zM9 2v3h3M6 8h4M6 10.5h4" />,
  lectures: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M7 6.2v3.6l3-1.8z" />
    </>
  ),
  materials: <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />,
  exams: <path d="M5.5 3H4v10h8V3h-1.5M6 2h4v2H6zM6 8.5l1.5 1.5L10 7" />,
  students: (
    <>
      <circle cx="6" cy="6" r="2" />
      <path d="M2.5 13c0-2 1.6-3.2 3.5-3.2s3.5 1.2 3.5 3.2" />
      <circle cx="11.5" cy="6.5" r="1.5" />
      <path d="M11 9.8c1.6 0 2.7.9 2.7 2.4" />
    </>
  ),
};

const TILES: Record<SectionId, string> = {
  syllabus: "bg-accent-amber/25 text-warning-strong",
  lectures: "bg-primary text-on-primary",
  materials: "bg-accent-teal/25 text-ink",
  exams: "bg-surface-dark text-on-dark",
  students: "bg-surface-cream-strong text-ink",
};

/** The section's icon in its coloured tile. Decorative: the name is always next to it. */
export function SectionIcon({ id, size = "md" }: { id: SectionId; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-md ${size === "md" ? "size-10" : "size-7"} ${TILES[id]}`}
    >
      <svg
        viewBox="0 0 16 16"
        className={size === "md" ? "size-5" : "size-4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PATHS[id]}
      </svg>
    </span>
  );
}
