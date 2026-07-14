---
name: Stitch Operations
colors:
  surface: '#faf9ff'
  surface-dim: '#d3daef'
  surface-bright: '#faf9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8fe'
  surface-container-highest: '#dce2f8'
  on-surface: '#141b2b'
  on-surface-variant: '#434656'
  inverse-surface: '#293041'
  inverse-on-surface: '#edf0ff'
  outline: '#747687'
  outline-variant: '#c4c5d9'
  surface-tint: '#0e4bee'
  primary: '#0043e1'
  on-primary: '#ffffff'
  primary-container: '#2f5eff'
  on-primary-container: '#f3f2ff'
  inverse-primary: '#b8c4ff'
  secondary: '#555e72'
  on-secondary: '#ffffff'
  secondary-container: '#d9e2fa'
  on-secondary-container: '#5b6478'
  tertiary: '#9b3400'
  on-tertiary: '#ffffff'
  tertiary-container: '#c44400'
  on-tertiary-container: '#fff0ec'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b8c4ff'
  on-primary-fixed: '#001354'
  on-primary-fixed-variant: '#0036bb'
  secondary-fixed: '#d9e2fa'
  secondary-fixed-dim: '#bdc6dd'
  on-secondary-fixed: '#121c2c'
  on-secondary-fixed-variant: '#3e475a'
  tertiary-fixed: '#ffdbcf'
  tertiary-fixed-dim: '#ffb59a'
  on-tertiary-fixed: '#380d00'
  on-tertiary-fixed-variant: '#802a00'
  background: '#faf9ff'
  on-background: '#141b2b'
  surface-variant: '#dce2f8'
  paper: '#FAFBFC'
  conflict-red: '#E5484D'
  confirm-green: '#1E9E6B'
  ink: '#1C2333'
typography:
  headline-lg:
    fontFamily: IBM Plex Sans Condensed
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: IBM Plex Sans Condensed
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  data-tabular:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.01em
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  sidebar-width: 240px
  container-max: 1440px
  gutter: 1rem
  cell-padding: 0.75rem
  stack-gap: 1.5rem
---

## Brand & Style

The design system is engineered as a **Precision Instrument**. It prioritizes utility, data density, and rapid cognitive processing over decorative flair. The brand personality is institutional yet modern—evoking the focused, calm atmosphere of a high-stakes operations center like air-traffic control or medical logistics.

The aesthetic follows a **Corporate / Modern** movement with a lean towards **Functional Minimalism**. It utilizes a "Paper and Ink" philosophy to ensure high legibility, using structural grid lines and specific color signals rather than shadows or gradients to define hierarchy. The goal is to make the user feel in total control of complex data through clarity and predictability.

**Key Principles:**
- **Clarity over Visuals:** Every pixel must serve a functional purpose.
- **Immediate Feedback:** Subtle motion and state-based color coding provide instant confirmation of actions.
- **Information Density:** Layouts are compact to minimize scrolling, allowing coordinators to see the "full picture" of a semester's schedule at a glance.

## Colors

The palette is strictly functional, utilizing a high-contrast base with meaningful semantic accents. 

- **Primary (Signal Blue):** Reserved for intent-driven actions and active states. It guides the eye to the next logical step in the workflow.
- **Secondary (Slate):** Used for supporting UI chrome, labels, and borders. It recedes to let the data lead.
- **Neutral (Ink):** Used for body text and headers to ensure maximum readability against the light background.
- **Background (Paper):** A soft, off-white that reduces eye strain during long sessions compared to stark white.
- **Semantic Colors:** `Conflict Red` and `Confirm Green` are protected values. They are never used for decoration. Red signifies a hard booking collision or error, while Green confirms a successful assignment or resolved state.

## Typography

This design system uses a multi-family typographic approach to distinguish between navigation, content, and data.

- **Headings:** Utilize **IBM Plex Sans Condensed**. The slightly narrower character width allows for descriptive page titles and dense table headers without consuming excessive horizontal space.
- **Body:** **Inter** is the workhorse for all UI labels and general text, chosen for its exceptional legibility at small sizes (14-15px).
- **Data & Numbers:** **IBM Plex Mono** is mandatory for all room numbers, time slots, and course codes. Monospaced tabular figures ensure that columns of numbers align vertically, which is critical for scanning timetables for gaps or overlaps.

**Usage Note:** Keep font weights restrained. Use 600 for emphasis and 400 for standard data. Avoid ultra-bold weights to maintain the professional, institutional feel.

## Layout & Spacing

The layout is a **Fixed-Fluid Hybrid**. A persistent left sidebar (240px) provides global navigation, while the main content area expands to fill the remaining width up to a 1440px maximum to prevent line lengths from becoming unreadable.

- **Grid System:** A 12-column grid is used within the content area.
- **Rhythm:** A base-4 system drives spacing. Standard padding for cards and sections is `1.5rem` (24px), while data tables use a tighter `0.75rem` (12px) vertical cell padding to increase data density.
- **Breakpoints:** 
  - **Desktop (1024px+):** Full sidebar visible.
  - **Tablet (768px - 1023px):** Sidebar collapses to icons only. Matrix grid becomes horizontally scrollable.
  - **Mobile:** Not a primary target, but layout reflows to a single column; the Matrix grid is replaced by the List view for better accessibility.

## Elevation & Depth

To maintain a "precision instrument" feel, the design system avoids heavy shadows and deep layers. 

- **Tonal Layering:** The primary background is `--paper`. Secondary containers (like the sidebar or card backgrounds) use subtle shifts in value or a 1px solid border in `--slate` (at 20% opacity).
- **Low-Contrast Outlines:** Instead of shadows, use 1px borders to define boundaries. This keeps the UI feeling flat, crisp, and digital.
- **Functional Shadows:** Use a single, very tight, low-opacity shadow (e.g., `0 2px 4px rgba(28, 35, 51, 0.05)`) only for "floating" elements like popovers, dropdowns, or modals to separate them from the underlying data grid.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a modern touch that prevents the UI from feeling "sharp" or dated, without becoming too playful or consumer-focused.

- **Standard Radius:** 4px for buttons, input fields, and small cards.
- **Large Radius:** 8px (rounded-lg) for main content containers and modals.
- **Pills:** Used only for status badges or room categories (e.g., "Lab," "Lecture Hall") to distinguish them from interactive buttons.

## Components

### Buttons
- **Primary:** Filled Signal Blue with white text. 4px radius. 
- **Secondary:** Outlined Slate or Ghost style for less critical actions (e.g., "Cancel," "Filters").
- **States:** Hover should be a 10% darken; Active/Press a 20% darken.

### The Matrix Grid (Signature Element)
The timetable grid is the core component.
- **Cells:** White background with a 1px border. 
- **State Indicator:** A 4px wide solid vertical bar on the extreme left of the cell.
  - Grey: Unassigned.
  - Green: Auto-assigned.
  - Blue: Manually locked.
  - Red: Conflict.
- **Interaction:** Hovering a cell applies a light blue tint. Clicking opens a popover for manual overrides.

### Tables
- **Header:** IBM Plex Sans Condensed, 600 weight, Slate color. 
- **Rows:** Alternating "zebra" stripes are unnecessary; use subtle 1px bottom borders in Slate (low opacity).
- **Density:** High. Row height should be approximately 40-44px.

### Inputs & Selects
- Use a persistent `--slate` border (low opacity).
- Focus state: 2px Signal Blue border with no "glow" or outer shadow.
- Placeholder text in Slate at 60% opacity.

### Status Badges (Pills)
- Compact, using a background tint at 10-15% opacity of the category color, with the text at 100% opacity for legibility.
- Use uppercase for labels like "ROOM NO" or "CAPACITY" to provide structure to data-heavy rows.