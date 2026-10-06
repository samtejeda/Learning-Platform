# Color palettes

The platform has **one active color palette per deployment**, chosen by the operator with the server-only env var `COLOR_PALETTE` (not a per-user setting). Shipped: `blue` (default) and `terracotta` (the original Claude-system look in `DESIGN.md`).

> **Source of truth for color = `app/palettes.css` + the `@theme` block in `app/globals.css`.** `DESIGN.md`'s hex values describe the *terracotta* palette only. Read `DESIGN.md` for structure, type, spacing, radius and component behavior; read this file for color.

## How it works
1. `lib/palette/server.ts` reads `COLOR_PALETTE` (unset → `blue`; unknown value → `blue` plus a `palette.unknown_value` warning; never throws).
2. The root layout sets `<html data-palette="…">`, the browser chrome color (`generateViewport`), and `GET /icon.svg` draws the favicon from the same palette.
3. `app/palettes.css` has one `html[data-palette="x"] { … }` block per palette that re-fills the **identity** tokens. Tailwind utilities compile to `var(--color-…)`, so `bg-primary`, `text-muted`, etc. recolor with no component changes.
4. The value is read at build time for static pages, so changing it means a redeploy.

## Identity vs shared tokens
| | Tokens |
|---|---|
| **Identity** (set in every palette block) | `primary`, `primary-active`, `primary-disabled`, `accent-teal`, `accent-amber`, `canvas`, `surface-soft`, `surface-card`, `surface-cream-strong`, `surface-dark`, `surface-dark-elevated`, `surface-dark-soft`, `hairline`, `hairline-soft`, `muted`, `muted-soft` |
| **Shared** (`@theme`, never overridden) | `ink`, `body`, `body-strong`, `on-primary`, `on-dark`, `on-dark-soft`, `white`, `black`, `success`, `warning`, `error`, `success-strong`, `warning-strong`, plus all radius, shadow and font tokens |

Why `muted`/`muted-soft` are identity: the warm grays fall under 4.5:1 on blue-tinted surfaces, so each palette ships a matching tinted neutral. Shared status colors keep their meaning in every deployment; a green or red palette will resemble `success`/`error`, which is acceptable because status is always paired with text or an icon.

## Contrast rule
Every palette must reach **4.5:1** on every text/background pair listed in `lib/palette/palette.test.ts` (`REQUIRED`): body/ink/muted on the light surfaces, `on-primary` on `primary` and `primary-active`, `primary` and `primary-active` as link text, status tones, and `on-dark*` on the dark surfaces. Derive a darker tone (the `-strong` convention) rather than lowering the bar. `pnpm test` fails a palette that misses.

**Terracotta exceptions** (it predates the rule; new palettes get none), listed in `TERRACOTTA_ACCEPTED` in the test: white on `primary` is 3.28:1 (Sam, 2026-09-19: keep DESIGN.md's spec), `primary` as link text on canvas is 3.11:1, and `muted`/`muted-soft`/`primary-active` on the darker cream surfaces fall slightly under 4.5:1.
Blue clears every pair with no exceptions (white on primary is 6.0:1).

Note: `error` (`#c64545`, shared) reaches 4.5:1 only on `canvas` in any palette, so inline error text should sit on canvas.

## Adding a palette (e.g. green, red, yellow)
1. Copy a block in `app/palettes.css`; set every identity token. Check contrast as you go.
2. Add the name to `PALETTES` and its `canvas`/`primary`/`ink` to `PALETTE_META` in `lib/palette/index.ts` (used for viewport color and favicon).
3. Run `pnpm test`. The tests verify: only identity tokens are set, all are defined, `PALETTE_META` matches the CSS, and contrast.
4. Add the name to the `COLOR_PALETTE` comment in `.env.local.example` and API.md's env table.

No component or layout change should be needed. Not tokenized (by design): `app/global-error.tsx` uses neutral inline hexes because it renders outside the layout and CSS.
