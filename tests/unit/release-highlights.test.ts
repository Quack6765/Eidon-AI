import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RELEASE_NOTES } from "@/lib/release-notes";
import type { ReleaseHighlight } from "@/lib/release-notes";
import {
  buildReleaseAnnouncement,
  buildReleaseUrl,
  compareReleaseVersions,
  isReleaseVersion,
  parseReleaseVersion
} from "@/lib/release-highlights";

function entry(version: string, bullets: string[]): ReleaseHighlight {
  return { version, date: "2026-01-01", bullets };
}

describe("release version parsing", () => {
  it("accepts release tags with or without a leading v", () => {
    expect(parseReleaseVersion("v4.1.0")).toEqual([4, 1, 0]);
    expect(parseReleaseVersion("4.1.0")).toEqual([4, 1, 0]);
    expect(parseReleaseVersion("v4.0.10")).toEqual([4, 0, 10]);
    expect(isReleaseVersion("v4.1.0")).toBe(true);
  });

  it("rejects build versions that are not releases", () => {
    for (const value of ["dev", "dev-abc1234", "v3.7.0-native-test", "", "v4.", "latest"]) {
      expect(parseReleaseVersion(value)).toBeNull();
      expect(isReleaseVersion(value)).toBe(false);
    }
  });

  it("compares numerically rather than lexically", () => {
    const ten = parseReleaseVersion("v4.0.10")!;
    const nine = parseReleaseVersion("v4.0.9")!;
    const minor = parseReleaseVersion("v4.1.0")!;
    const patch = parseReleaseVersion("v4.0.1")!;

    expect(compareReleaseVersions(ten, nine)).toBe(1);
    expect(compareReleaseVersions(minor, patch)).toBe(1);
    expect(compareReleaseVersions(nine, ten)).toBe(-1);
  });

  it("treats a missing trailing segment as zero", () => {
    expect(compareReleaseVersions(parseReleaseVersion("v4.1")!, parseReleaseVersion("v4.1.0")!)).toBe(0);
  });
});

describe("buildReleaseUrl", () => {
  it("links a release tag to its GitHub release page", () => {
    expect(buildReleaseUrl("v4.1.0")).toBe(
      "https://github.com/Quack6765/Eidon-AI/releases/tag/v4.1.0"
    );
  });

  it("falls back to the releases list for non-release builds", () => {
    for (const value of ["dev", "dev-abc1234", "v3.7.0-native-test", "", "latest"]) {
      expect(buildReleaseUrl(value)).toBe("https://github.com/Quack6765/Eidon-AI/releases");
    }
  });
});

describe("buildReleaseAnnouncement", () => {
  const entries = [
    entry("v4.1.0", ["Mistral is available as a model provider", "Pushover notifications for automations"]),
    entry("v4.0.1", ["Delegation reports progress live", "The chat scrollbar stays hidden while idle"]),
    entry("v4.0.0", ["Bots with per-bot sandboxes", "Semantic memory recall"])
  ];

  it("auto-opens for a user whose seen version is unknown, showing only the current release", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.1.0",
      lastSeenVersion: "",
      entries
    });

    expect(announcement).toEqual({
      version: "v4.1.0",
      autoOpen: true,
      bullets: [
        "Mistral is available as a model provider",
        "Pushover notifications for automations"
      ]
    });
  });

  it("merges every release the user skipped, newest release first", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.1.0",
      lastSeenVersion: "v4.0.0",
      entries
    });

    expect(announcement?.autoOpen).toBe(true);
    expect(announcement?.version).toBe("v4.1.0");
    expect(announcement?.bullets).toEqual([
      "Mistral is available as a model provider",
      "Pushover notifications for automations",
      "Delegation reports progress live",
      "The chat scrollbar stays hidden while idle"
    ]);
  });

  it("stays closed once the running version has been seen", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.1.0",
      lastSeenVersion: "v4.1.0",
      entries
    });

    expect(announcement?.autoOpen).toBe(false);
    expect(announcement?.bullets).toHaveLength(2);
  });

  it("stays closed after a downgrade", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.0.1",
      lastSeenVersion: "v4.1.0",
      entries
    });

    expect(announcement?.autoOpen).toBe(false);
    expect(announcement?.version).toBe("v4.0.1");
  });

  it("stays closed for a release build with no authored entry", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.2.0",
      lastSeenVersion: "",
      entries
    });

    expect(announcement).toEqual({
      version: "v4.1.0",
      autoOpen: false,
      bullets: entries[0].bullets
    });
  });

  it("stays closed on dev builds and shows the newest authored entry", () => {
    for (const currentVersion of ["dev", "dev-abc1234", "v3.7.0-native-test"]) {
      const announcement = buildReleaseAnnouncement({
        currentVersion,
        lastSeenVersion: "",
        entries
      });

      expect(announcement?.autoOpen).toBe(false);
      expect(announcement?.version).toBe("v4.1.0");
    }
  });

  it("returns null when there is nothing authored", () => {
    expect(
      buildReleaseAnnouncement({ currentVersion: "v4.1.0", lastSeenVersion: "", entries: [] })
    ).toBeNull();
  });

  it("ignores entries with no bullets", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.1.0",
      lastSeenVersion: "",
      entries: [entry("v4.1.0", []), entry("v4.0.1", ["A real highlight"])]
    });

    expect(announcement?.version).toBe("v4.0.1");
    expect(announcement?.autoOpen).toBe(false);
  });

  it("drops exact duplicate bullets when merging", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.1.0",
      lastSeenVersion: "v4.0.0",
      entries: [
        entry("v4.1.0", ["Shared wording"]),
        entry("v4.0.1", ["Shared wording"]),
        entry("v4.0.0", ["Older"])
      ]
    });

    expect(announcement?.bullets).toEqual(["Shared wording"]);
  });

  it("sorts the entries itself so file order cannot break the merge", () => {
    const announcement = buildReleaseAnnouncement({
      currentVersion: "v4.1.0",
      lastSeenVersion: "v4.0.0",
      entries: [
        entry("v4.0.0", ["Oldest"]),
        entry("v4.1.0", ["Newest"]),
        entry("v4.0.1", ["Middle"])
      ]
    });

    expect(announcement?.bullets).toEqual(["Newest", "Middle"]);
  });
});

describe("RELEASE_NOTES", () => {
  it("ships at least one entry so the pop-up is demonstrable", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
  });

  it("is registered in the barrel for every release note file on disk", () => {
    const noteFiles = fs
      .readdirSync(path.resolve("lib/release-notes"))
      .filter((file) => /^v\d+\.\d+\.\d+\.ts$/.test(file));

    expect(noteFiles).toHaveLength(RELEASE_NOTES.length);

    for (const file of noteFiles) {
      const version = file.replace(/\.ts$/, "");
      expect(RELEASE_NOTES.some((note) => note.version === version)).toBe(true);
    }
  });

  it("keeps every entry within the authoring rules", () => {
    for (const highlight of RELEASE_NOTES) {
      expect(highlight.version).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(highlight.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(highlight.bullets.length).toBeGreaterThanOrEqual(3);
      expect(highlight.bullets.length).toBeLessThanOrEqual(6);

      for (const bullet of highlight.bullets) {
        expect(bullet.trim()).toBe(bullet);
        expect(bullet).not.toBe("");
        expect(bullet).not.toContain("\n");
        expect(bullet.length).toBeLessThanOrEqual(120);
        expect(bullet.length).toBeGreaterThan(10);
      }
    }
  });
});
