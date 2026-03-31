# UI

## Design System
- **Component Library:** Local component primitives
- **Location:** `components/`

## Typography
- **Font Family:** `Instrument Serif` for display and `Manrope` for body text, plus standard sans-serif stacks
- **Scale:** Editorial display headings with compact uppercase labels and 14-16px body copy

## Colors
- **Main Background:** Sleek gray-black (`#212121` / `--background`)
- **Sidebar:** Deeper black (`#171717` / `--sidebar`)
- **Panel/Input:** Solid or translucent grey (`rgba(47, 47, 47, 0.6)` / `--panel`)
- **Text:** White/off-white (`#ececec` / `--text`) with subtle grey for metadata (`--muted`)
- **Accent:** White / neutral glow

## Spacing & Layout
- **Grid:** Full-bleed ChatGPT-style layout with a fixed left sidebar (off-canvas on mobile) and a central chat view
- **Spacing Scale:** 4px-derived Tailwind spacing with full-width constraints using a `max-w-3xl` center column
- **Input Area:** Docked at the bottom using a pill-shape component, layered with `absolute` & nested gradients for a modern fade-out

## Conventions
- **Dark Mode:** Single flat dark theme, moving away from heavy textures/grain towards pure glassmorphism & minimal noise
- **Responsive:** Mobile-first Hamburger toggle for sidebar; desktop uses grid/flex constraints to keep the chat pane wide but horizontally constrained
- **Settings Guidance:** The settings form manages multiple saved provider profiles, lets the operator mark one as default, and shows whether the currently selected model/API mode can produce visible reasoning summaries
- **Chat Rendering:** Bubbles replicate standard conversational UX: User gets a padded grey pill aligned right; assistant streams raw inline content. "Thinking" output collapses into a bordered accordion box.
- **Conversation Controls:** Each chat view exposes a compact in-thread provider selector tied to the conversation’s saved provider profile
