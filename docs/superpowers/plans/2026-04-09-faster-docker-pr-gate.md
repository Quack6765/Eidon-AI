# Faster Docker PR Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce PR CI latency by running a lightweight Docker build for normal PRs while preserving full production-image builds on `main` and on deployment-sensitive PRs.

**Architecture:** Keep the existing Docker workflow in a single file and add an explicit change-detection step for PRs. Use that result to choose between a `builder`-target Docker build for normal PRs and the full default image build for deployment-sensitive PRs or pushes to `main`.

**Tech Stack:** GitHub Actions, Docker Buildx, docker/build-push-action, dorny/paths-filter, npm, Vitest

---

## File Structure

- Modify: `.github/workflows/docker.yml`
  Purpose: Split PR Docker validation into lightweight and full-image paths while preserving full builds on `main`.
- Reference: `Dockerfile`
  Purpose: Confirm the `builder` stage is the correct lightweight target and the `runner` stage remains the full-image path.
- Reference/Test: `.github/workflows/test.yml`
  Purpose: Confirm the existing PR test gate remains unchanged and still covers application correctness.

### Task 1: Add explicit PR change detection and split Docker build modes

**Files:**
- Modify: `.github/workflows/docker.yml`

- [ ] **Step 1: Inspect the current workflow and identify the exact build step to replace**

Run:

```bash
sed -n '1,220p' .github/workflows/docker.yml
```

Expected: one `build` job with a single `docker/build-push-action@v6` step that always builds the full image for PRs and pushes to `main`.

- [ ] **Step 2: Edit the workflow to detect deployment-sensitive changes on PRs**

Replace the current workflow contents with:

```yaml
name: Docker Build

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Lowercase repository name
        run: echo "REPO_LOWERCASE=${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"

      - name: Detect deployment-sensitive changes
        id: changes
        if: github.event_name == 'pull_request'
        uses: dorny/paths-filter@v3
        with:
          filters: |
            deployment:
              - 'Dockerfile'
              - '.dockerignore'
              - '.github/workflows/docker.yml'
              - '.github/workflows/test.yml'
              - 'package.json'
              - 'package-lock.json'
              - 'next.config.*'
              - 'server.cjs'

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build full production image
        if: github.event_name == 'push' || steps.changes.outputs.deployment == 'true'
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          cache-from: |
            type=gha
            type=registry,ref=ghcr.io/${{ env.REPO_LOWERCASE }}/buildcache:main
          cache-to: |
            type=gha,mode=max
            type=registry,ref=ghcr.io/${{ env.REPO_LOWERCASE }}/buildcache:main,mode=max

      - name: Build lightweight builder image
        if: github.event_name == 'pull_request' && steps.changes.outputs.deployment != 'true'
        uses: docker/build-push-action@v6
        with:
          context: .
          target: builder
          push: false
          cache-from: |
            type=gha
            type=registry,ref=ghcr.io/${{ env.REPO_LOWERCASE }}/buildcache:main
          cache-to: |
            type=gha,mode=max
            type=registry,ref=ghcr.io/${{ env.REPO_LOWERCASE }}/buildcache:main,mode=max
```

Expected: the workflow now has one change-detection step and two mutually exclusive Docker build steps with explicit names.

- [ ] **Step 3: Review the edited workflow for branching correctness**

Run:

```bash
sed -n '1,260p' .github/workflows/docker.yml
```

Expected:
- PRs always run the `Detect deployment-sensitive changes` step
- PRs touching deployment files run `Build full production image`
- PRs not touching deployment files run `Build lightweight builder image`
- pushes to `main` skip change detection and run `Build full production image`

- [ ] **Step 4: Commit the workflow split**

Run:

```bash
git add .github/workflows/docker.yml
git commit -m "ci: split docker PR gate by change scope"
```

Expected: a single commit containing only the workflow split.

### Task 2: Verify lightweight and full Docker builds still work locally

**Files:**
- Reference: `Dockerfile`

- [ ] **Step 1: Run the existing automated test suite**

Run:

```bash
npm test
```

Expected: PASS with coverage output and no regressions.

- [ ] **Step 2: Run the lightweight Docker build locally**

Run:

```bash
docker build --target builder -t eidon:builder-check .
```

Expected: PASS and completion after the Next.js build and `ws-handler` bundle steps, without entering the heavy runtime package-install layer.

- [ ] **Step 3: Run the full Docker build locally**

Run:

```bash
docker build -t eidon:full-check .
```

Expected: PASS and completion through the final `runner` stage including Chromium and `agent-browser` installation.

- [ ] **Step 4: Inspect the final diff and recent commits**

Run:

```bash
git diff --stat HEAD~1..HEAD && git log --oneline -n 3
```

Expected: the last commit is `ci: split docker PR gate by change scope`, and the diff only contains the intended workflow change.

## Self-Review

- Spec coverage:
  - Lightweight PR build path: covered in Task 1 Step 2.
  - Deployment-sensitive PR escalation: covered in Task 1 Step 2.
  - Full `main` build retention: covered in Task 1 Step 2.
  - Verification of tests and both Docker modes: covered in Task 2.
- Placeholder scan: no `TODO`, `TBD`, or underspecified steps remain.
- Type consistency: workflow step names, path-filter output key, and Docker target names are consistent throughout the plan.
