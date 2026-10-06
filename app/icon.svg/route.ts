import { PALETTE_META } from "@/lib/palette";
import { getActivePalette } from "@/lib/palette/server";

// Favicon drawn from the active palette (a static public/icon.svg would keep
// the old brand color). Public, no data. Cached by the browser for a day.
export function GET() {
  const { canvas, primary, ink } = PALETTE_META[getActivePalette()];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Learning Platform">
  <rect width="32" height="32" rx="8" fill="${canvas}"/>
  <path d="M8 9.5c3.2-1.6 5.6-1.6 8 0v14c-2.4-1.6-4.8-1.6-8 0z" fill="${ink}"/>
  <path d="M16 9.5c2.4-1.6 4.8-1.6 8 0v14c-3.2-1.6-5.6-1.6-8 0z" fill="${primary}"/>
</svg>
`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
