# UI

## Design System
- **Component Library:** Local component primitives
- **Location:** `components/`

## Typography
- **Font Family:** `Instrument Serif` for display and `Manrope` for body text
- **Scale:** Editorial display headings with compact uppercase labels and 14-16px body copy

## Colors
- **Primary:** Warm amber accent (`--accent`)
- **Secondary:** Sky blue for visible thinking (`--thinking`)
- **Background:** Graphite gradients with subtle grid texture
- **Text:** Warm off-white (`--text`) with muted gray metadata (`--muted`)

## Spacing & Layout
- **Grid:** Split-shell layout with left sidebar and large conversation canvas
- **Spacing Scale:** 4px-derived Tailwind spacing with large rounded panels

## Conventions
- **Dark Mode:** Single dark theme
- **Responsive:** Mobile-first Tailwind classes; desktop uses persistent sidebar and wide chat pane
- **Settings Guidance:** The settings form shows whether the currently selected model/API mode can produce visible reasoning summaries
- **Chat Rendering:** Assistant thinking blocks render collapsed by default; streaming shows a pre-token spinner and a compact spinning `Thinking...` header while reasoning is still in progress; assistant markdown uses `remark-breaks` so provider line breaks and blank-line paragraphs survive rendering
