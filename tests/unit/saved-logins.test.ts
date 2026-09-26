import { describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import {
  deleteSavedLogin,
  listSavedLogins,
  normalizeLoginLabel,
  normalizeLoginOrigin,
  readSavedLogin,
  saveLogin
} from "@/lib/saved-logins";
import { createLocalUser } from "@/lib/users";

describe("saved logins", () => {
  it("normalizes sites to their web origin and labels to one tidy line", () => {
    expect(normalizeLoginOrigin(" https://Example.com/login?next=/ ")).toBe("https://example.com");
    expect(normalizeLoginOrigin("http://intranet.test:8080/a")).toBe("http://intranet.test:8080");
    expect(normalizeLoginOrigin("ftp://example.com")).toBeNull();
    expect(normalizeLoginOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeLoginOrigin("not a url")).toBeNull();
    expect(normalizeLoginLabel("  one-time \n code ")).toBe("one-time code");
    expect(normalizeLoginLabel("x".repeat(80))).toHaveLength(60);
  });

  it("stores secrets encrypted, per user, and never lists their values", async () => {
    const owner = await createLocalUser({ username: "logins-owner", password: "Password123!", role: "user" });
    const other = await createLocalUser({ username: "logins-other", password: "Password123!", role: "user" });

    saveLogin(owner.id, "https://example.com", "Password", "first-secret");
    saveLogin(owner.id, "https://example.com", "password", "second-secret");
    saveLogin(owner.id, "https://example.org", "password", "org-secret");

    const stored = getDb().prepare("SELECT secret_encrypted FROM saved_logins").all() as Array<{ secret_encrypted: string }>;
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.secret_encrypted).join(" ")).not.toMatch(/first-secret|second-secret|org-secret/);

    const listed = listSavedLogins(owner.id);
    expect(listed.map((login) => [login.origin, login.label, login.lastUsedAt])).toEqual([
      ["https://example.com", "Password", null],
      ["https://example.org", "password", null]
    ]);
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(listSavedLogins(other.id)).toEqual([]);

    expect(readSavedLogin(owner.id, "https://example.com", "PASSWORD")).toBe("second-secret");
    expect(listSavedLogins(owner.id)[0].lastUsedAt).not.toBeNull();
    expect(readSavedLogin(other.id, "https://example.com", "password")).toBeNull();
    expect(readSavedLogin(owner.id, "https://evil.example", "password")).toBeNull();

    expect(deleteSavedLogin(listed[0].id, other.id)).toBe(false);
    expect(deleteSavedLogin(listed[0].id, owner.id)).toBe(true);
    expect(listSavedLogins(owner.id)).toHaveLength(1);
  });
});
