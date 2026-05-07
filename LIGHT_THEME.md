# THEME — Light Sketchy (Wireframe Cream)

The default theme for Skill Manager. Warm, hand-drawn, terracotta-on-cream.
Ported from the original wireframes; intended to feel like a wireframe sketch
that became a real app rather than a "polished" design.

## Color Palette

| Token         | Hex       | Usage                                        |
|---------------|-----------|----------------------------------------------|
| `paper`       | `#fdfcf8` | Page / card background (warm cream)          |
| `paper-2`     | `#f5f3ec` | Sidebar / inset surfaces, elevated panels    |
| `line`        | `#2a2a2a` | Card borders, dividers, primary strokes      |
| `line-soft`   | `#b8b3a4` | Muted rules, secondary dividers              |
| `ink`         | `#2a2a2a` | Primary text, headings                       |
| `ink-soft`    | `#555555` | Body / secondary text                        |
| `ink-faint`   | `#888888` | Labels, metadata, ghost text                 |
| `accent`      | `#c96442` | Terracotta — primary CTA, active tab pill    |
| `accent-2`    | `#3d6e8c` | Slate blue — `LayoutToggle` and focus rings  |
| `highlight`   | `#fff3a0` | Yellow highlighter swipe (update banner)     |
| `note`        | `#fef4a8` | Update-card accent fill                      |
| `warn`        | `#d97757` | Destructive / error states                   |
| `good`        | `#6f8f5e` | Success states                               |

App-shell background outside the wf-window: `#e8e4d8` (slightly cooler cream
so the paper-2 sidebar reads as elevated).

## Typography

| Role       | Font                          | Notes                              |
|------------|-------------------------------|------------------------------------|
| Hand / Title | `Caveat`, `Patrick Hand`, fallback cursive | Window titlebar, big section heads, annotations |
| Body / "Read" | `Kalam`, system-ui, sans     | All running prose, button labels  |
| Mono / Label | `JetBrains Mono`, `IBM Plex Mono`, ui-monospace | Skill names, paths, SHAs, tag pills |

**Scale:**
- Window title (hand): 19px
- View title: 18–20px / bold
- Section heading: 13–14px / bold
- Body: 12–13px
- Tag / micro-label: 10–11px / mono / often uppercase
- Card name: 13px / bold
- Card description: 11px / muted

## Spacing & Layout

- Card padding: `12–14px`
- Card gap: `10px`
- Border-radius: `6px` cards, `18px` buttons, `10px` window, `50%` icon dots
- Border weight: `1.5px` for cards / windows, `1px` for soft dividers
- Sketchy shadow offset: `3px 3px 0 var(--line)` (hard, no blur)
- Slight rotation accents (`tilt-l/r ±0.5deg`) on the update banner only

## Components

### Card
```
background: paper (#fdfcf8)
border: 1.5px solid line (#2a2a2a)
border-radius: 6px
padding: 12px 14px
hover: translateY(-2px) + 4px 6px 0 line drop-shadow + ink border
```

### Button (primary)
```
background: ink (#2a2a2a)
color: paper (#fdfcf8)
border: 1.5px solid line (#2a2a2a)
border-radius: 18px (pill)
shadow: 2px 2px 0 line-soft
```

### Button (accent)
```
background: accent (#c96442)
color: white
border-color: accent
```

### Tag / Label
```
font: mono, 10px
color: ink-soft (#555)
background: paper-2 (#f5f3ec)
border: 1px solid line-soft
border-radius: 10px
padding: 1px 7px
```

### Highlighter swipe
```
linear-gradient bottom 55%–90% in highlight (#fff3a0)
applied to inline text via .hl class
```

### Update Banner
```
background: highlight (#fff3a0)
border: 2px solid accent (#c96442)
shadow: 3px 3px 0 line
slight tilt: rotate(-0.5deg)
```

## Design Principles

1. **Hand-drawn but functional** — sketchy borders, slight tilts, but every
   element is a real interactive control with a clear hit target.
2. **Warm palette** — cream paper / terracotta / soft yellows. No pure white,
   no pure black. The app should feel like a notebook, not a spreadsheet.
3. **Mono for metadata** — paths, SHAs, dates, tag pills. Body / titles use
   the rounded "Kalam" hand-feel.
4. **Hard offset shadows** (`Xpx Ypx 0`) instead of soft blurs. Matches the
   wireframe origin.
5. **Sparse accent use** — terracotta is reserved for the active tab and
   primary calls-to-action; not used for borders or fills elsewhere.
6. **Yellow highlighter** is the second accent — used only for "fresh" /
   "needs attention" banners, never as a background.
7. **Focus rings** in `accent-2` (slate blue) so they read as intentional
   keyboard affordance, not error.

## CSS Variables

```css
:root {
  --paper:      #fdfcf8;
  --paper-2:    #f5f3ec;
  --line:       #2a2a2a;
  --line-soft:  #b8b3a4;
  --ink:        #2a2a2a;
  --ink-soft:   #555555;
  --ink-faint:  #888888;
  --accent:     #c96442;
  --accent-2:   #3d6e8c;
  --highlight:  #fff3a0;
  --note:       #fef4a8;
  --warn:       #d97757;
  --good:       #6f8f5e;

  --hand: 'Caveat', 'Patrick Hand', 'Comic Sans MS', cursive;
  --read: 'Kalam', 'Patrick Hand', system-ui, sans-serif;
  --mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace;

  --radius-card: 6px;
  --radius-button: 18px;
  --radius-window: 10px;
}
```
