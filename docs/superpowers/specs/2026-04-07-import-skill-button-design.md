# Import Skill Button

## Summary

Add an "Import" button to the skills settings page that lets users upload a `.md` file. The file's content is parsed for YAML frontmatter metadata and used to pre-fill the existing "Add skill" form. The user can modify any values before saving.

## Scope

Client-side only. No backend changes, no new dependencies.

## Changes

### `components/settings/sections/skills-section.tsx`

1. Add a hidden `<input type="file" accept=".md">` ref.
2. Add an `Upload` icon button (from `lucide-react`) next to the existing `+` button in the `listHeader`.
3. On button click, trigger the hidden file input.
4. On file selection:
   - Read the file with `FileReader.readAsText()`.
   - Parse the content with `parseSkillContentMetadata()` (from `lib/skill-metadata.ts`).
   - Call `handleAddNew()` to enter the new-skill form state.
   - Set form values:
     - `skillName` = frontmatter `name` or fallback to filename stem (without `.md` extension).
     - `skillDescription` = frontmatter `description` or `""`.
     - `skillContent` = full file text.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| File has no frontmatter | Name = filename stem, description empty, content = full file |
| Frontmatter has only `name` | Name from frontmatter, description empty |
| Frontmatter has only `description` | Name = filename stem, description from frontmatter |
| User picks non-`.md` file | OS file picker prevents this via `accept=".md"` |

## What Stays the Same

- The "Add skill" form, its validation, and the POST `/api/skills` endpoint.
- The existing `parseSkillContentMetadata` parser in `lib/skill-metadata.ts`.
- The `+` button behavior (manual empty form).
- Built-in skill read-only handling.
