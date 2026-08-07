---
version: 1
slug: "app-settings-layout-tsx"
primary_target: "app/settings/layout.tsx"
related_targets: ["components/settings/settings-nav.tsx","components/settings/settings-split-pane.tsx","components/settings/sections/general-section.tsx","components/settings/sections/providers-section.tsx","components/settings/sections/mcp-servers-section.tsx"]
---

# Settings navigation

Scope: the complete `/settings` surface across desktop and mobile. Visitor mode: Operate.

Audience: Eidon users and workspace administrators configuring personal preferences, assistant behavior, capabilities, automations, and administration. The job is to move from a main setting to a contextual category or record, then edit it without losing place.

Direction: use the approved Option A contextual shell. Desktop keeps a persistent global settings rail, shows a contextual list only when the selected setting has meaningful categories or records, and reserves the widest pane for detail. Mobile uses push navigation with explicit parent labels. Long technical editors use selective Option C accordions; short editors remain open.

Memorable moment: the same hierarchy reads clearly at every depth, while mobile always names the parent and current destination.

Approved composition: `.impeccable/mocks/option-a-contextual-three-pane.png`. The illustrated records are compositional examples, not product data. Preserve Eidon product truth, permissions, fields, and existing behavior.

Constraints: keep the established Private Control Room visual system, avoid nested cards, use 44px mobile targets and compact desktop controls, preserve unsaved-change guards, and keep provider-specific behavior behind the existing provider boundary.

Unresolved decisions: none.
