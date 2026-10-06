/**
 * Site-wide color palette (deployment config, not a per-user setting).
 *
 * The operator picks one with the server-only `COLOR_PALETTE` env var; the
 * root layout puts it on `<html data-palette="…">` and `app/palettes.css`
 * re-fills the identity color tokens under that attribute. See
 * design/PALETTES.md for the identity/shared split and how to add a palette.
 *
 * Pure on purpose (no logger, no `server-only`): the layout logs the fallback
 * warning, and tests import this directly.
 */
export const PALETTES = ["terracotta", "blue"] as const;
export type PaletteName = (typeof PALETTES)[number];

export const DEFAULT_PALETTE: PaletteName = "blue";

/**
 * The few palette colors JavaScript needs (browser chrome color, favicon).
 * Everything else lives only in `app/palettes.css`; `palette.test.ts` fails
 * if these drift from the CSS.
 */
export const PALETTE_META: Record<PaletteName, { canvas: string; primary: string; ink: string }> = {
  terracotta: { canvas: "#faf9f5", primary: "#cc785c", ink: "#141413" },
  blue: { canvas: "#f7f9fc", primary: "#2563b0", ink: "#141413" },
};

export type ResolvedPalette = {
  name: PaletteName;
  /** The raw value was set but isn't a known palette (caller should warn). */
  invalid: string | null;
};

export function isPaletteName(value: string): value is PaletteName {
  return (PALETTES as readonly string[]).includes(value);
}

/** Never throws: a typo in the env var must not take the site down. */
export function resolvePalette(raw: string | undefined): ResolvedPalette {
  const value = raw?.trim().toLowerCase();
  if (!value) return { name: DEFAULT_PALETTE, invalid: null };
  if (isPaletteName(value)) return { name: value, invalid: null };
  return { name: DEFAULT_PALETTE, invalid: value.slice(0, 40) };
}
