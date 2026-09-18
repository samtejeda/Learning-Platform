# Design references

| File | Role | Source |
|---|---|---|
| `../DESIGN.md` | **Primary design system.** Source of truth for color, typography, spacing, radius, and component states in every screen. | `getdesign@0.6.25` bundled template `templates/claude.md` (VoltAgent/awesome-design-md), byte-identical. |
| `DESIGN-airtable-reference.md` | **Structure-only reference** for data-dense screens (course management, rosters, admin): row/hairline dividers, badges, outlined secondary buttons, card grids. Never a source for colors or type — those always come from `DESIGN.md`. | `getdesign@0.6.25` bundled template `templates/airtable.md`, byte-identical. |

Provenance (2026-09-18): the `getdesign` CLI was vetted read-only before use — it is a zero-dependency script that copies a bundled markdown file to `./DESIGN.md` and sends one anonymous telemetry POST. The files here were copied from the unpacked tarball rather than by executing the CLI, so no third-party code ran and nothing was reported. The files are kept unmodified so they can be diffed against future upstream versions; project-specific decisions (font substitutes, light-only mode, etc.) are recorded in `PROGRESS.md`, not in these files.

Honest caveat: the Airtable file analyses Airtable's *marketing site*, not its product UI. Its transferable table/tag/card guidance is thin (1px `hairline` row dividers, pill CTA, outlined secondary button, info/success badges, article cards). Use it for those conventions only.

Font substitutes in use (per `DESIGN.md` → "Note on Font Substitutes"): Cormorant Garamond 500 for display headings (Copernicus/Tiempos stand-in), Inter for body/UI (StyreneB stand-in). Both self-hosted at build time via `next/font/google`.
