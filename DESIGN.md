---
name: Eidon
description: Self-hosted AI workspace with clear, powerful, personal controls.
colors:
  abyss-background: "#0a0a0a"
  sidebar-charcoal: "#0f0f0f"
  panel-zinc: "#18181b"
  panel-zinc-strong: "#27272a"
  signal-text: "#f4f4f5"
  muted-ash: "#71717a"
  hairline-faint: "#ffffff0f"
  hairline-strong: "#ffffff1a"
  eidon-violet: "#8b5cf6"
  eidon-violet-soft: "#8b5cf61a"
  eidon-violet-glow: "#8b5cf640"
  thinking-indigo: "#818cf8"
  provider-cyan: "#22d3ee"
  persona-violet: "#a78bfa"
  success-green: "#22c55e"
  warning-amber: "#eab308"
  danger-red: "#ef4444"
  translucent-surface: "#ffffff08"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "clamp(2.5rem, 7vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.92em"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  wordmark:
    fontFamily: "Orbitron, Eurostile, Space Grotesk, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  composer: "26px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.eidon-violet}"
    textColor: "{colors.signal-text}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.translucent-surface}"
    textColor: "{colors.signal-text}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ash}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-field:
    backgroundColor: "{colors.translucent-surface}"
    textColor: "{colors.signal-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  settings-card:
    backgroundColor: "{colors.translucent-surface}"
    textColor: "{colors.signal-text}"
    rounded: "{rounded.md}"
    padding: "24px"
  chat-composer:
    backgroundColor: "{colors.panel-zinc}"
    textColor: "{colors.signal-text}"
    rounded: "{rounded.composer}"
    padding: "8px"
---

# Design System: Eidon

## 1. Overview

**Creative North Star: "The Private Control Room"**

Eidon's interface should feel like a focused control room for an AI workspace the user owns. It is dark because the product is used for long-running text work, configuration, and monitoring in concentrated sessions, not because dark mode is a shortcut to looking technical. The surface should stay quiet, legible, and immediate.

The system is dense but not cramped. Controls sit close to the work so capability feels available, while the main chat path stays obvious within seconds. Power should reveal through split panes, compact controls, durable tool states, and restrained accents rather than through marketing spectacle.

The visual language explicitly rejects a too-corporate SaaS dashboard, childish assistant styling, generic AI product cliches, huge gradient hero text, identical feature-card grids, and decorative complexity that makes the product harder to read.

**Key Characteristics:**
- Dark, near-black workspace with tonal depth.
- Violet as a scarce commitment color, not a background wash.
- Compact controls with readable labels and icon-first actions.
- Soft borders, low-glow focus states, and rounded but not playful surfaces.
- Mobile-safe density that keeps admin workflows usable on phones.

## 2. Colors

The palette is a restrained private-workspace palette: near-black neutrals carry the product, violet marks decisive action, and cyan/violet utility accents distinguish model and persona controls.

### Primary
- **Eidon Violet**: The primary action and selection color. Use it for send, save, active profile, focus glow, and the most important current state.
- **Eidon Violet Soft**: The tinted selection fill behind active rows, focus rings, and quiet affirmative states.

### Secondary
- **Provider Cyan**: The model/provider control accent. Use only where provider identity or runtime context needs to be found quickly.
- **Persona Violet**: The persona control accent. It is related to the primary violet, but softer and more personal.

### Tertiary
- **Thinking Indigo**: Agent activity, tool progress, and streaming intelligence cues. Keep it subordinate to Eidon Violet.
- **Success Green**, **Warning Amber**, and **Danger Red**: Operational status colors. Use them for state and feedback, never decoration.

### Neutral
- **Abyss Background**: The page background and deepest workspace layer.
- **Sidebar Charcoal**: Navigation and persistent side surfaces.
- **Panel Zinc**: Cards, composer shells, menus, and modal interiors.
- **Panel Zinc Strong**: Tooltips, code headers, elevated menus, and stronger hover surfaces.
- **Signal Text**: Primary text on dark surfaces.
- **Muted Ash**: Secondary text, placeholders, dormant icons, and metadata.
- **Hairline Faint** and **Hairline Strong**: Dividers, strokes, and subtle containment.
- **Translucent Surface**: Low-emphasis fills for icon buttons, settings sections, and disabled affordances.

### Named Rules

**The Scarce Signal Rule.** Eidon Violet is for commitment, selection, and focus. If more than 10% of a screen is violet, the screen is shouting.

**The Tonal Depth Rule.** Use near-black layers and faint borders for structure. Do not create depth with decorative purple gradients, blue fog, or large color washes.

**The Status Honesty Rule.** Green, amber, and red mean real system state. They are forbidden as decorative palette fillers.

## 3. Typography

**Display Font:** Instrument Serif, with Georgia fallback.
**Body Font:** Inter, with system sans fallback.
**Label/Mono Font:** Inter for labels; ui-monospace for code and machine output.
**Wordmark Font:** Orbitron, with Eurostile and Space Grotesk fallbacks.

**Character:** The type system is direct and compact. Inter carries the app because most screens are operational; Instrument Serif is reserved for rare editorial or empty-state moments; Orbitron belongs to the Eidon wordmark only.

### Hierarchy
- **Display** (400, clamp(2.5rem, 7vw, 4.5rem), 1): Brand and landing-scale moments only. Do not use inside dense app panels.
- **Headline** (600, 1.375rem, 1.25): Markdown h1, page titles, and high-level app headings.
- **Title** (600, 0.95rem, 1.35): Settings sections, modal titles, list group headers, and compact panels.
- **Body** (400, 14.5px, 1.75): Assistant prose, settings descriptions, and normal explanatory text. Cap long prose at 65 to 75 characters.
- **Label** (600, 11px, 0.08em where uppercase): Metadata, code-block language tags, compact field hints, and small status labels.
- **Mono** (400, 0.92em, 1.5): Inline code, code blocks, identifiers, command output, and machine-readable values.

### Named Rules

**The App Scale Rule.** Most product UI lives between 11px and 15px. Large type must signal a real change in context, not fill space.

**The Wordmark Containment Rule.** Orbitron is for the Eidon mark. It is not a general display font for headings, buttons, or cards.

## 4. Elevation

Eidon uses a hybrid of tonal layering, translucent surfaces, faint borders, and selective shadows. Most surfaces are flat at rest. Elevation appears when a control opens, a composer receives focus, or a surface must clearly float above the workspace.

### Shadow Vocabulary
- **Workspace Shadow** (`0 8px 32px rgba(0, 0, 0, 0.5)`): Login form and substantial floating panels.
- **Composer Shadow** (`0 0 40px rgba(0,0,0,0.5)`): Chat composer shell at rest.
- **Composer Focus Glow** (`0 0 50px rgba(0,0,0,0.6), 0 0 20px var(--accent-soft)`): Composer focus state only.
- **Primary Action Glow** (`0 0 20px var(--accent-glow)`): Send and primary action buttons.
- **Tooltip Shadow** (`0 2px 8px rgba(0,0,0,0.22)`): Small hover descriptions and compact tooltips.

### Named Rules

**The Flat Until Active Rule.** Surfaces do not float unless the user is interacting with them or they are temporarily above the main plane.

**The Glow Has A Job Rule.** Glow means focus, active work, or a primary action. Decorative glow is prohibited.

## 5. Components

### Buttons

Eidon buttons are compact, icon-aware, and stateful. Text buttons are for clear commands; icon buttons are preferred for common tools where the symbol is familiar.

- **Shape:** Fully rounded for primary action buttons (999px radius); gently rounded for ghost tools (12px radius).
- **Primary:** Eidon Violet fill, Signal Text, 8px 16px padding, and a soft violet glow.
- **Hover / Focus:** Increase brightness or surface fill; use a 2px focus ring or a 3px soft violet focus shadow.
- **Secondary:** Faint white fill with a subtle border. It should feel available but quieter than primary.
- **Ghost:** Transparent at rest, muted text, and a white 5% hover fill.
- **Danger:** Red tint with a faint red border. It must remain readable, not alarming by default.

### Chips

Chips are small state markers for provider types, built-in status, key state, and transport types.

- **Style:** 10px semibold type, 6px radius, 6px horizontal padding, and tinted backgrounds at about 10% opacity.
- **State:** Green means active or stdio, amber means missing key or built-in caution, sky means HTTP, violet means product-owned identity.

### Cards / Containers

Cards exist for repeated records, settings groups, menus, and framed tools. Do not nest cards.

- **Corner Style:** Gently rounded (12px), with larger radii only for the composer or floating menus.
- **Background:** Use translucent white fills or Panel Zinc, never plain black.
- **Shadow Strategy:** Flat by default; shadow only for floating or focused surfaces.
- **Border:** Hairline Faint for containment, Hairline Strong for hover and selected states.
- **Internal Padding:** 16px for compact panels, 24px for settings cards, 8px for dense list shells.

### Inputs / Fields

Inputs should feel integrated with the dark surface rather than pasted on top.

- **Style:** 12px radius, faint white border, translucent white background, 14px to 15px text.
- **Focus:** Violet 40% border and a 3px Eidon Violet Soft ring.
- **Error / Disabled:** Red or muted text with tinted background. Disabled fields stay readable enough to confirm a stored value exists.

### Navigation

Navigation is compact and persistent, with stronger state than decoration.

- **Sidebar:** Charcoal surface, faint dividers, 280px desktop width, grouped conversations, and muted inactive rows.
- **Active Rows:** Soft Eidon Violet fill, faint violet border, and Signal Text.
- **Footer Navigation:** Rounded 16px rows with icons, muted text at rest, and translucent hover fill.
- **Mobile Treatment:** Top bar with menu, centered wordmark or page title, and one right-side action. Do not add explanatory text to the bar.

### Chat Composer

The composer is the signature component. It carries text input, provider selection, persona selection, attachment controls, speech controls, context usage, queueing, and send/stop state without becoming a dashboard.

- **Shape:** Large rounded shell (22px mobile, 26px desktop).
- **Background:** Zinc 900 at 70% opacity with backdrop blur and faint white border.
- **Focus:** Border shifts toward Eidon Violet and adds a soft focus glow.
- **Action Cluster:** Send/stop remains a 40px circular button. Provider and persona controls stay compact below the draft field.
- **Attachments:** Small rounded chips with thumbnails or file icons, metadata, and a remove icon.

### Markdown And Code Blocks

Assistant content is readable prose first, with code blocks designed as compact work surfaces.

- **Markdown:** 14.5px body, 1.75 line height, softened headings, and generous paragraph rhythm.
- **Inline Code:** Small translucent pill with mono type.
- **Code Blocks:** Darker panel, 14px radius, faint border, header strip, language tag, and icon-only copy action.

## 6. Do's and Don'ts

### Do:

- **Do** make the first path obvious within seconds: new chat, type, send, provider, persona.
- **Do** keep Eidon Violet scarce and meaningful. Primary actions, active rows, and focus rings get it first.
- **Do** use tonal layers, hairline borders, and compact spacing to show hierarchy.
- **Do** keep controls close to the work, especially in the chat composer and settings detail panes.
- **Do** preserve pragmatic accessibility: readable contrast, keyboard focus, reduced-motion support, and mobile-safe layouts.
- **Do** use personal, direct language that respects capable users.

### Don't:

- **Don't** make Eidon feel like a too-corporate SaaS dashboard full of jargon, upsell framing, sterile admin panels, or abstract productivity promises.
- **Don't** make it childish, toy-like, mascot-led, gamified, or visually loud for its own sake.
- **Don't** use generic AI product cliches: huge gradient hero text, vague magic language, empty agent metaphors, identical feature-card grids, or decorative complexity.
- **Don't** put cards inside cards. Use full-width panes, split views, or simple grouped rows instead.
- **Don't** use side-stripe borders as accent decoration.
- **Don't** let violet, cyan, or status colors become background themes. They are signals, not wallpaper.
- **Don't** use Orbitron outside the Eidon wordmark.
