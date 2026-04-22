# Tirsa Software Branding Kit (Website MVP)

This repository contains the minimum visual identity artifacts required to apply a consistent Tirsa Software brand on the website.

## What is included

- `logos/tirsa-logo-wordmark.svg` - primary horizontal logo with `Tirsa`
- `logos/tirsa-logo-tirsa.svg` - explicit `Tirsa` variant
- `logos/tirsa-logo-tirsa-software.svg` - explicit `Tirsa Software` variant
- `logos/tirsa-logo-mark.svg` - icon-only mark for compact layouts and social avatars
- `logos/tirsa-logo-on-dark.svg` - dark-background variant with `Tirsa Software`
- `logos/tirsa-logo-tirsa-software-black.svg` - monochrome black variant
- `logos/tirsa-logo-tirsa-software-white.svg` - monochrome white variant
- `logos/tirsa-logo-tirsa-software-grayscale.svg` - grayscale variant
- `logos/tirsa-logo-tirsa-software-white-transparent.svg` - white-on-transparent variant for dark overlays
- `logos/tirsa-logo-tirsa-software-black-transparent.svg` - black-on-transparent variant for light overlays
- `logos/tirsa-logo-mark-grayscale.svg` - grayscale icon-only mark
- `icons/favicon.svg` - favicon source for modern browsers
- `github/tirsa-github-avatar.svg` - square avatar source for GitHub org/profile usage
- `github/tirsa-github-avatar.png` - upload-ready PNG avatar for GitHub org/profile usage
- `github/tirsa-github-cover.svg` - GitHub cover/hero image asset
- `colors/tokens.css` - brand color tokens and semantic variables (light/dark)
- `colors/tirsa-palette-sheet.md` - markdown palette sheet
- `colors/tirsa-palette-sheet.pdf` - printable PDF palette sheet
- `typography/typography.css` - font stack and type scale
- `web/head-snippet.html` - copy/paste snippet for website `<head>`
- `web/brand-usage.css` - reference classes for hero, CTA, and cards
- `web/logo-preview.html` - local preview page for logo variants
- `CLAUDE.md` - AI context for Claude Code in this repo
- `.github/copilot-instructions.md` - Copilot instructions for this repo
- `.cursorrules` - Cursor instructions for this repo
- `AI-TOOLING-STRATEGY.md` - AI tooling strategy and conventions

## Mandatory website rules

1. Do not recolor the logo outside the approved palette.
2. Keep logo proportions fixed; never stretch or rotate.
3. Always use tokens from `colors/tokens.css`; avoid ad-hoc hex colors.
4. Use `Sora` for headings/wordmark and `Manrope` for body text.
5. Keep minimum clear space around logos equal to half the logo mark width.

## Logo naming

- Use `Tirsa` when the context is product-led, compact, or header-focused.
- Use `Tirsa Software` when the context is institutional, legal, or company-level.
- The wordmarks are now text-based SVGs, so the label is configurable if you want additional variants later.

## Monochrome and transparent usage

- Use `white-transparent` on dark or photographic backgrounds.
- Use `black-transparent` on light backgrounds.
- Use grayscale variants for low-color print or strict monochrome contexts.

## Quick integration

1. Copy the `branding/` folder into the website public assets area.
2. Add the snippet from `web/head-snippet.html` into the site head.
3. Use classes in `web/brand-usage.css` or map them into the website design system.
4. Open `web/logo-preview.html` to inspect variants locally before publishing.

## First-pass asset checklist

- Header logo: `logos/tirsa-logo-wordmark.svg`
- Footer/logo mark: `logos/tirsa-logo-mark.svg`
- Browser tab icon: `icons/favicon.svg`
- Brand colors and typography loaded globally

This is the MVP identity foundation. Next iterations can add social card templates, illustration style guides, and a full component-level brand grammar.