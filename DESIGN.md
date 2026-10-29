---
name: Miootz
description: "The Hall Scoreboard — a painted-steel scoreboard at night. A no-nonsense football (soccer) meetup and match tool for friendly-competitive adults."
colors:
  board: "#0b1220"
  panel: "#101826"
  raised: "#182238"
  line: "#1f2a3d"
  ink: "#f8fafc"
  ink-dim: "#94a3b8"
  ink-faint: "#7d8ca3"
  team-a: "#16a34a"
  team-b: "#2563eb"
  live: "#f59e0b"
  danger: "#ef4444"
  plus-one: "#ec4899"
typography:
  face: 'Archivo (variable 100–900), self-hosted woff2'
  micro-label:
    fontFamily: 'Archivo'
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1rem
    case: uppercase
    letterSpacing: "0.14em"
  body:
    fontFamily: 'Archivo'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: 'Archivo'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  section-title:
    fontFamily: 'Archivo'
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.4
  page-title:
    fontFamily: 'Archivo'
    fontSize: "1.25rem–1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  scoreboard:
    fontFamily: 'Archivo'
    fontSize: "2.25rem–3rem"
    fontWeight: 800
    lineHeight: 1
    numerals: tabular
rounded:
  sharp: "0px — forced globally (`* { border-radius: 0 !important }`)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.board}"
    hover: "bg white/90"
    rounded: "{rounded.sharp}"
    padding: "8px 16px"
    minHeight: "44px"
  button-live:
    backgroundColor: "{colors.live}"
    textColor: "{colors.board}"
    hover: "bg live/90"
    rounded: "{rounded.sharp}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-dim}"
    border: "{colors.line}"
    hover: "bg raised, text ink"
    rounded: "{rounded.sharp}"
    padding: "8px 16px"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    border: "danger/40"
    hover: "bg danger/10"
    rounded: "{rounded.sharp}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    border: "{colors.line}"
    focus: "2px ring live"
    rounded: "{rounded.sharp}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.panel}"
    border: "{colors.line}"
    shadow: none
    rounded: "{rounded.sharp}"
  floating:
    backgroundColor: "{colors.panel}"
    border: "{colors.line}"
    shadow: "xl (dialog/sheet), lg (dropdown/toast)"
    rounded: "{rounded.sharp}"
  micro-label:
    typography: "{typography.micro-label}"
    textColor: "{colors.ink-dim}"
  team-slab:
    backgroundColor: "{colors.team-a} / {colors.team-b}"
    textColor: "#ffffff"
    case: uppercase
    beyond-two-teams: "bg raised, text ink"
  skill-badge:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-dim}"
    numerals: tabular
  nav-tab-active:
    textColor: "{colors.live}"
    underline: "32×2px bg live"
---

# Design System: Miootz

## Overview

**Creative North Star: "The Hall Scoreboard"**

The screen is the scoreboard — a painted-steel board in a dark hall. A player
glances up and instantly knows the state (confirmed / waitlisted / live), the
score and minute, and the one next action. Every surface opens with a painted
band that states the state of play: team slabs, giant tabular numbers, state as
colour. Amber means *now*, nothing else.

It is a single dark theme: a scoreboard is a night object. `html.dark` stays
set so existing `dark:` variants keep resolving; light-mode classes do not
exist. Where the product is alive (a live match, a countdown, a held lease) the
liveliness comes from tabular numbers, a pulsing amber dot, a color shift —
not from decoration. Flat fills, sharp edges, no shadows on content, no
gradients, no glow.

The system rejects: teal/emerald accents, a light theme, rounded corners,
decorative amber, shadows on content cards, gradient backgrounds, explanatory
subtext that restates a label, and any screen that reads as a SaaS dashboard
for a company instead of a scoreboard at a hall.

**Key Characteristics:**
- One dark world: tonal layering board → panel → raised, 1px `line` hairlines only.
- Team green/blue slabs carry identity; the white painted band is the primary action.
- One amber (`live`) for everything happening *now*; red only for real danger.
- Archivo everywhere; every number is tabular.
- Sharp and flat: no radius, no shadow on content, no gradients.
- One primary action per screen; every state is named, never silent.

## Colors

Tailwind v4 `@theme` tokens in `frontend/src/index.css`. Each means exactly one thing.

| Token | Value | Role |
|---|---|---|
| `board` | `#0b1220` | Page ground — the painted steel. Also the focus-ring offset. |
| `panel` | `#101826` | Cards, rows, nav bars, dialogs. |
| `raised` | `#182238` | Inputs, hover fills, subtle chips, teams beyond two. |
| `line` | `#1f2a3d` | The only line: 1px hairlines. Pinned as `--default-border-color` so bare v3-compat `border` keeps this colour. |
| `ink` | `#f8fafc` | Primary text; primary CTA fill (the white painted band). |
| `ink-dim` | `#94a3b8` | Secondary text; micro-labels; secondary buttons. |
| `ink-faint` | `#7d8ca3` | Tertiary / muted text, placeholders. |
| `team-a` | `#16a34a` | Team A slab; also positive data (success text, "Balanced", "full"). |
| `team-b` | `#2563eb` | Team B slab; team-related info. |
| `live` | `#f59e0b` | The single "now" colour: live/active/selected states, focus rings, countdowns, half-time band, sparse warnings (below-min, uneven, timer < ⅓). |
| `danger` | `#ef4444` | Errors, destructive, "Time's up", unread dot, timer < ⅒. |

**Functional:** plus-one identity is pink, and pink is used nowhere else —
Tailwind default `pink-500/15` fill with `pink-400` text on the `+1` badge, so
a guest is spotted instantly in a roster. It is the one hue outside the tokens.

### Named Rules

**The Amber-Is-Now Rule.** `live` is reserved for what is happening *right
now*: a live match, the active tab, a selected state, focus, a running
countdown, a half-time flash. Amber anywhere decorative is a finding.

**The One-Theme Rule.** Single dark theme. `html.dark` is always set (so
`dark:` variants keep resolving); light-mode classes have been removed and
must not return.

**The Team-Slab Rule.** `team-a` / `team-b` are the only hue fills on match
surfaces, as `bg-team-a` / `bg-team-b text-white` slabs. Teams beyond two
render `bg-raised text-ink`.

## Typography

**Face:** Archivo, variable 100–900, self-hosted (provenance below).
`--font-sans` = Archivo plus system fallbacks. Hierarchy is carried by weight
(400 → 500 → 700 → 800) and ink step, never by color.

### Hierarchy
- **Micro-label** (`text-2xs` = 0.6875rem/1rem, 700, UPPERCASE, tracking 0.14em, `ink-dim`): zone labels ("Meetup · Hall 3"), section markers ("Goals", "Roster"), the brand row, "to kickoff".
- **Body** (16px, 400): copy. Form inputs are forced to 16px below 768px so iOS does not zoom on focus.
- **Body-sm** (14px): the workhorse — buttons, lists, rosters, chat, forms.
- **Section title** (18px, 700) and **page title** (20–24px, 700, `AdminPageHeader`).
- **Scoreboard** (36–48px, 800, tabular-nums): the score and the kickoff countdown; the match timer runs 30–36px 800 tabular, colored by remaining ratio (ink → live → danger).

### Named Rules

**The Numbers-in-Tab Rule.** Every score, minute, timer, countdown, count, fee,
and rating uses `tabular-nums`. A number that jitters when it changes is a
broken scoreboard.

## Shapes

A sharp-edge world: painted steel has no radius. `* { border-radius: 0
!important }` is unlayered on purpose so it beats every utility — including
avatar circles. All borders are 1px `line` hairlines.

Global rules:
- **Focus:** 2px board offset + 4px amber ring (`0 0 0 2px #0b1220, 0 0 0 4px #f59e0b` box-shadow) on `a`, `button`, `input`, `textarea`, `select`, `summary`.
- **Selection:** amber on board.
- **Scrollbars:** thin, `line` thumb on `board` track.
- **Map tiles:** Leaflet containers get `grayscale(0.5) brightness(0.72) contrast(1.05)` — the plate reads as painted steel, not a daylight photo.
- **Motion:** global `prefers-reduced-motion` kill switch; component animations ship `motion-safe:` / `motion-reduce:` pairs.

## Layout & Spacing

One centered column: content max-width 72rem (`max-w-6xl`) inside a 1280px `#root`.

- **Member shell (mobile-first):** sticky top header (`bg-board/95` + `backdrop-blur` — the one allowed glass, content scrolls under it) carrying the brand row + contextual meetup line; fixed 72px bottom tab bar (`bg-panel/95` + blur, safe-area padded) with 56px tab targets. Active tab = amber text + 32×2px amber underline; unread chat = 8px danger dot on the icon.
- **Admin shell:** breadcrumb + `AdminPageHeader`; command card and roster/chat panels are `bg-panel` with 16–20px padding; list rows 8px vertical padding; every admin CTA targets ≥44px.
- **Rhythm:** sections separate by 16px gaps (`mt-4` / `space-y-4`) and 1px `line` rules (`divide-y divide-line`); team grids 1 → 2 columns with 12px gaps.

### Named Rules

**The One-Primary-Action Rule.** Each screen has exactly one `bg-ink
text-board` white painted band as its primary action.

**The No-Narration Rule.** The UI must be self-explanatory: layout, labels,
states, and controls are the documentation. No subheaders, hints, or
explanatory paragraphs that restate the layout. Keep copy that cannot be
shown — errors, non-obvious states (lease held, waitlist position, ratings
lock time), scale legends. A dead control is a finding: if a control no longer
does anything, remove it.

## Elevation & Depth

Flat by default. Depth is tonal layering (panel on board, raised on panel)
plus 1px hairlines. Shadows exist only for floating things: `shadow-xl` for
dialogs and sheets, `shadow-lg` for dropdowns and toasts. Content cards carry
none.

### Named Rules

**The Flat-By-Default Rule.** If it isn't floating, it has no shadow. If it
has no border, it has no shadow.

**The Sharp-Edge Rule.** No radius, anywhere — the global rule beats every
utility and avatar.

## Components

Direct: buttons press 2% (`active:scale-[0.98]`), disabled is an opacity step
(50–60%), focus is always the board-offset amber ring.

- **Primary CTA:** `bg-ink text-board font-bold hover:bg-white/90` — the painted white band; ≥44px tall. One per screen.
- **Live action:** `bg-live text-board hover:bg-live/90` — Pause, active "Manage match". (+ Goal and Start/Resume render as the white primary band; the referee's +1 slabs are team-color fills.)
- **Secondary:** `border border-line text-ink-dim hover:bg-raised hover:text-ink`.
- **Destructive:** `border border-danger/40 text-danger hover:bg-danger/10` — outline, never a solid red fill.
- **Input / select:** `border border-line bg-raised text-ink placeholder:text-ink-faint focus:outline-hidden focus:ring-2 focus:ring-live`; 16px text on mobile.
- **Card / container:** `border border-line bg-panel`, no shadow, 16–20px internal padding.
- **Floating:** dialog/sheet `bg-panel border border-line shadow-xl`; dropdown/toast `shadow-lg`.
- **Micro-label:** `text-2xs font-bold uppercase tracking-[0.14em] text-ink-dim`.
- **Team slab:** `bg-team-a` / `bg-team-b text-white uppercase` band; beyond two teams `bg-raised text-ink`.
- **Skill badge:** neutral — `bg-raised text-ink-dim`; the tabular number carries the level, no color.
- **Plus-one:** pink badge/avatar tint only, never structural.

## Do's and Don'ts

### Do:
- **Do** take every color from the `@theme` tokens; no hard-coded hex in components.
- **Do** spend amber only where something is happening now; keep the rest of the board neutral.
- **Do** set `tabular-nums` on every score, time, minute, count, fee, and rating.
- **Do** give each screen exactly one white painted band as the primary action.
- **Do** name every state: live (amber dot + label), offline, paused, time's up, lease held (countdown label), disabled (opacity, no pointer).
- **Do** ship `motion-safe:` / `motion-reduce:` pairs on every animation.
- **Do** keep plus-one pink as the only guest-identity exception.

### Don't:
- **Don't** reintroduce teal/emerald accents — that was the old world.
- **Don't** ship a light theme.
- **Don't** use rounded corners — the global rule kills them.
- **Don't** use amber decoratively — it means "now" and nothing else.
- **Don't** put shadows on content cards.
- **Don't** use gradient backgrounds — delete any `bg-linear-to-*`.
- **Don't** add subheaders, hints, or explanatory subtext that restates a label or the layout.
- **Don't** use glass/blur anywhere but sticky bars and overlays.
- **Don't** use emoji as icons (lucide only); chat reactions are content and stay emoji.

## Asset Provenance

- **Archivo** (variable 100–900): self-hosted from Google Fonts —
  `frontend/src/assets/fonts/archivo-latin.woff2`, `archivo-latin-ext.woff2`,
  `archivo-vietnamese.woff2`, declared via `@font-face` in
  `frontend/src/index.css`.
- **`frontend/src/assets/lottie-success.json`**: success-check animation
  (rendered by `SuccessCheckLottie`), recolored to team-a green `#16a34a` and
  live amber `#f59e0b` (plus white).
