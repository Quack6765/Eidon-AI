import { RELEASE_NOTES } from "@/lib/release-notes";
import type { ReleaseHighlight } from "@/lib/release-notes";

export type { ReleaseHighlight };

export type ReleaseAnnouncement = {
  version: string;
  autoOpen: boolean;
  bullets: string[];
};

const releaseVersionPattern = /^\d+(?:\.\d+)*$/;

export function parseReleaseVersion(value: string): number[] | null {
  const normalized = value.trim().replace(/^v/i, "");
  if (!releaseVersionPattern.test(normalized)) {
    return null;
  }

  return normalized.split(".").map((part) => Number(part));
}

export function isReleaseVersion(value: string): boolean {
  return parseReleaseVersion(value) !== null;
}

export function compareReleaseVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }

  return 0;
}

function sortNewestFirst(entries: ReleaseHighlight[]) {
  return entries
    .map((entry) => ({ entry, parsed: parseReleaseVersion(entry.version) }))
    .filter((candidate): candidate is { entry: ReleaseHighlight; parsed: number[] } =>
      candidate.parsed !== null && candidate.entry.bullets.length > 0
    )
    .sort((left, right) => compareReleaseVersions(right.parsed, left.parsed))
    .map((candidate) => candidate.entry);
}

export function getNewestReleaseNote(
  entries: ReleaseHighlight[] = RELEASE_NOTES
): ReleaseHighlight | null {
  const [newest] = sortNewestFirst(entries);
  return newest ?? null;
}

export function buildReleaseAnnouncement(input: {
  currentVersion: string;
  lastSeenVersion: string;
  entries?: ReleaseHighlight[];
}): ReleaseAnnouncement | null {
  const entries = sortNewestFirst(input.entries ?? RELEASE_NOTES);
  if (entries.length === 0) {
    return null;
  }

  const current = parseReleaseVersion(input.currentVersion);
  const newest = entries[0];
  const currentEntry = current ? entries.find((entry) => {
    const parsed = parseReleaseVersion(entry.version);
    return parsed !== null && compareReleaseVersions(parsed, current) === 0;
  }) : undefined;

  if (!current || !currentEntry) {
    return { version: newest.version, autoOpen: false, bullets: newest.bullets };
  }

  const seen = parseReleaseVersion(input.lastSeenVersion);
  const behind = seen !== null && compareReleaseVersions(seen, current) < 0;

  if (behind) {
    const missed = entries.filter((entry) => {
      const parsed = parseReleaseVersion(entry.version);
      return (
        parsed !== null &&
        compareReleaseVersions(parsed, seen) > 0 &&
        compareReleaseVersions(parsed, current) <= 0
      );
    });
    return {
      version: currentEntry.version,
      autoOpen: true,
      bullets: dedupeBullets(missed.flatMap((entry) => entry.bullets))
    };
  }

  return {
    version: currentEntry.version,
    autoOpen: seen === null,
    bullets: currentEntry.bullets
  };
}

function dedupeBullets(bullets: string[]) {
  return Array.from(new Set(bullets));
}
