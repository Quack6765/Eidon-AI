import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("settings route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("accepts provider-neutral speech settings on the general settings endpoint", async () => {
    const admin = await createLocalUser({
      username: "settings-route-admin",
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
            scope: "global"
          }
        })
      })
    );
  });

  it("accepts AssemblyAI model configuration and rejects unsupported strict languages", async () => {
    const admin = await createLocalUser({
      username: "assembly-settings-admin",
      password: "Password123!",
      role: "admin"
    });
    requireUserMock.mockResolvedValue(admin);
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
          credentialStored: true,
          scope: "global"
        })
      })
    }));
  });

  it("persists the tool call display preference and rejects unsupported values", async () => {
    const user = await createLocalUser({
      username: "tool-display-route-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { PUT } = await import("@/app/api/settings/general/route");

    const invalid = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: { toolCallDisplay: "banners" }
        })
      })
    );
    expect(invalid.status).toBe(400);

    const valid = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: { toolCallDisplay: "status_line" }
        })
      })
    );
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({ toolCallDisplay: "status_line" })
      })
    );
  });

  it("rejects non-admin integration updates with the global settings guard", async () => {
    const user = await createLocalUser({
      username: "integration-update-user",
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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only admins can update global settings"
    });
  });

  it("lets admins point SearXNG at any network address, including private ones", async () => {
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
          configuration: {
            baseUrl: "http://192.168.1.10:8888",
            pipeline: { mode: "auto", maxQueries: 4 }
          },
          configured: true,
          scope: "global"
        })
      })
    }));
  });
});
