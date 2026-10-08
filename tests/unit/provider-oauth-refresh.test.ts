import { describe, expect, it, vi } from "vitest";

import { ensureFreshOAuthAccessToken, withAbort } from "@/lib/provider-oauth-refresh";
import {
  getRuntimeProviderProfile,
  updateProviderConnection
} from "@/lib/provider-profiles";
import { updateProviderCatalog } from "@/lib/settings";
import type { RuntimeProviderProfile } from "@/lib/types";
import { createProviderCatalogInput, createProviderProfileInput } from "@/tests/provider-fixtures";

const PROFILE_ID = "profile_oauth";

function seedConnection(refreshToken: string, expiresAt: string) {
  updateProviderCatalog(createProviderCatalogInput([
    createProviderProfileInput({
      id: PROFILE_ID,
      name: "Subscription",
      providerKind: "chatgpt_subscription",
      providerConfig: {},
      model: "gpt-6-luna",
      credentials: {}
    })
  ]));
  updateProviderConnection(PROFILE_ID, {
    credentials: { accessToken: `access_${refreshToken}`, refreshToken },
    metadata: { expiresAt, accountLabel: "owner@example.com", ownerUserId: "user_owner" }
  });
  return getRuntimeProviderProfile(PROFILE_ID)!;
}

const soon = () => new Date(Date.now() + 30_000).toISOString();
const later = () => new Date(Date.now() + 60 * 60_000).toISOString();
const shouldRefresh = (profile: RuntimeProviderProfile) =>
  Date.parse(profile.connectionMetadata.expiresAt ?? "") - Date.now() < 5 * 60_000;

describe("shared OAuth access-token refresh", () => {
  it("returns the snapshot untouched while its token is fresh", async () => {
    const profile = seedConnection("refresh_1", later());
    const refresh = vi.fn();

    await expect(ensureFreshOAuthAccessToken(profile, { label: "Test", shouldRefresh, refresh }))
      .resolves.toBe(profile);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses the stored session when another request already rotated the token", async () => {
    const stale = seedConnection("refresh_1", soon());
    updateProviderConnection(PROFILE_ID, {
      credentials: { accessToken: "access_refresh_2", refreshToken: "refresh_2" },
      metadata: { ...stale.connectionMetadata, expiresAt: later() }
    });
    const refresh = vi.fn();

    const fresh = await ensureFreshOAuthAccessToken(
      { ...stale, reasoningEffort: "low" },
      { label: "Test", shouldRefresh, refresh }
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(fresh.credentials.refreshToken).toBe("refresh_2");
    expect(fresh.reasoningEffort).toBe("low");
  });

  it("persists rotated tokens once while keeping the connection owner", async () => {
    const profile = seedConnection("refresh_1", soon());
    const refresh = vi.fn(async () => ({
      accessToken: "access_new",
      refreshToken: "refresh_new",
      expiresAt: later()
    }));

    const [first, second] = await Promise.all([
      ensureFreshOAuthAccessToken(profile, { label: "Test", shouldRefresh, refresh }),
      ensureFreshOAuthAccessToken(profile, { label: "Test", shouldRefresh, refresh })
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    const stored = getRuntimeProviderProfile(PROFILE_ID)!;
    expect(stored.credentials).toEqual({ accessToken: "access_new", refreshToken: "refresh_new" });
    expect(stored.connectionMetadata).toMatchObject({
      accountLabel: "owner@example.com",
      ownerUserId: "user_owner"
    });
  });

  it("refuses to restore credentials when the connection changed mid-refresh", async () => {
    const profile = seedConnection("refresh_1", soon());
    const refresh = vi.fn(async () => {
      updateProviderConnection(PROFILE_ID, { credentials: {}, metadata: {} });
      return { accessToken: "access_new", refreshToken: "refresh_new", expiresAt: later() };
    });

    await expect(ensureFreshOAuthAccessToken(profile, { label: "Test", shouldRefresh, refresh }))
      .rejects.toThrow("Test connection changed during token refresh");
    expect(getRuntimeProviderProfile(PROFILE_ID)!.credentials).toEqual({});
  });

  it("stops waiting when the request is aborted", async () => {
    const profile = seedConnection("refresh_1", soon());
    const aborted = AbortSignal.abort();

    await expect(ensureFreshOAuthAccessToken(profile, { label: "Test", shouldRefresh, refresh: vi.fn() }, aborted))
      .rejects.toMatchObject({ name: "AbortError", message: "Test operation aborted" });

    const controller = new AbortController();
    const onAbort = vi.fn();
    const pending = withAbort(new Promise(() => undefined), "Test", controller.signal, onAbort);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(onAbort).toHaveBeenCalledTimes(1);
    await expect(withAbort(Promise.resolve("done"), "Test")).resolves.toBe("done");
  });
});
