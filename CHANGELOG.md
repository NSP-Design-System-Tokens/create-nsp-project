# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed (BREAKING)

- `text.title` is now fixed at step 11 in both light and dark modes.
  Previously used `pickTextStep` which could escalate to step 12 for very
  light brand palettes to meet WCAG 4.5:1. The new policy follows the
  brand-coherence-over-accessibility principle: step 11 is always used,
  regardless of computed contrast. Brands with extremely light identity
  colors will have sub-AA title text in light mode — this is accepted.
  **Breaking:** generated projects that relied on step-12 escalation will
  produce different token values after re-scaffolding.

### Added

- `text.primary` semantic token — step 11 in both light and dark modes.
  Fills the role gap between `text.title` (brand heading) and
  `text.primary-hover` (interaction state): provides a standalone brand
  primary text role usable outside of heading contexts.
  Resolves the orphan exemption `text.primary × surface.floating`.
