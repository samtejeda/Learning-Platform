import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_META,
  resolvePalette,
  type PaletteName,
} from "./index";

const globalsCss = readFileSync("app/globals.css", "utf8");
const palettesCss = readFileSync("app/palettes.css", "utf8");

/** `--color-x: #abc123;` declarations inside a block of CSS text. */
function tokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function paletteBlock(name: string): string {
  const m = palettesCss.match(new RegExp(`html\\[data-palette="${name}"\\]\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no block for palette "${name}" in app/palettes.css`);
  return m[1];
}

const theme = tokens(globalsCss.slice(globalsCss.indexOf("@theme {"), globalsCss.indexOf("@theme inline")));

/** The effective token set for a palette: @theme defaults + its overrides. */
function effective(name: PaletteName): Record<string, string> {
  return { ...theme, ...tokens(paletteBlock(name)) };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Identity tokens: the ONLY ones a palette block may set.
const IDENTITY = [
  "primary", "primary-active", "primary-disabled", "accent-teal", "accent-amber",
  "canvas", "surface-soft", "surface-card", "surface-cream-strong",
  "surface-dark", "surface-dark-elevated", "surface-dark-soft",
  "hairline", "hairline-soft", "muted", "muted-soft",
];

const LIGHT_SURFACES = ["canvas", "surface-soft", "surface-card", "surface-cream-strong"];
const DARK_SURFACES = ["surface-dark", "surface-dark-elevated", "surface-dark-soft"];

/** [foreground token, background token] pairs that carry real text. */
const REQUIRED: [string, string][] = [
  ...["ink", "body", "body-strong", "muted", "primary-active"].flatMap((fg) =>
    LIGHT_SURFACES.map((bg): [string, string] => [fg, bg]),
  ),
  // Shared status tones and the small "Optional" label: real text, but only
  // ever on canvas/soft/card (never the hover/segmented cream-strong fill).
  ...["muted-soft", "success-strong", "warning-strong"].flatMap((fg) =>
    ["canvas", "surface-soft", "surface-card"].map((bg): [string, string] => [fg, bg]),
  ),
  // `error` (shared, #c64545) only reaches 4.5:1 on canvas in ANY palette;
  // field/inline errors render on canvas.
  ["error", "canvas"],
  ["on-primary", "primary"],
  ["on-primary", "primary-active"],
  ["primary", "canvas"], // text-primary links
  ...["on-dark", "on-dark-soft"].flatMap((fg) => DARK_SURFACES.map((bg): [string, string] => [fg, bg])),
];

/**
 * Known, accepted misses for terracotta only (it is the original palette;
 * PROGRESS.md). New palettes get no exceptions.
 *  - on-primary/primary: Sam decided 2026-09-19 to keep DESIGN.md's white on coral.
 *  - the rest predate this test; fixing them would change terracotta's look.
 */
const TERRACOTTA_ACCEPTED = new Set([
  "on-primary/primary",
  "primary/canvas",
  "muted/surface-card",
  "muted/surface-cream-strong",
  "muted-soft/canvas",
  "muted-soft/surface-soft",
  "muted-soft/surface-card",
  "primary-active/surface-soft",
  "primary-active/surface-card",
  "primary-active/surface-cream-strong",
  "success-strong/surface-card",
]);

describe("resolvePalette", () => {
  it("defaults to blue when unset or blank", () => {
    expect(DEFAULT_PALETTE).toBe("blue");
    expect(resolvePalette(undefined)).toEqual({ name: "blue", invalid: null });
    expect(resolvePalette("  ")).toEqual({ name: "blue", invalid: null });
  });
  it("accepts known names case-insensitively", () => {
    expect(resolvePalette("Terracotta").name).toBe("terracotta");
    expect(resolvePalette(" blue ").name).toBe("blue");
  });
  it("falls back (never throws) on an unknown value and reports it", () => {
    expect(resolvePalette("purlpe")).toEqual({ name: "blue", invalid: "purlpe" });
  });
});

describe.each(PALETTES)("palette %s", (name) => {
  const t = effective(name);
  const block = tokens(paletteBlock(name));

  it("only overrides identity tokens", () => {
    for (const key of Object.keys(block)) expect(IDENTITY, key).toContain(key);
  });

  it("defines every identity token", () => {
    for (const key of IDENTITY) expect(block[key], key).toBeDefined();
  });

  it("matches PALETTE_META (viewport color + favicon)", () => {
    expect(PALETTE_META[name].canvas).toBe(t.canvas);
    expect(PALETTE_META[name].primary).toBe(t.primary);
    expect(PALETTE_META[name].ink).toBe(t.ink);
  });

  it("clears 4.5:1 on every text/background pair", () => {
    const failures: string[] = [];
    for (const [fg, bg] of REQUIRED) {
      const key = `${fg}/${bg}`;
      if (name === "terracotta" && TERRACOTTA_ACCEPTED.has(key)) continue;
      const ratio = contrast(t[fg], t[bg]);
      if (ratio < 4.5) failures.push(`${key} = ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("terracotta block", () => {
  it("equals the @theme defaults (no drift)", () => {
    expect(tokens(paletteBlock("terracotta"))).toEqual(
      Object.fromEntries(IDENTITY.map((k) => [k, theme[k]])),
    );
  });
});
