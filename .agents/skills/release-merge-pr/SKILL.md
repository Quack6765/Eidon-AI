---
name: release-merge-pr
description: Open the remote `dev` → `main` pull request that cuts an Eidon release, with a summary of the pull requests being brought into main. Use when the user asks to create the release PR, merge dev into main, ship a version such as v4.1.0, or run the release merge.
---

# Release merge PR (`dev` → `main`)

One PR per release, opened from the remote `dev` branch into the remote `main`
branch. Nothing is pushed — `origin/dev` already carries the work. The merge PR
is also the PR that ships the release note, so it has to exist before the tag is
cut.

## 1. Fix the release tag

Ask the user for the tag rather than inferring it — recommend a minor bump when
the batch adds features and a patch bump when it only fixes.

```bash
git fetch origin --prune --tags
git tag --sort=-v:refname | head -1        # newest release tag
```

The tag must match `lib/release-notes/<tag>.ts`. If that file is missing, stop
and say so: the "What's new" note has to land in the same PR that merges `dev`,
so run the `release-notes` skill first.

## 2. Check preconditions

```bash
git log --oneline origin/main..origin/dev    # empty → nothing to merge, stop
gh pr list --base main --state open          # an open dev → main PR → report it, never open a second
```

## 3. Collect the pull requests, not the commits

The body lists the pull requests merged into `dev`. Never dump the commit log —
a release PR built from raw commits is unreadable.

```bash
git log origin/main..origin/dev --merges --reverse --format='%s' \
  | grep -oE 'Merge pull request #[0-9]+' \
  | grep -oE '[0-9]+' | sort -n
```

Fetch each title:

```bash
for n in <numbers>; do
  gh pr view "$n" --json number,title -q '"\(.number)|\(.title)"'
done
```

Cross-check that every unit of work is accounted for. Anything in this output
that belongs to no listed PR is invisible in the body:

```bash
git log origin/main..origin/dev --no-merges --format='%h %s'
```

A squash-merged PR, a direct push, or a merge commit without a PR number shows
up here and nowhere else. Add it to the list yourself and say that you did.

## 4. Ask for the exact title

The convention is `<tag> Release` — #312 was "v4.0.1 Release", #304 was
"Release v4.0.0: merge dev into main". Ask the user to confirm the title before
creating the PR, offering `<tag> Release`, the bare `<tag>`, and a custom title.
Do not pick one on their behalf.

## 5. Write the body

Four parts, in this order:

- `## Summary` — one line: what ships, the tag, the PR count, and the diff size.
- `### Highlights` — 3 or 4 themed bullets, each naming the change and carrying
  the PR numbers it came from. Group related PRs rather than listing one bullet
  per PR, and leave out internal-only work such as agent instructions, CI, tests,
  and dependency bumps.
- `## Pull requests merged into \`dev\`` — a `| PR | Title |` table with every
  pull request from step 3, ordered by PR number. Merge order is noisy and
  unstable; ascending PR numbers are easy to scan and diff.
- `### Native clients` — only when the mobile contract moved.

```bash
git diff --shortstat origin/main...origin/dev
git diff --name-only origin/main...origin/dev -- contracts/   # non-empty → include the callout
```

`AGENTS.md` requires the PR description to say that native clients must
regenerate their derived specs. This is the wording this repo's release PRs use:

> This merge changes the mobile API v1 contract. Native clients must
> **regenerate their derived specs** from `contracts/mobile-api-v1.openapi.json`
> — a stale generated client compiles cleanly and fails only at runtime.

## 6. Create and verify

```bash
gh pr create --base main --head dev --title "<tag> Release" --body-file -
```

`--body-file -` reads the body from stdin, so no scratch file is left behind.

```bash
gh pr view <number> --json number,title,baseRefName,headRefName,state,url,additions,deletions,changedFiles
```

Confirm the PR row count equals the number of pull requests from step 3, then
report the URL, the head and base branches, and the PR count.

## 7. Stop at the PR

Merging into `main` and cutting the tag are separate, deliberate steps — do them
only when the user asks. When they do, merge the PR, then publish the release
from the release tag, which is what makes the "What's new" pop-up open for
existing installs.
