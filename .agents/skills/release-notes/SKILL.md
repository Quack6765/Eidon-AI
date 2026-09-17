---
name: release-notes
description: Draft, decide, and write the "What's new" release-highlight note for an upcoming Eidon release. Use when the user asks what should go in the What's new pop-up, asks to prepare or refresh release highlights, or asks to add the release note for a version about to ship.
---

# Release highlights

Produce the `lib/release-notes/<tag>.ts` entry that feeds the "What's new" pop-up.
Adding a release is a two-file change and nothing else. Read the "Release
highlights" section of `AGENTS.md` first — it is the source of truth for the
authoring rules summarized below.

Never choose the shipped bullets on your own. Classify, draft, report, and let
the user pick.

## 1. Compare `dev` against `main`, then against the last release tag

```bash
git fetch origin --tags
git tag --sort=-v:refname | head -1                       # newest release tag
git log --oneline --merges "origin/main..origin/dev"      # what dev adds on top of main
git log --oneline --merges "<tag>..origin/dev"            # everything still unannounced
git log --oneline --no-merges "<tag>..origin/dev"         # the work, without merge noise
```

The announcement is keyed off the release tag, not off `main`, so the real scope
is everything merged since the newest tag. Compare both and say so explicitly: a
merge that is already on `main` but after the last tag is still unannounced, and
a note covering only `dev`-versus-`main` would silently skip it. Confirm the
newest tag in the report, because if a release was cut since the clone the scope
shrinks.

## 2. Classify every PR, and read the diffs

For each PR, read its commits and diff (`git show --stat <sha>`, then the diff of
the files it touched) and sort it into one of two buckets:

- **User-visible** — the user can now do something they could not, or something
  that annoyed them stopped happening. Becomes a candidate bullet.
- **Internal only** — drop it: CI, docs, tests, dependency bumps, contract or
  plumbing fields, agent-instruction files, refactors with no observable effect.

Report the inventory to the user as a table of change versus PR numbers, and name
what you excluded and why. The user cannot judge the bullet choice without it.

## 3. Draft candidate bullets

Hard rules, enforced by `tests/unit/release-highlights.test.ts`:

- 3 to 6 bullets per entry — the pop-up cannot hold more.
- One line each, at most 120 characters, no trailing period, no newlines.
- Written for a non-technical self-hoster: say what they can now do, name the
  provider or service they would recognize (GLM, OpenRouter, Pushover).
- No PR numbers, author handles, "What's Changed" boilerplate, or internal
  vocabulary such as contract, route, migration, or refactor.
- A fix earns a bullet when the user felt it.

Check each length, remembering the em dash counts as one character while
`wc -c` counts three bytes:

```bash
echo -n "<bullet>" | wc -c
```

## 4. Let the user decide

Ask the user, never guess:

1. Ask about the candidate bullets a few at a time — no more than four options in
   one question — and let the user select several of them rather than only one.
   Name each change in the option itself, and give the exact drafted bullet text
   plus the PR numbers it covers so the choice is informed.
2. Ask once for the release tag, recommending a minor bump when the batch adds
   features and a patch bump when it only fixes. The note's `version` must equal
   the GitHub release tag, because the stable image takes
   `NEXT_PUBLIC_APP_VERSION` from `github.event.release.tag_name`.

If the user's selection falls outside 3 to 6 bullets, say so and ask again.
Confirm the tag before writing anything.

## 5. Write the note

1. Create `lib/release-notes/<tag>.ts` following `lib/release-notes/v4.0.1.ts`:
   `version`, `date` (`YYYY-MM-DD`, the day the note lands), and the bullets the
   user chose.
2. Register it in `lib/release-notes/index.ts` by appending to `RELEASE_NOTES`.
   Array order is irrelevant — selection is by parsed version — and appending
   leaves the older entry where the route test finds it.

TypeScript, never loose Markdown: the standalone Docker build only ships traced
and imported files, so an untraced `.md` would work in dev and be missing in
production.

## 6. Verify

```bash
npx vitest run tests/unit/release-highlights.test.ts tests/unit/whats-new-route.test.ts
npx eslint lib/release-notes/index.ts lib/release-notes/<tag>.ts
npx tsc --noEmit
```

Have the full test suite run and reported before calling the work complete, and
delegate that run to a QA agent when one is available.

Optional preview: `npm run dev`, then the version label under "Sign out" in
Settings opens the pop-up on demand. A dev build labels it `dev` and never
auto-opens, while the dialog shows the newest authored entry's version.

## 7. Report what ships

Give the user the file paths, the final bullets, and these carry-forwards: the
tag must match exactly, and the note has to land in the same PR that merges
`dev` into `main` and publishes the release. If `contracts/mobile-api-v1.*`
changed since the last tag, remind them that native clients regenerate their
derived API layers and that the release PR has to say so.
