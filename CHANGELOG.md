# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- `text.primary` semantic token — step 11 in both light and dark modes.
  Fills the role gap between `text.title` (brand heading) and
  `text.primary-hover` (interaction state): provides a standalone brand
  primary text role usable outside of heading contexts.
  Resolves the orphan exemption `text.primary × surface.floating`.
