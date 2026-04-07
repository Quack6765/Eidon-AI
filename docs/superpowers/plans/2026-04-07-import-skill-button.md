# Import Skill Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Import button to the skills settings page that lets users upload a `.md` file and pre-fill the Add skill form.

**Architecture:** Client-side only. A hidden `<input type="file">` reads the `.md` file via `FileReader`. The existing `parseSkillContentMetadata` parser extracts `name`/`description` from frontmatter. The parsed values populate the same form state that `handleAddNew()` initializes.

**Tech Stack:** React, `lucide-react` (Upload icon), existing `parseSkillContentMetadata` from `lib/skill-metadata.ts`.

---

### Task 1: Add import button and file handling

**Files:**
- Modify: `components/settings/sections/skills-section.tsx`

- [ ] **Step 1: Add the import button and hidden file input**

In `skills-section.tsx`:

1. Add `useRef` to the React import (line 3):
```tsx
import { useEffect, useRef, useState } from "react";
```

2. Add `Upload` to the lucide-react import (line 4):
```tsx
import { Plus, FileText, Upload } from "lucide-react";
```

3. Add `parseSkillContentMetadata` import (after line 9):
```tsx
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
```

4. Add a file input ref inside the component, after the existing state declarations (after line 22):
```tsx
const fileInputRef = useRef<HTMLInputElement>(null);
```

5. Add a `handleImportFile` function after `handleAddNew` (after line 100):
```tsx
function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    const metadata = parseSkillContentMetadata(text);
    const filenameStem = file.name.replace(/\.md$/i, "");

    handleAddNew();
    setSkillName(metadata.name || filenameStem);
    setSkillDescription(metadata.description || "");
    setSkillContent(text);
  };
  reader.readAsText(file);

  e.target.value = "";
}
```

6. Add the hidden file input right before the closing `</div>` of the `listHeader` (before the `</div>` on line 136), and add the Upload button next to the Plus button. Replace the `listHeader` prop (lines 121-137) with:
```tsx
listHeader={
  <div className="flex items-center justify-between w-full">
    <div>
      <h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Skills</h2>
      <p className="text-[0.68rem] text-[#52525b]">
        {skills.length} skill{skills.length !== 1 ? "s" : ""}
      </p>
    </div>
    <div className="flex gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md"
        className="hidden"
        onChange={handleImportFile}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] hover:text-[#f4f4f5] hover:bg-white/[0.06] transition-all duration-200"
        title="Import skill from .md file"
      >
        <Upload className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleAddNew}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/6 bg-white/[0.03] text-[#71717a] hover:text-[#f4f4f5] hover:bg-white/[0.06] transition-all duration-200"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  </div>
}
```

- [ ] **Step 2: Verify the dev server and test in browser**

Run `npm run dev` (or use existing `.dev-server` URL). Open the settings/skills page. Verify:
- Upload button appears next to the `+` button
- Clicking it opens a file picker filtered to `.md`
- Selecting a `.md` file with frontmatter pre-fills name, description, and content
- Selecting a `.md` file without frontmatter uses filename as name
- The form is editable — user can modify values before clicking "Add skill"
- "Add skill" creates the skill successfully

- [ ] **Step 3: Commit**

```bash
git add components/settings/sections/skills-section.tsx
git commit -m "feat: add import button to skills settings page"
```
