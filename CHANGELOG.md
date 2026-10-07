# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Breaking Changes

- On-color tokens now use real neutral grays (`{palette.neutral.1}` = #fcfcfc,
  `{palette.neutral.12}` = #202020) instead of raw `#ffffff`/`#000000`.
  This is the canonical Opzione A behavior from `generate-scale.mjs`.
  **Breaking:** re-scaffolded projects will produce different on-color token
  values (refs and hex). No real brand projects exist yet.

### Changed

- Color engine migrated from `culori` to the canonical zero-dependency OKLCH
  generator vendorized from `nsp-ds-tokens/scripts/lib/generate-scale.mjs`.
  Scale values are numerically identical; only on-color refs change.
- `culori` removed from CLI dependencies. Generated brand projects still
  depend on it via `nsp-ds-tokens`.
- `computeOnColor(lightHex, darkHex)` call sites replaced by
  `computeOnColorPair(lightHex, darkHex)` from the canonical API.

### Added

- `scripts/sync-generate-scale.mjs` — sync script with SHA-256 self-check.
  Vendorizes the canonical generator into `index.mjs` between `@generated`
  markers. Run whenever `generate-scale.mjs` changes in `nsp-ds-tokens`.

---

## [0.4.0] — 2026-09-03

### Breaking Changes

- `text.title` is now fixed at step 11 in both light and dark modes.
  Previously used `pickTextStep` which could escalate to step 12 for very
  light brand palettes to meet WCAG 4.5:1. The new policy follows the
  brand-coherence-over-accessibility principle: step 11 is always used,
  regardless of computed contrast. Brands with extremely light identity
  colors will have sub-AA title text in light mode — this is accepted.
  **Breaking:** generated projects that relied on step-12 escalation will
  produce different token values after re-scaffolding.

- `icon.primary` is now fixed at step 11 in both light and dark modes.
  Previously used `pickIconStep` which selected the minimum step ≥3:1 on
  white. Aligns `icon.primary` with `text.title`/`text.primary`: brand
  coherence over WCAG escalation. **Breaking:** same re-scaffold impact as
  `text.title`.

### Changed

- `LIB_VERSION` bumped `v0.3.7` → `v0.4.0`. Generated projects will install
  `nsp-ds-tokens#v0.4.0` from GitHub on `npm install`.
- `package.json "version"` aligned to `0.4.0` (was stale `1.0.0` — not read by
  `npx github:` consumers, corrected to avoid future confusion).

### Added

- `text.primary` semantic token — step 11 in both light and dark modes.
  Fills the role gap between `text.title` (brand heading) and
  `text.primary-hover` (interaction state): provides a standalone brand
  primary text role usable outside of heading contexts.
  Resolves the orphan exemption `text.primary × surface.floating`.

- `icon.primary-xlight` semantic token — `{palette.primary.3}` both light and dark
  modes. Parity with `text.primary-xlight`. Brand-tinted decorative icon variant;
  exempt from contrast gate (arbitrary background, consumer's responsibility).

- `CLAUDE.md`: reference to `docs/DESIGN-PRINCIPLES.md` in `nsp-ds-tokens` for the
  brand-vs-accessibility rubric (step 11 policy).
