# THEME — Dark Minimal

## Color Palette

| Token       | Hex       | Usage                                      |
|-------------|-----------|--------------------------------------------|
| `bg`        | `#050505` | Page / slide background                    |
| `surface`   | `#111213` | Cards, panels, elevated containers         |
| `border`    | `#1e2022` | Card borders, dividers                     |
| `sep`       | `#3a3e43` | Section separators, muted rules            |
| `headline`  | `#f0f2f4` | Primary headings, high-emphasis text       |
| `body`      | `#c8cbcf` | Standard body text                         |
| `muted`     | `#8a8e93` | Secondary body, card descriptions          |
| `dim`       | `#6b6f74` | Labels, tags, metadata                     |
| `dimmer`    | `#4a4e52` | Footnotes, page numbers, ghost text        |
| `accent`    | `#3ee07a` | Primary accent — green. CTAs, highlights   |
| `accentDk`  | `#0c1f11` | Accent background — dark green tint        |

## Typography

| Role       | Font        | Notes                              |
|------------|-------------|------------------------------------|
| Headings   | Calibri     | Bold. Fallback: system-ui, sans    |
| Body       | Calibri     | Regular. Fallback: system-ui, sans |
| Mono/Label | Consolas    | Tags, metadata, code. Fallback: monospace |

**Scale (relative):**
- Page title: 52px / bold
- Section heading: 26–27px / bold
- Card title: 19–22px / bold
- Body: 10.5–11px
- Small body: 9.5px
- Label/tag: 7.5–8.5px / mono / letter-spacing 3–4px / uppercase

## Spacing & Layout

- Safe content zone: 6% padding from all edges
- Cards use `border-radius: 0` (sharp corners — no rounding anywhere)
- Left accent bar on cards: 4px wide, full card height, `accent` color
- Consistent card gap: ~10px

## Components

### Card
```
background: surface (#111213)
border: 1px solid border (#1e2022)
left edge: 4px solid accent (#3ee07a)
border-radius: 0
padding: 14px 14px 14px 18px
```

### Tag / Label
```
font: mono
font-size: 7.5–8px
color: dim (#6b6f74)
letter-spacing: 3–4px
text-transform: uppercase
```

### Section Heading
```
font: heading / bold
font-size: 26–27px
color: headline (#f0f2f4)
left border: 4px solid accent — OR — left padding with accent bar shape
```

### Stat Callout
```
large number: 40–44px, bold, accent color (#3ee07a)
label: 10.5px, muted
source: 8px, mono, dim
container: card style
```

### Accent Diamond (bullet)
```
shape: square rotated 45deg
size: 8–11px
color: accent (#3ee07a)
used instead of standard bullets
```

### Horizontal Rule
```
height: 1–2px
color: sep (#3a3e43)
no border-radius
```

### Corner Registration Marks (optional UI motif)
```
4 corners, each: two thin L-shaped lines (1–2px)
color: sep (#3a3e43)
size: ~16px per arm
creates a "frame" feel without a full border
```

## Design Principles

1. **No border-radius anywhere.** Sharp edges only.
2. **No gradients.** Flat fills only.
3. **Accent green is used sparingly** — never for background fills except `accentDk` tint.
4. **Mono font for all metadata** — numbers, tags, labels, dates, sources.
5. **Hierarchy through opacity/lightness**, not color variety — everything lives on the same dark palette.
6. **Left accent bars** are the primary structural motif for cards and headings.
7. **Uppercase tracking** on all labels (letter-spacing: 3–4px).
8. **No decorative imagery** — layout, typography, and color do all the work.

## CSS Variables (Web)

```css
:root {
  --bg:        #050505;
  --surface:   #111213;
  --border:    #1e2022;
  --sep:       #3a3e43;
  --headline:  #f0f2f4;
  --body:      #c8cbcf;
  --muted:     #8a8e93;
  --dim:       #6b6f74;
  --dimmer:    #4a4e52;
  --accent:    #3ee07a;
  --accent-dk: #0c1f11;

  --font-head: 'Calibri', system-ui, sans-serif;
  --font-body: 'Calibri', system-ui, sans-serif;
  --font-mono: 'Consolas', 'Courier New', monospace;

  --radius: 0;
  --accent-bar: 4px solid var(--accent);
}
```

## Tailwind Config (if applicable)

```js
colors: {
  bg:       '#050505',
  surface:  '#111213',
  border:   '#1e2022',
  sep:      '#3a3e43',
  headline: '#f0f2f4',
  body:     '#c8cbcf',
  muted:    '#8a8e93',
  dim:      '#6b6f74',
  dimmer:   '#4a4e52',
  accent:   '#3ee07a',
  accentDk: '#0c1f11',
},
borderRadius: { DEFAULT: '0', none: '0' },
fontFamily: {
  sans: ['Calibri', 'system-ui', 'sans-serif'],
  mono: ['Consolas', 'Courier New', 'monospace'],
},
```
