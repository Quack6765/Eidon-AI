# Faster Docker PR Gate

## Summary

Reduce pull request wait time by splitting the Docker CI gate into two levels:

- Most PRs run a lightweight Docker build that validates the application can still build inside Docker.
- Full production image builds run on pushes to `main` and on PRs that touch deployment-sensitive files.

This keeps a pre-merge Docker-aware quality gate while avoiding repeated 10-minute runtime image builds for small fixes. The existing post-merge deployment webhook remains the final production validation step because it already rebuilds with `docker compose up -d --build` and alerts on failure.

## Current State

- [`.github/workflows/docker.yml`](../../../.github/workflows/docker.yml) runs on every PR to `main` and every push to `main`.
- The workflow builds the full image from [`Dockerfile`](../../../Dockerfile) with `docker/build-push-action@v6`.
- The Docker `runner` stage installs `chromium` and global `agent-browser`, which adds substantial time to CI and is not relevant to most application-only changes.
- [`.github/workflows/test.yml`](../../../.github/workflows/test.yml) already runs `npm ci` and `npm test` on PRs.
- Production deployment already rebuilds from `main` through an external webhook, and failures are surfaced through alerting.

## Goals

- Cut PR feedback time for small fixes.
- Preserve a Docker-based pre-merge signal for normal code changes.
- Preserve full runtime-image validation before or at branch head for deployment-sensitive changes.
- Avoid duplicating the same expensive runtime build on every PR when deployment already rebuilds from `main`.

## Non-Goals

- Replace the existing deployment webhook.
- Remove Docker validation from CI entirely.
- Redesign the Dockerfile beyond what is necessary for the workflow split.

## Design

### PR behavior

For `pull_request` events targeting `main`, the Docker workflow will choose between two paths:

1. Default path: build a lightweight Docker target, expected to be the `builder` stage.
2. Escalated path: build the full default image when the PR touches deployment-sensitive files.

The lightweight path validates that:

- dependencies install successfully inside Docker
- source code copies cleanly into the Docker context
- `npm run build` succeeds in the Docker builder stage
- the PR has not broken Docker-specific build assumptions for the app itself

The lightweight path does not validate runtime-only layers such as Chromium installation or global `agent-browser` installation.

### Deployment-sensitive file detection

Full image builds should still run on PRs when any of the following change:

- [`Dockerfile`](../../../Dockerfile)
- [`.dockerignore`](../../../.dockerignore)
- [`.github/workflows/docker.yml`](../../../.github/workflows/docker.yml)
- [`.github/workflows/test.yml`](../../../.github/workflows/test.yml)
- deployment documentation in [`README.md`](../../../README.md)

This list is intentionally conservative. It covers files that can affect Docker build semantics, CI behavior, or operational deployment instructions.

### `main` behavior

For pushes to `main`, the workflow continues to build the full production image.

This provides:

- a branch-head CI signal for the real runtime image
- cache warm-up for subsequent builds
- a second line of defense before the post-merge deploy rebuild and alert path

### Workflow shape

The Docker workflow should be restructured so the build target and step naming are explicit rather than implicit. A simple approach is:

- compute whether the PR touched deployment-sensitive files
- use that result to choose either `target: builder` or the default full image build
- keep existing Buildx cache usage

The workflow should remain a single file unless complexity forces a split. The point is faster execution, not a more fragmented CI layout.

## Testing and Validation

Implementation must verify:

- normal PR path triggers the lightweight Docker build only
- deployment-sensitive PR path triggers the full image build
- push to `main` still triggers the full image build
- existing unit test workflow still passes

Local verification should include:

- `npm test`
- a local Docker build for the lightweight target
- a local full Docker build

## Expected Outcome

- Most small PRs stop waiting for the heavy runtime image layer.
- Docker-related regressions in application build logic are still caught before merge.
- Runtime-image regressions are still caught on `main`, on deployment-sensitive PRs, and by the existing deployment rebuild alerting flow.
