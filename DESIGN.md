---
name: FWHL League Tracker
direction: Ledger and box score
tokens: src/index.css
---

## Overview

A league office ledger, not a dashboard template. Warm paper, ink rules, a gold tick for "this one", and every number set in a monospace face so columns read like a box score. Hierarchy comes from type weight, rules and alignment instead of cards and shadows. The trade analyzer is laid out as a trade slip: two sides separated by perforation, the verdict in the middle.

Section order follows the Design DNA format in `INSANE0777/Awwwards-mcp` (ATLAS evidence-pack `DESIGN.md`). Values here are decided, not observed; there is no reference site being copied.

## Colors

All colors are CSS custom properties on `:root` in `src/index.css`, re-declared under `prefers-color-scheme: dark`, and exposed to Tailwind through `@theme inline`. Tailwind's default palette is removed (`--color-*: initial`), so no other color can appear.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | #F4F1E8 | #0F1411 | Page background |
| `surface` | #FBFAF5 | #151C18 | Inputs, rail, sheets |
| `sunk` | #ECE8DC | #1B241F | Hover and selected wells |
| `ink` | #151A17 | #E9E6DC | Body text, heavy rules |
| `ink-2` | #3F4943 | #C4C7BF | Secondary text |
| `ink-3` | #5E6862 | #959D96 | Labels, muted (AA on paper) |
| `rule` | #D6D0C0 | #2A332E | Hairlines |
| `rule-strong` | #A9A290 | #46524B | Control borders, perforation |
| `primary` | #1E3A2F | #8CC4A5 | Field green: primary actions, focus |
| `secondary` | #4A5550 | #A9B3AD | Slate: reserved for secondary marks |
| `accent` | #E0A100 | #F2B92B | Gold: active nav tick, selection bar. Never text on paper |
| `accent-ink` | #7A5500 | #F2C14E | Gold as text |
| `gain` / `loss` / `even` | #1D6B3A / #A8321F / #7A5500 | #5BC183 / #F07A66 / #F2C14E | Signal only, always paired with a sign or label |

Manager monograms use `oklch(0.46 0.07 <team id × 47°>)` so each team keeps one muted hue everywhere.

## Typography

| Role | Face | Rules |
| --- | --- | --- |
| Display (headings, verdict, wordmark) | Archivo variable, `font-stretch` 70 to 85% | 700 to 800 weight, sentence case except the verdict word |
| Body | IBM Plex Sans 400 / 500 / 600 | 16px base, 1.5 line height |
| Numbers | IBM Plex Mono 400 / 500 / 600 | Every stat, score and value; tabular figures |

Six sizes only (Tailwind's scale is reset): xs 12, sm 14, base 16, lg 20, xl 28, 2xl 40 px. Fonts are bundled in `public/fonts` (OFL licenses alongside), so nothing loads from a font CDN.

## Layout

| Width | Navigation | Layout |
| --- | --- | --- |
| < 768 px | Bottom bar (Find, Trade, Table, Players, Teams) + Data link in header | Single column; analyzer shows the verdict first |
| 768 to 1023 px | Tab row under the header | Single column, wider tables |
| ≥ 1024 px | Left rail with data freshness and your team | Analyzer is a three-column trade slip; finder is controls left, offers right; tables are dense |

Wide tables scroll sideways inside their own box with the first column sticky. The page itself never scrolls sideways (checked at 390, 820 and 1440 px).

Spacing stays on a 4px base. Rows in tables are 40px; anything tappable is at least 44px tall.

## Elevation & Depth

None. `--shadow-*` is reset, so no shadow utility exists. Depth comes from rules: a 1px hairline separates rows, a 1px ink rule closes a section heading, a 2px ink rule frames the verdict. Dialogs sit on a 50% ink backdrop with a hairline border.

## Shapes

Two radii: 2px (`rounded-sm`, tags and monograms) and 4px (`rounded`, controls and sheets). No pills, no rounded cards. Tags are square, outlined and mono.

## Components

All in `src/ui/components.tsx` plus the `@layer components` block in `src/index.css`: `btn` (default, primary, quiet), `field`, `seg` (segmented control), `tag`, `tbl` (data table with sticky header and sticky first column), `link`, `Sheet` (native `<dialog>`), `Section`, `Mono` (team monogram), `PlayerName`, `Status`, `ErrorBoundary`.

### Hover and press census

Every interactive state the app defines. Only color and `translate` change, so nothing shifts layout.

| Element | State | Property: before → after | Duration | Easing |
| --- | --- | --- | --- | --- |
| `.btn` | hover | background surface → sunk; border rule-strong → ink-3 | 120 ms | cubic-bezier(0.2, 0.8, 0.2, 1) |
| `.btn` | active | translate 0 → 0 1px | 80 ms | same |
| `.btn-primary` | hover | background primary → primary mixed 12% toward ink | 120 ms | same |
| `.field` | hover | border rule-strong → ink-3 | 120 ms | same |
| `.seg > button` | hover | background surface → sunk; color ink-2 → ink | 120 ms | same |
| `.seg > button` | pressed | background → ink; color → paper | instant on click | none |
| `.tbl tbody tr`, `.rowbtn` | hover | background transparent → sunk | 120 ms | same |
| `.link` | hover | color inherit → primary; underline rule-strong → current | 120 ms | same |
| Finder team chevron | expanded | rotate 0 → 180° | 120 ms | Tailwind default |
| `.sheet` (dialog) | open | opacity 0 → 1; translate 0 8px → 0 | 180 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| `.sheet::backdrop` | open | opacity 0 → 1 | 180 ms | same |
| Focus (all) | focus-visible | 2px primary outline, 2px offset | instant | none |

Motion tokens: `--dur-hover` 120 ms, `--dur-press` 80 ms, `--dur-enter` 180 ms. Under `prefers-reduced-motion: reduce` all three become 0 ms.

## Do's and Don'ts

Do:
- Set every number in mono with tabular figures and right-align it.
- Use a rule, not a box, to separate sections.
- Pair any green or red with a sign (+/−) or a word.
- Show the as-of date of any number that can go stale.

Don't (anti-patterns this build checks against):
- Gradients as decoration, glass or blur, glow, neon.
- Cards inside cards; a card for every section.
- Pills for everything, `rounded-2xl`, drop shadows.
- Stock icon sets as decoration; uppercase letter-spaced micro-labels on every field.
- Animating `width`, `height`, `top` or `margin` (layout shift), count-up numbers, staggered entrances, skeleton shimmer, scroll-triggered reveals that can hide content.
- Motion that ignores `prefers-reduced-motion`.

## Sources

- Rubric for interaction census and token families: `INSANE0777/Awwwards-mcp` `README.md`, `skills/awwwards-inspiration/SKILL.md`, `ATLAS.md` (read only, not installed). `skills/awwwards-motion-study/SKILL.md` no longer exists in that repository.
- Audit items UI-1 (responsive layout) and the "de-AI-ify" findings in Pillar 4 of the Phase 1 audit.

## Coverage and limitations

- Checked in Chromium at 390 × 844, 820 × 1180 and 1440 × 900, light and dark. Not yet checked on a physical iPhone or in Safari.
- Dark mode follows the system setting; there is no in-app switch yet.

## Unresolved details

- The brand palette and fonts were chosen for this build because the Phase 2 brief left them blank. Swap the values in `src/index.css` to change them.
