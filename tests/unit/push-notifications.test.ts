import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listSubscriptionsRoute, POST as subscribeRoute, DELETE as unsubscribeRoute } from "@/app/api/push/subscribe/route";
import { GET as getVapidRoute } from "@/app/api/push/vapid/route";
import { getDb } from "@/lib/db";
import {
  deletePushSubscription,
  getVapidKeys,
  getVapidPublicKey,
  listPushSubscriptions,
  savePushSubscription,
  sendWebPush,
  setVapidKeys
} from "@/lib/push-notifications";
import { createLocalUser } from "@/lib/users";

vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "generated-public", privateKey: "generated-private" })),
    sendNotification: vi.fn()
  }
}));

import webpush from "web-push";

const authMock = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminResponse: vi.fn()
}));

vi.mock("@/lib/auth", () => authMock);

let routeUserId = "";

beforeEach(async () => {
  authMock.requireUser.mockReset();
  authMock.requireAdminResponse.mockReset();
  const routeUser = await createLocalUser({
    username: "push-route-user",
    password: "Password123!",
    role: "admin"
  });
  routeUserId = routeUser.id;
  authMock.requireUser.mockResolvedValue({
    ...routeUser,
    passwordManagedBy: "local"
  });
  authMock.requireAdminResponse.mockResolvedValue(routeUser);
  vi.mocked(webpush.sendNotification).mockReset();
  vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201 } as never);
});

describe("VAPID key storage", () => {
  it("stores the private key encrypted and never exposes it via the public getter", () => {
    expect(getVapidKeys()).toBeNull();

    setVapidKeys({ publicKey: "public-key-1", privateKey: "private-key-1" });

    const row = getDb()
      .prepare(
        "SELECT configuration_json, credentials_encrypted FROM integration_settings WHERE capability = 'push_vapid'"
      )
      .get() as { configuration_json: string; credentials_encrypted: string };
    expect(row.configuration_json).toContain("public-key-1");
    expect(row.configuration_json).not.toContain("private-key-1");
    expect(row.credentials_encrypted).not.toContain("private-key-1");

    expect(getVapidPublicKey()).toBe("public-key-1");
    expect(getVapidKeys()).toEqual({ publicKey: "public-key-1", privateKey: "private-key-1" });
  });

  it("overwrites existing keys on update", () => {
    setVapidKeys({ publicKey: "public-a", privateKey: "private-a" });
    setVapidKeys({ publicKey: "public-b", privateKey: "private-b" });
    expect(getVapidKeys()).toEqual({ publicKey: "public-b", privateKey: "private-b" });
    const rows = getDb()
      .prepare("SELECT COUNT(*) AS count FROM integration_settings WHERE capability = 'push_vapid'")
      .get() as { count: number };
    expect(rows.count).toBe(1);
  });
});

describe("VAPID routes", () => {
  it("auto-generates keys on first read and returns only the public key", async () => {
    const rowsBefore = getDb()
      .prepare("SELECT COUNT(*) AS count FROM integration_settings WHERE capability = 'push_vapid'")
      .get() as { count: number };
    expect(rowsBefore.count).toBe(0);

    const response = await getVapidRoute();
    const body = (await response.json()) as { publicKey: string };
    expect(body.publicKey).toBe("generated-public");
    expect(JSON.stringify(body)).not.toContain("generated-private");

    const rowsAfter = getDb()
      .prepare("SELECT COUNT(*) AS count FROM integration_settings WHERE capability = 'push_vapid'")
      .get() as { count: number };
    expect(rowsAfter.count).toBe(1);

    const second = (await (await getVapidRoute()).json()) as { publicKey: string };
    expect(second.publicKey).toBe("generated-public");
  });
});

describe("push subscription routes", () => {
  const subscriptionBody = {
    endpoint: "https://push.example.com/sub/1",
    keys: { p256dh: "p256dh-value", auth: "auth-value" }
  };

  it("saves a subscription scoped to the session user", async () => {
    const response = await subscribeRoute(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscriptionBody)
      })
    );
    expect(response.status).toBe(201);
    const stored = getDb()
      .prepare("SELECT user_id, p256dh FROM push_subscriptions WHERE endpoint = ?")
      .get(subscriptionBody.endpoint) as { user_id: string; p256dh: string };
    expect(stored.user_id).toBe(routeUserId);
    expect(stored.p256dh).toBe("p256dh-value");
  });

  it("rejects invalid payloads", async () => {
    const response = await subscribeRoute(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: "not-a-url", keys: { p256dh: "a", auth: "b" } })
      })
    );
    expect(response.status).toBe(400);
  });

  it("lists and deletes only the session user's subscriptions", async () => {
    const other = await createLocalUser({ username: "other-push-user", password: "Password123!", role: "user" });
    savePushSubscription(other.id, {
      endpoint: "https://push.example.com/sub/other",
      keys: { p256dh: "x", auth: "y" }
    });
    savePushSubscription(routeUserId, subscriptionBody);

    const listResponse = await listSubscriptionsRoute();
    const listBody = (await listResponse.json()) as {
      subscriptions: Array<{ endpoint: string }>;
    };
    expect(listBody.subscriptions.map((s) => s.endpoint)).toEqual([subscriptionBody.endpoint]);

    const deleteResponse = await unsubscribeRoute(
      new Request("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: "https://push.example.com/sub/other" })
      })
    );
    expect(deleteResponse.status).toBe(404);

    const ownDelete = await unsubscribeRoute(
      new Request("http://localhost/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscriptionBody.endpoint })
      })
    );
    expect(ownDelete.status).toBe(200);
    expect(listPushSubscriptions(routeUserId)).toHaveLength(0);
    expect(listPushSubscriptions(other.id)).toHaveLength(1);
  });

  it("re-subscribing an endpoint reassigns it to the new user", async () => {
    const other = await createLocalUser({ username: "push-reassign", password: "Password123!", role: "user" });
    savePushSubscription(other.id, subscriptionBody);

    authMock.requireUser.mockResolvedValue({
      id: routeUserId,
      username: "push-route-user",
      role: "admin",
      passwordManagedBy: "local"
    });
    savePushSubscription(routeUserId, {
      endpoint: subscriptionBody.endpoint,
      keys: { p256dh: "p256dh-2", auth: "auth-2" }
    });

    const rows = getDb()
      .prepare("SELECT user_id FROM push_subscriptions WHERE endpoint = ?")
      .get(subscriptionBody.endpoint) as { user_id: string };
    expect(rows.user_id).toBe(routeUserId);
    expect(deletePushSubscription(other.id, subscriptionBody.endpoint)).toBe(false);
  });
});

describe("web push delivery", () => {
  it("sends to the owner's subscriptions and records success", async () => {
    setVapidKeys({ publicKey: "pub", privateKey: "priv" });
    const user = await createLocalUser({ username: "push-owner", password: "Password123!", role: "user" });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/a",
      keys: { p256dh: "k1", auth: "a1" }
    });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/b",
      keys: { p256dh: "k2", auth: "a2" }
    });

    await sendWebPush({ userId: user.id, title: "Eidon: done", body: "summary" });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    const [subscription, payload, options] = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(subscription.endpoint).toMatch(/push\.example\.com/);
    expect(JSON.parse(payload as string)).toEqual({ title: "Eidon: done", body: "summary", url: "/" });
    expect(options).toMatchObject({
      vapidDetails: { subject: expect.stringMatching(/^mailto:/), publicKey: "pub", privateKey: "priv" }
    });

    const rows = getDb()
      .prepare("SELECT endpoint, last_success_at FROM push_subscriptions WHERE user_id = ?")
      .all(user.id) as Array<{ endpoint: string; last_success_at: string }>;
    expect(rows.every((row) => row.last_success_at)).toBe(true);
  });

  it("purges subscriptions on 410 and keeps siblings", async () => {
    setVapidKeys({ publicKey: "pub", privateKey: "priv" });
    const user = await createLocalUser({ username: "push-410", password: "Password123!", role: "user" });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/stale",
      keys: { p256dh: "k1", auth: "a1" }
    });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/fresh",
      keys: { p256dh: "k2", auth: "a2" }
    });

    vi.mocked(webpush.sendNotification).mockImplementation(async (subscription) => {
      if ((subscription as { endpoint: string }).endpoint.endsWith("/stale")) {
        const error = new Error("Gone") as Error & { statusCode?: number };
        error.statusCode = 410;
        throw error;
      }
      return { statusCode: 201 } as never;
    });

    await sendWebPush({ userId: user.id, title: "t", body: "" });

    const endpoints = listPushSubscriptions(user.id).map((s) => s.endpoint);
    expect(endpoints).toEqual(["https://push.example.com/fresh"]);
  });

  it("records last_error_at for other failures and keeps the subscription", async () => {
    setVapidKeys({ publicKey: "pub", privateKey: "priv" });
    const user = await createLocalUser({ username: "push-500", password: "Password123!", role: "user" });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/flaky",
      keys: { p256dh: "k1", auth: "a1" }
    });

    const error = new Error("push service error") as Error & { statusCode?: number };
    error.statusCode = 503;
    vi.mocked(webpush.sendNotification).mockRejectedValue(error);

    await sendWebPush({ userId: user.id, title: "t", body: "" });

    const row = getDb()
      .prepare("SELECT last_error_at, last_success_at FROM push_subscriptions WHERE endpoint = ?")
      .get("https://push.example.com/flaky") as { last_error_at: string; last_success_at: string | null };
    expect(row.last_error_at).toBeTruthy();
    expect(row.last_success_at).toBeNull();
    expect(listPushSubscriptions(user.id)).toHaveLength(1);
  });

  it("auto-generates VAPID keys on first delivery", async () => {
    const user = await createLocalUser({ username: "push-autogen", password: "Password123!", role: "user" });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/autogen",
      keys: { p256dh: "k", auth: "a" }
    });

    await sendWebPush({ userId: user.id, title: "t", body: "" });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(webpush.sendNotification).mock.calls[0][2]).toMatchObject({
      vapidDetails: { publicKey: "generated-public", privateKey: "generated-private" }
    });
  });

  it("delivers through the automation dispatch seam for push channels", async () => {
    const { createAutomation, createAutomationRun, updateAutomationRunStatus } = await import(
      "@/lib/automations"
    );
    setVapidKeys({ publicKey: "pub", privateKey: "priv" });
    const user = await createLocalUser({ username: "push-seam", password: "Password123!", role: "user" });
    savePushSubscription(user.id, {
      endpoint: "https://push.example.com/seam",
      keys: { p256dh: "k", auth: "a" }
    });

    const automation = createAutomation(
      {
        name: "Pushy",
        prompt: "hi",
        providerProfileId: "profile_test",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 30,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        notifyConfig: { channels: [{ kind: "push" }] }
      },
      user.id
    );
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    process.env.EIDON_BASE_URL = "https://eidon.example.com";
    try {
      updateAutomationRunStatus(run.id, { status: "completed", finishedAt: "2026-01-01T00:01:00.000Z" });
      await vi.waitFor(() => expect(webpush.sendNotification).toHaveBeenCalledTimes(1));

      const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
      expect(payload).toEqual({
        title: 'Eidon: "Pushy" completed',
        body: "",
        url: `https://eidon.example.com/automations/${automation.id}/runs/${run.id}`
      });
    } finally {
      delete process.env.EIDON_BASE_URL;
    }
  });
});

describe("pushover credential routes", () => {
  it("stores credentials per user without ever returning them", async () => {
    const { GET, PUT, DELETE } = await import("@/app/api/pushover/route");

    const initial = (await (await GET()).json()) as { configured: boolean };
    expect(initial.configured).toBe(false);

    const saved = await PUT(
      new Request("http://localhost/api/pushover", {
        method: "PUT",
        body: JSON.stringify({ userKey: "u-key", appToken: "a-token" })
      })
    );
    expect(saved.status).toBe(200);
    expect(JSON.stringify(await saved.json())).not.toContain("u-key");

    const configured = (await (await GET()).json()) as { configured: boolean };
    expect(configured.configured).toBe(true);

    const cleared = (await (await DELETE()).json()) as { configured: boolean };
    expect(cleared.configured).toBe(false);
  });

  it("rejects incomplete credentials", async () => {
    const { PUT } = await import("@/app/api/pushover/route");
    const response = await PUT(
      new Request("http://localhost/api/pushover", {
        method: "PUT",
        body: JSON.stringify({ userKey: "only-key" })
      })
    );
    expect(response.status).toBe(400);
  });
});
