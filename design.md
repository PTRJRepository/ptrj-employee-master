# Design — Portal Karyawan (employee-master)

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Origin: `hallmark redesign` (multi-page) on 2026-10-08. This file completes a
half-finished migration: the shipped values were already warm-paper + sage, but
the previous run stamped the theme "Cobalt" and never re-skinned it. The theme
below is named for what the values actually are.

## Genre

`editorial`

Escaped from `modern-minimal` (the previous stamp). The brief asks for a
financial-report / ledger voice: warm paper, hairline rules, serif headings,
roman display type, tabular figures. That is editorial, not modern-minimal.

## Macrostructure family

This is a `designed-as-app` system. The diversification rule is **inverted**:
consecutive pages MUST share theme, accent, type pairing. Pages may differ only
on macrostructure *within* their family.

- **Grid surfaces** (Daftar, Data Sistem, Riwayat, Monitor BHL): **Workbench**.
  The work surface IS the page. Chrome + grid, no marketing rhythm, no hero.

- **Summary surface** (Ringkasan): **Stat-Led**. Deliberately kept from the prior
  run — it is already the correct shape for a headcount summary. Consistency
  inside the app beats novelty inside the app.

Nav: **N3 side-rail** (`.rail`, already present).
Footer: **status strip** (`.statusstrip`, already present).
Both are retained — they work, and replacing them buys nothing.

## Theme — "Vintage Ledger"

Custom theme. Warm paper band (light), classical serif display, chromatic-other
accent (green, H≈151). Every value below was measured, not eyeballed.

```css
--color-paper:      #faf7f0;  /* oklch(97.7% 0.0098  87.5) */
--color-paper-2:    #f2ede2;  /* oklch(94.7% 0.0156  86.4) */
--color-paper-3:    #e9e3d6;  /* oklch(91.7% 0.0186  86.1) */
--color-rule:       #e6dfd1;  /* oklch(90.5% 0.0203  84.6) */
--color-ink:        #22201c;  /* oklch(24.4% 0.0080  84.6) */
--color-ink-2:      #3f3b34;  /* oklch(35.4% 0.0130  81.7) */
--color-muted:      #6a655b;  /* oklch(50.8% 0.0167  84.6) */
--color-neutral:    #736d61;  /* oklch(53.7% 0.0197  84.6) */
--color-accent:     #3f6b4a;  /* oklch(48.6% 0.0722 151.0) */
--color-accent-deep:#2f543a;  /* oklch(41.0% 0.0612 152.5) */
--color-accent-soft:#e7ede4;  /* oklch(93.9% 0.0136 134.9) */
--color-graphite:   #1c2430;  /* oklch(25.8% 0.0255 258.3) */
```

### Verified contrast (WCAG 2.1 on `--color-paper`)

| Pair | Ratio | Result |
|---|---|---|
| ink on paper | 15.20:1 | pass AA / AAA |
| ink-2 on paper | 10.40:1 | pass AA / AAA |
| muted on paper | 5.41:1 | pass AA |
| **neutral on paper** | **4.80:1** | **pass AA** (was 2.61:1 — fixed) |
| accent on paper | 5.75:1 | pass AA |
| accent-deep on paper | 8.01:1 | pass AA |
| accent-ink on accent fill | 6.15:1 | pass AA |
| accent-deep on accent-soft | 7.20:1 | pass AA |

### Defect fixed by this theme

`--color-neutral` was `#9a9a9a`, measuring **2.61:1** on paper while its own
source comment claimed "≥4.5:1 on paper AND paper-2". Placeholders and faint
meta text failed AA. New value `#736d61` measures 4.80:1.

## Typography

- **Display**: `Source Serif 4`, weight 400/600, **roman only** (no italic headers).
- **Body**:    `Inter`, weight 400/500/600.
- **Mono**:    `JetBrains Mono`, weight 400/500/600 — carries **tabular figures**.

The mono outlier is what keeps a 29-column ledger readable: money and dates align
by digit. Use `.tnum` / `.num` for every numeric column.

**Defect fixed by this section.** `tokens.css` requests `"Source Serif 4"` but
`index.html` only pulls `Space Grotesk + Inter + JetBrains Mono`. Source Serif 4
is never fetched, so the display face silently falls back to `Georgia`, and
Space Grotesk is downloaded and never used. The page must load Source Serif 4.

Type scale anchor: `--text-display: clamp(2.75rem, 5vw + 1rem, 5.25rem)`.
Hero figure (`--text-stat`) is reserved for Ringkasan's headcount.

## Spacing

4-point named scale, defined in `tokens.css`. Pages must use named tokens
(`var(--space-md)`), never raw values.

## Motion

- Easings: `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`; `--ease-in`; `--ease-in-out`.
- Durations: `--dur-micro` 120ms · `--dur-short` 220ms · `--dur-long` 420ms.
- Reveal pattern: fade only. No slide-ins on a data app.
- Reduced-motion fallback: opacity-only, ≤150ms. The existing
  `@media (prefers-reduced-motion: reduce)` block stays and must keep covering
  `.bar__fill` growth and the row `.flash`.

## Microinteractions stance

- **Silent success.** No celebratory toast on a successful save. The status strip
  and the row `flash` report state. Toasts are reserved for failures.
- Hover delay 800ms · focus delay 0ms.
- Cell edit commits on Enter; Escape cancels. The cell, not a toast, shows the error.
- No confirmation dialogs for reversible actions.

## CTA voice

- **Primary**: solid `--color-accent` fill, `--color-accent-ink` text, `--radius-sm`.
- **Secondary**: hairline `--color-rule-2` outline on paper.
- Buttons are square-ish (6px), never pills. A ledger has corners.

## Per-page allowances

- **App pages MUST NOT use enrichment** — function carries the page. No CSS-art
  hero, no illustration, no decorative background.
- No image assets this build. Typography only.

## What pages MUST share

- The wordmark / rail brand.
- The accent colour and its placement (≤5% of viewport).
- Display + body + mono fonts.
- The CTA voice (button shape, radius, padding rhythm).
- The grid vocabulary: `.tablewrap`, `table.data`, `.row-num`, `.pager`,
  `.statusbar`. A new grid reuses these names; it does not fork them.

## What pages MAY differ on

- Macrostructure within the page-type family (Workbench vs Stat-Led) — currently
  fixed per the table above.
- Which column groups are promoted to tab positions.
- The frozen-column choice for that page's data shape.

## Grid contract (all five pages)

One shared `<Sheet>` component. This is the reason the system exists.

- **Column model** drives header `<colgroup>` and body from one array:
  `{ key, label, group, type, width, align, editable }`.
- **All columns always render.** Group tabs are *navigation*, not filters — a tab
  scrolls to and highlights its group's column block. It never hides columns.
- **Frozen columns**: `#` (row number) and Nama stay pinned left at all times.
- **Windowed** `<tbody>` via two spacer rows. Fixed row height (single-line cells,
  `text-overflow: ellipsis`). Sub-values move to `title` tooltips.
- **Index-based** keyboard navigation (`focusedIndex` + `scrollToIndex`), never
  DOM-indexed.
- Read-only columns (`db_ptrj HR_*` source) render as non-editable cells even when
  the row is editable — editability is per-column, not per-table.

## Exports

### tokens.css

```css
:root {
  --color-paper:      #faf7f0;
  --color-paper-2:    #f2ede2;
  --color-paper-3:    #e9e3d6;
  --color-rule:       #e6dfd1;
  --color-ink:        #22201c;
  --color-ink-2:      #3f3b34;
  --color-muted:      #6a655b;
  --color-neutral:    #736d61;
  --color-accent:     #3f6b4a;
  --color-accent-ink: #ffffff;
  --color-accent-deep:#2f543a;
  --color-accent-soft:#e7ede4;
  --color-focus:      #3f6b4a;

  --font-display: "Source Serif 4", Georgia, serif;
  --font-body:    "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;

  --space-3xs: 0.125rem;  --space-2xs: 0.25rem;  --space-xs: 0.5rem;
  --space-sm:  0.75rem;   --space-md:  1rem;     --space-lg: 1.5rem;
  --space-xl:  2.5rem;    --space-2xl: 4rem;     --space-3xl: 6rem;

  --text-xs: 0.64rem;  --text-sm: 0.8rem;  --text-base: 1rem;
  --text-md: 1.25rem;  --text-lg: 1.5625rem; --text-xl: 1.9531rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-micro: 120ms;  --dur-short: 220ms;  --dur-long: 420ms;

  --radius-card: 12px; --radius-pill: 999px; --radius-input: 6px;
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:   #faf7f0;
  --color-ink:     #22201c;
  --color-accent:  #3f6b4a;
  --font-display:  "Source Serif 4", Georgia, serif;
  --font-body:     "Inter", ui-sans-serif, sans-serif;
  --font-mono:     "JetBrains Mono", ui-monospace, monospace;
  --spacing-md:    1rem;
  --text-md:       1.25rem;
  --ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":  { "$value": "oklch(97.7% 0.0098 87.5)", "$type": "color" },
    "ink":    { "$value": "oklch(24.4% 0.0080 84.6)", "$type": "color" },
    "accent": { "$value": "oklch(48.6% 0.0722 151.0)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Source Serif 4", "$type": "fontFamily" },
    "body":    { "$value": "Inter", "$type": "fontFamily" },
    "mono":    { "$value": "JetBrains Mono", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background:         97.7%  0.0098  87.5;   /* paper */
  --foreground:         24.4%  0.0080  84.6;   /* ink */
  --primary:            48.6%  0.0722 151.0;   /* accent */
  --primary-foreground: 100%   0       0;      /* accent-ink */
  --muted:              90.5%  0.0203  84.6;   /* rule */
  --muted-foreground:   50.8%  0.0167  84.6;   /* muted */
  --border:             90.5%  0.0203  84.6;   /* rule */
  --input:              82.9%  0.0265  84.6;   /* rule-2 */
  --ring:               48.6%  0.0722 151.0;   /* focus */
  --radius:             12px;
}
```
