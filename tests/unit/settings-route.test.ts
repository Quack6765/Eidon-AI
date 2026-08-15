import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalUser } from "@/lib/users";

const { lookupMock, requireUserMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock
}));

describe("settings route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("accepts provider-neutral speech settings on the general settings endpoint", async () => {
    const user = await createLocalUser({
      username: "settings-route-user",
      password: "Password123!",
      role: "user"
    });

    requireUserMock.mockResolvedValue(user);

    const { PUT } = await import("@/app/api/settings/general/route");
    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: {
            conversationRetention: "forever",
            mcpTimeout: 120000,
            maxAssistantToolSteps: 25,
            confirmExternalLinks: true
          },
          webSearch: {
            providerId: "disabled",
            configuration: {},
            credentialAction: "clear"
          },
          speechTranscription: {
            providerId: "elevenlabs",
            configuration: { language: "zho" },
            credential: "xi-route-secret",
            credentialAction: "replace"
          }
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          speechTranscription: {
            providerId: "elevenlabs",
            configuration: { language: "zho" },
            configured: true,
            credentialStored: true,
            scope: "user"
          }
        })
      })
    );
  });

  it("accepts AssemblyAI model configuration and rejects unsupported strict languages", async () => {
    const user = await createLocalUser({
      username: "assembly-settings-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    const { PUT } = await import("@/app/api/settings/general/route");
    const body = (configuration: { model: string; language: string }) => JSON.stringify({
      preferences: {
        conversationRetention: "forever",
        mcpTimeout: 120000,
        maxAssistantToolSteps: 25,
        confirmExternalLinks: true
      },
      webSearch: {
        providerId: "disabled",
        configuration: {},
        credentialAction: "clear"
      },
      speechTranscription: {
        providerId: "assemblyai",
        configuration,
        credential: "assembly-route-secret",
        credentialAction: "replace"
      }
    });

    const invalid = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: body({ model: "universal-3-5-pro", language: "sw" })
    }));
    expect(invalid.status).toBe(400);

    const valid = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: body({ model: "universal-2", language: "sw" })
    }));
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual(expect.objectContaining({
      settings: expect.objectContaining({
        speechTranscription: expect.objectContaining({
          providerId: "assemblyai",
          configuration: { model: "universal-2", language: "sw" },
          credentialStored: true
        })
      })
    }));
  });

  it("blocks non-admin users from pointing SearXNG at private network addresses", async () => {
    const user = await createLocalUser({
      username: "searxng-private-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { PUT } = await import("@/app/api/settings/general/route");
    const putWebSearch = (baseUrl: string) => PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: {},
          webSearch: { providerId: "searxng", configuration: { baseUrl } }
        })
      })
    );

    const metadata = await putWebSearch("http://169.254.169.254/latest/meta-data");
    expect(metadata.status).toBe(403);
    await expect(metadata.json()).resolves.toEqual({
      error: "Only admins can point web search at private network addresses."
    });

    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const unresolvable = await putWebSearch("http://searxng.missing.example");
    expect(unresolvable.status).toBe(403);

    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const localhost = await putWebSearch("http://localhost:8888");
    expect(localhost.status).toBe(403);
  });

  it("lets non-admin users save SearXNG base URLs that resolve publicly", async () => {
    const user = await createLocalUser({
      username: "searxng-public-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { PUT } = await import("@/app/api/settings/general/route");
    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: {},
          webSearch: {
            providerId: "searxng",
            configuration: { baseUrl: "https://search.example.com" }
          }
        })
      })
    );

    expect(lookupMock).toHaveBeenCalledWith("search.example.com", { all: true });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      settings: expect.objectContaining({
        webSearch: expect.objectContaining({
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" },
          configured: true,
          scope: "user"
        })
      })
    }));
  });

  it("lets admins keep pointing SearXNG at private network addresses", async () => {
    const admin = await createLocalUser({
      username: "searxng-admin-user",
      password: "Password123!",
      role: "admin"
    });
    requireUserMock.mockResolvedValue(admin);

    const { PUT } = await import("@/app/api/settings/general/route");
    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: {},
          webSearch: {
            providerId: "searxng",
            configuration: { baseUrl: "http://192.168.1.10:8888" }
          }
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      settings: expect.objectContaining({
        webSearch: expect.objectContaining({
          providerId: "searxng",
          configuration: { baseUrl: "http://192.168.1.10:8888" },
          configured: true
        })
      })
    }));
  });
});
