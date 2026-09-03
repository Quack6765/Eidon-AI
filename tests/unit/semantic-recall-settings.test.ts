import { beforeEach, describe, expect, it, vi } from "vitest";

const { startSemanticIndex, stopSemanticIndex, rebuildSemanticIndex, isSemanticRecallAvailable, requireUser } =
  vi.hoisted(() => ({
    startSemanticIndex: vi.fn(async () => undefined),
    stopSemanticIndex: vi.fn(),
    rebuildSemanticIndex: vi.fn(async () => undefined),
    isSemanticRecallAvailable: vi.fn(() => false),
    requireUser: vi.fn()
  }));

vi.mock("@/lib/semantic-index", () => ({
  startSemanticIndex,
  stopSemanticIndex,
  rebuildSemanticIndex,
  isSemanticRecallAvailable,
  getSemanticIndexStatus: () => ({
    available: true,
    ready: false,
    modelId: "fake-model",
    chunkCount: 0,
    pendingCount: 0,
    backfillRunning: false
  })
}));

vi.mock("@/lib/auth", () => ({
  requireUser
}));

import { GET as getStatus, POST as rebuild } from "@/app/api/settings/semantic-recall/route";
import { PUT as putGeneral } from "@/app/api/settings/general/route";
import { GET as getServerInfo } from "@/app/api/v1/server-info/route";
import { getSettings, getSettingsForUser, updateGeneralSettingsBundleForUser } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";

describe("semantic recall settings", () => {
  beforeEach(() => {
    startSemanticIndex.mockClear();
    stopSemanticIndex.mockClear();
    rebuildSemanticIndex.mockClear();
    requireUser.mockReset();
  });

  it("is a global admin-only preference that defaults on", async () => {
    const admin = await createLocalUser({ username: "recall-admin", password: "Password123!", role: "admin" });
    const member = await createLocalUser({ username: "recall-member", password: "Password123!", role: "user" });
    expect(getSettings().semanticRecallEnabled).toBe(true);

    expect(() =>
      updateGeneralSettingsBundleForUser(member.id, { preferences: {}, semanticRecall: { enabled: false } }, false)
    ).toThrow("Only admins can update global settings");

    updateGeneralSettingsBundleForUser(admin.id, { preferences: {}, semanticRecall: { enabled: false } }, true);
    expect(getSettings().semanticRecallEnabled).toBe(false);
    expect(getSettingsForUser(member.id).semanticRecallEnabled).toBe(false);
  });

  it("starts and stops the index from the general settings route", async () => {
    const admin = await createLocalUser({ username: "recall-route-admin", password: "Password123!", role: "admin" });
    requireUser.mockResolvedValue(admin);

    const disable = await putGeneral(
      new Request("http://localhost/api/settings/general", {
        method: "PUT",
        body: JSON.stringify({ preferences: {}, semanticRecall: { enabled: false } })
      })
    );
    expect(disable.status).toBe(200);
    expect(stopSemanticIndex).toHaveBeenCalledTimes(1);
    expect(startSemanticIndex).not.toHaveBeenCalled();
    expect(getSettings().semanticRecallEnabled).toBe(false);

    const enable = await putGeneral(
      new Request("http://localhost/api/settings/general", {
        method: "PUT",
        body: JSON.stringify({ preferences: {}, semanticRecall: { enabled: true } })
      })
    );
    expect(enable.status).toBe(200);
    expect(startSemanticIndex).toHaveBeenCalledTimes(1);
    expect(getSettings().semanticRecallEnabled).toBe(true);
  });

  it("exposes status and gates rebuilds behind admin and the enabled flag", async () => {
    const admin = await createLocalUser({ username: "recall-status-admin", password: "Password123!", role: "admin" });
    const member = await createLocalUser({ username: "recall-status-member", password: "Password123!", role: "user" });

    requireUser.mockResolvedValue(member);
    const status = await getStatus();
    expect(await status.json()).toEqual({
      status: {
        available: true,
        ready: false,
        modelId: "fake-model",
        chunkCount: 0,
        pendingCount: 0,
        backfillRunning: false,
        enabled: true
      }
    });
    expect((await rebuild()).status).toBe(403);

    requireUser.mockResolvedValue(admin);
    updateGeneralSettingsBundleForUser(admin.id, { preferences: {}, semanticRecall: { enabled: false } }, true);
    expect((await rebuild()).status).toBe(400);
    updateGeneralSettingsBundleForUser(admin.id, { preferences: {}, semanticRecall: { enabled: true } }, true);
    const accepted = await rebuild();
    expect(accepted.status).toBe(200);
    expect(rebuildSemanticIndex).toHaveBeenCalledTimes(1);
  });

  it("reports the semanticRecall capability from index availability", async () => {
    isSemanticRecallAvailable.mockReturnValue(false);
    let body = await (await getServerInfo()).json();
    expect(body.data.capabilities.semanticRecall).toBe(false);
    isSemanticRecallAvailable.mockReturnValue(true);
    body = await (await getServerInfo()).json();
    expect(body.data.capabilities.semanticRecall).toBe(true);
  });
});
