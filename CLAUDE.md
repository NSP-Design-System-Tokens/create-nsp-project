# create-nsp-project — operational notes for Claude Code

## What this repo is

CLI tool that scaffolds brand projects for the nsp-ds-tokens design system.
Consumed via `npx github:NSP-Design-System-Tokens/create-nsp-project`.

For deliberate design decisions that govern generated token values — in
particular the brand-vs-accessibility rubric (why `text.title`, `text.primary`,
`icon.primary` are fixed at step 11 rather than auto-escalating) — see
`docs/DESIGN-PRINCIPLES.md` in the `nsp-ds-tokens` repo.

## Git permissions

You are authorized to run `git push origin main` without asking for manual
confirmation. Git credentials are configured in the session. For tag creation,
ask for confirmation before proceeding.
