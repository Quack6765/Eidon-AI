# UI

## Design System
- **Component Library:** Local component primitives (`components/ui/`)
- **Animation Library:** framer-motion for page transitions and micro-interactions; CSS @keyframes for message appear, typing indicators, and background orbs

## Typography
- **Font Family:** `Instrument Serif` for display headings, `Inter` for body text via `next/font/google`
- **Scale:** 11px uppercase tracking labels, 14.5px body, 3xl-5xl display headings

## Colors (CSS Custom Properties)
- **Background:** Near-black (`#0a0a0a` / `--background`)
- **Sidebar:** Very dark (`#0f0f0f` / `--sidebar`)
- **Panel/Cards:** Zinc-900 (`#18181b` / `--panel`)
- **Borders:** Ultra-subtle white (`rgba(255,255,255,0.06)` / `--line`)
- **Text:** Near-white (`#f4f4f5` / `--text`) with muted zinc (`#71717a` / `--muted`)
- **Accent:** Violet (`#8b5cf6` / `--accent`) with soft glow (`--accent-glow`)
- **Thinking:** Indigo (`#818cf8` / `--thinking`)

## Spacing & Layout
- **Grid:** Full-bleed ChatGPT-style layout with fixed left sidebar (280px, off-canvas on mobile) and central chat view
- **Max Content Width:** `max-w-5xl` for chat messages on desktop, `max-w-[980px]` for the floating composer, `max-w-[680px]` for the home input
- **Input Area:** Floating pill at bottom with gradient fade-out, accent-colored send button with glow

## Conventions
- **Dark Mode:** Single flat dark theme with violet accent; no grain/textures
- **Glassmorphism:** `backdrop-blur` on overlays and login card
- **Animations:** `animate-slide-up` for page content, `animate-fade-in` for menus/dropdowns, CSS transitions (200-300ms ease) for all interactive states, `typing-dot` keyframes for loading indicator
- **Responsive:** Mobile hamburger toggle for sidebar; desktop shows sidebar inline. Touch targets follow minimum 44px
- **Sidebar Actions:** The primary `New chat` action lives as a full-width CTA directly beneath the search control rather than as a small header icon.
- **Settings:** Two-column card layout (`lg:grid-cols-[1.3fr,0.7fr]`), rounded-xl form elements, section headers with icon badges
- **Chat Rendering:** User messages: right-aligned rounded pill with accent background. Assistant: left-aligned with avatar and a compact `w-fit` reply bubble capped to the same width as user messages, using custom `.markdown-body` styling for headings, lists, tables, blockquotes, code, task lists, links, images, and horizontal rules. Thinking: collapsible accordion with indigo border.
- **Chat Bubble Controls:** User and assistant bubbles expose compact action buttons beneath the bubble; desktop reveals them on hover/focus while mobile keeps them available without hover. User bubbles support inline editing with save/cancel controls, and all visible bubble bodies support clipboard copy.
- **Conversation Controls:** Compact header with collapsible debug info, model selector dropdown
- **Thinking Presentation:** The thinking panel is intentionally less prominent than the answer bubble, using tighter spacing, smaller type, and a subdued collapsible row.
- **Tool Activity Rows:** Assistant turns can render compact action rows above the answer body for skill loads and MCP tool calls. Running actions use a small spinner; successful actions use a green check; errors use a red X. Persisted rows replay after refresh because they are hydrated from message action records.
- **Composer Runtime Controls:** The chat composer includes a per-conversation tool mode selector with `Read-Only` and `Read/Write` options alongside the send button.
- **Composer Attachments:** The chat composer supports both the paperclip picker and drag/drop over the chat view. Pending uploads render above the textarea as removable chips with image previews or file metadata, and image attachments show a soft warning when the selected model is unlikely to support vision input.
- **MCP Settings UX:** The MCP settings card supports draft testing before save and row-level retesting after save, with inline connection result text beneath each server row or form.
- **Transcript Attachments:** User messages can render persisted attachments inline, with image previews served from authenticated attachment routes and text-like files linked for download/open.
