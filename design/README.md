# Design references

| File | Role | Source |
|---|---|---|
| `../DESIGN.md` | **Primary design system.** Source of truth for color, typography, spacing, radius, and component states in every screen. | `getdesign@0.6.25` bundled template `templates/claude.md` (VoltAgent/awesome-design-md), byte-identical **except** a 1-line color note added under the front matter (2026-10-06). |
| `PALETTES.md` | **Color source-of-truth pointer.** Palette mechanism, identity/shared token split, contrast rule, how to add one. Overrides DESIGN.md on color. | Project-authored. |

The Airtable structure-only reference that used to sit here was removed 2026-11-09 (Sam: no longer needed; it was third-party brand material in a public repo).

Provenance (2026-09-18): the `getdesign` CLI was vetted read-only before use — it is a zero-dependency script that copies a bundled markdown file to `./DESIGN.md` and sends one anonymous telemetry POST. The files here were copied from the unpacked tarball rather than by executing the CLI, so no third-party code ran and nothing was reported. The files are kept unmodified so they can be diffed against future upstream versions; project-specific decisions (font substitutes, light-only mode, etc.) are recorded in `PROGRESS.md`, not in these files.

Font substitutes in use (per `DESIGN.md` → "Note on Font Substitutes"): Cormorant Garamond 500 for display headings (Copernicus/Tiempos stand-in), Inter for body/UI (StyreneB stand-in). Both self-hosted at build time via `next/font/google`.
