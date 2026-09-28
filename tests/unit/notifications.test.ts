import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAutomation,
  createAutomationRun,
  updateAutomationRunStatus
} from "@/lib/automations";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import {
  buildStoredNotifyConfig,
  capText,
  clearPushoverCredentials,
  dispatchRunNotification,
  getPushoverCredentials,
  parseNotifyChannels,
  redactStoredNotifyConfig,
  renderRunNotificationTitle,
  setPushoverCredentials
} from "@/lib/notifications";
import { getExternalBaseUrl } from "@/lib/request-url";
import { createLocalUser } from "@/lib/users";

function jsonResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => ""
  } as Response;
}

function baseAutomationInput() {
  return {
    name: "Daily digest",
    prompt: "Summarize the day",
    providerProfileId: "profile_test",
    personaId: null,
    scheduleKind: "interval" as const,
    intervalMinutes: 60,
    calendarFrequency: null,
    timeOfDay: null,
    daysOfWeek: []
  };
}

describe("notify config storage", () => {
  it("builds stored config with encrypted webhook secrets and round-trips them", () => {
    const stored = buildStoredNotifyConfig(
      {
        channels: [
          { kind: "ntfy", topic: "my-topic", priority: 4 },
          { kind: "webhook", url: "https://hooks.example.com/TOKEN", headers: { "x-secret": "abc" } },
          { kind: "pushover", device: "phone", priority: 1 },
          { kind: "push", includeSummary: true }
        ]
      },
      "{}"
    );

    const parsed = JSON.parse(stored) as {
      channels: Array<Record<string, unknown>>;
    };
    const webhook = parsed.channels.find((channel) => channel.kind === "webhook") as {
      url: { encrypted: string };
      headers: Record<string, { encrypted: string }>;
    };
    expect(decryptValue(webhook.url.encrypted)).toBe("https://hooks.example.com/TOKEN");
    expect(decryptValue(webhook.headers["x-secret"].encrypted)).toBe("abc");

    const resolved = parseNotifyChannels(stored);
    expect(resolved).toHaveLength(4);
    expect(resolved[0]).toMatchObject({ kind: "ntfy", topic: "my-topic", priority: 4 });
    expect(resolved[1]).toMatchObject({
      kind: "webhook",
      url: "https://hooks.example.com/TOKEN",
      headers: { "x-secret": "abc" }
    });
    expect(resolved[2]).toMatchObject({ kind: "pushover", device: "phone", priority: 1 });
    expect(resolved[3]).toMatchObject({ kind: "push", includeSummary: true });
    expect(resolved.every((channel) => typeof channel.id === "string" && channel.id)).toBe(true);
  });

  it("never returns secrets from redaction", () => {
    const stored = buildStoredNotifyConfig(
      {
        channels: [
          {
            kind: "webhook",
            url: "https://hooks.example.com/TOKEN",
            headers: { authorization: "Bearer hunter2" }
          }
        ]
      },
      "{}"
    );
    const redacted = redactStoredNotifyConfig(stored);
    expect(JSON.stringify(redacted)).not.toContain("hooks.example.com");
    expect(JSON.stringify(redacted)).not.toContain("hunter2");
    expect(redacted.channels[0]).toMatchObject({
      kind: "webhook",
      url: { set: true },
      headers: { authorization: { set: true } }
    });
  });

  it("preserves stored secrets when update sends set markers", () => {
    const original = buildStoredNotifyConfig(
      { channels: [{ id: "nch_1", kind: "webhook", url: "https://hooks.example.com/TOKEN" }] },
      "{}"
    );

    const updated = buildStoredNotifyConfig(
      { channels: [{ id: "nch_1", kind: "webhook", url: { set: true }, includeSummary: true }] },
      original
    );

    const resolved = parseNotifyChannels(updated);
    expect(resolved[0]).toMatchObject({
      id: "nch_1",
      kind: "webhook",
      url: "https://hooks.example.com/TOKEN",
      includeSummary: true
    });
  });

  it("replaces secrets when update sends new values", () => {
    const original = buildStoredNotifyConfig(
      { channels: [{ id: "nch_1", kind: "webhook", url: "https://old.example.com/hook" }] },
      "{}"
    );

    const updated = buildStoredNotifyConfig(
      { channels: [{ id: "nch_1", kind: "webhook", url: "https://new.example.com/hook" }] },
      original
    );

    expect(parseNotifyChannels(updated)[0]).toMatchObject({ url: "https://new.example.com/hook" });
  });

  it("rejects set markers without a stored counterpart", () => {
    expect(() =>
      buildStoredNotifyConfig(
        { channels: [{ kind: "webhook", url: { set: true } }] },
        "{}"
      )
    ).toThrow(/no longer available/);
  });

  it("rejects non-http webhook URLs", () => {
    expect(() =>
      buildStoredNotifyConfig({ channels: [{ kind: "webhook", url: "ftp://example.com/hook" }] }, "{}")
    ).toThrow(/http or https/);
  });

  it("treats malformed JSON as no channels", () => {
    expect(parseNotifyChannels("not json")).toEqual([]);
    expect(redactStoredNotifyConfig("{oops").channels).toEqual([]);
  });

  it("skips unknown kinds and undecryptable secrets", () => {
    expect(parseNotifyChannels(JSON.stringify({ channels: [{ kind: "carrier-pigeon" }] }))).toEqual([]);

    const stored = JSON.stringify({
      channels: [{ id: "nch_1", kind: "webhook", url: { encrypted: "garbage.ciphertext" } }]
    });
    expect(parseNotifyChannels(stored)).toEqual([]);
    expect(redactStoredNotifyConfig(stored).channels).toMatchObject([
      { id: "nch_1", kind: "webhook", url: { set: true } }
    ]);
  });

  it("skips channels with invalid ntfy config", () => {
    const stored = JSON.stringify({
      channels: [
        { kind: "ntfy", topic: "" },
        { kind: "ntfy", topic: "ok-topic", server: "ftp://bad" },
        { kind: "ntfy", topic: "fine" }
      ]
    });
    const resolved = parseNotifyChannels(stored);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ kind: "ntfy", topic: "fine" });
  });
});

describe("run notification content", () => {
  it("renders title-only notifications by default", () => {
    expect(renderRunNotificationTitle({ automationName: "Daily digest", status: "completed" })).toBe(
      'Eidon: "Daily digest" completed'
    );
    expect(renderRunNotificationTitle({ automationName: "Daily digest", status: "stopped" })).toBe(
      'Eidon: "Daily digest" stopped'
    );
    expect(
      renderRunNotificationTitle({
        automationName: "Daily digest",
        status: "failed",
        errorMessage: "provider timeout"
      })
    ).toBe('Eidon: "Daily digest" failed: provider timeout');
    expect(
      renderRunNotificationTitle({ automationName: "Daily digest", status: "failed", errorMessage: null })
    ).toBe('Eidon: "Daily digest" failed: unknown error');
  });

  it("caps long titles and errors", () => {
    const title = renderRunNotificationTitle({
      automationName: "a".repeat(300),
      status: "failed",
      errorMessage: "e".repeat(400)
    });
    expect(title.length).toBeLessThanOrEqual(250);
    expect(title.endsWith("…")).toBe(true);
    expect(capText("hello world", 5)).toBe("hell…");
  });
});

describe("channel delivery request shapes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function completeRun(channelsJson: string) {
    const automation = createAutomation({ ...baseAutomationInput() });
    getDb()
      .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
      .run(channelsJson, automation.id);
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });
    updateAutomationRunStatus(run.id, {
      status: "failed",
      errorMessage: "boom",
      finishedAt: "2026-01-01T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return { automation, run };
  }

  it("posts to ntfy with topic, title, and message", async () => {
    await completeRun(
      buildStoredNotifyConfig({ channels: [{ kind: "ntfy", topic: "alerts" }] }, "{}")
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ntfy.sh");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toMatchObject({
      topic: "alerts",
      title: 'Eidon: "Daily digest" failed: boom'
    });
  });

  it("respects a custom ntfy server and strips trailing slashes", async () => {
    await completeRun(
      buildStoredNotifyConfig(
        { channels: [{ kind: "ntfy", topic: "alerts", server: "http://ntfy.lan:8080/" }] },
        "{}"
      )
    );

    expect(fetchMock.mock.calls[0][0]).toBe("http://ntfy.lan:8080");
  });

  it("posts event JSON to webhooks with configured headers and no summary by default", async () => {
    const { automation, run } = await completeRun(
      buildStoredNotifyConfig(
        {
          channels: [
            {
              kind: "webhook",
              url: "https://hooks.example.com/TOKEN",
              headers: { "x-custom": "yes" }
            }
          ]
        },
        "{}"
      )
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/TOKEN");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-custom": "yes" });
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      kind: "automation_run_done",
      status: "failed",
      automationId: automation.id,
      automationName: "Daily digest",
      runId: run.id,
      finishedAt: "2026-01-01T00:05:00.000Z",
      title: 'Eidon: "Daily digest" failed: boom'
    });
    expect(payload.summary).toBeUndefined();
  });

  it("includes a capped error summary for failed runs when opted in", async () => {
    const { automation } = await completeRun(
      buildStoredNotifyConfig(
        { channels: [{ kind: "webhook", url: "https://hooks.example.com/T", includeSummary: true }] },
        "{}"
      )
    );

    const run2 = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-02T00:00:00.000Z",
      triggerSource: "schedule"
    });
    updateAutomationRunStatus(run2.id, {
      status: "failed",
      errorMessage: "y".repeat(2000),
      finishedAt: "2026-01-02T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const lastCall = fetchMock.mock.calls[1];
    const payload = JSON.parse(lastCall[1].body);
    expect(payload.summary).toHaveLength(1000);
    expect(payload.summary!.endsWith("…")).toBe(true);
  });

  it("posts form-encoded Pushover messages and skips without owner credentials", async () => {
    const user = await createLocalUser({ username: "pushover-user", password: "Password123!", role: "user" });
    const automation = createAutomation({ ...baseAutomationInput() }, user.id);
    getDb()
      .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
      .run(
        buildStoredNotifyConfig(
          { channels: [{ kind: "pushover", device: "phone", priority: 1 }] },
          "{}"
        ),
        automation.id
      );
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).not.toHaveBeenCalled());

    setPushoverCredentials(user.id, { userKey: "user-key", appToken: "app-token" });
    const run2 = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-02T00:00:00.000Z",
      triggerSource: "schedule"
    });
    updateAutomationRunStatus(run2.id, {
      status: "completed",
      finishedAt: "2026-01-02T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.pushover.net/1/messages.json");
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    const form = new URLSearchParams(init.body);
    expect(form.get("token")).toBe("app-token");
    expect(form.get("user")).toBe("user-key");
    expect(form.get("title")).toBe('Eidon: "Daily digest" completed');
    expect(form.get("message")).toBe('Eidon: "Daily digest" completed');
    expect(form.get("device")).toBe("phone");
    expect(form.get("priority")).toBe("1");
  });

  it("stores Pushover credentials encrypted and clears them", async () => {
    const user = await createLocalUser({ username: "pushover-clear", password: "Password123!", role: "user" });
    setPushoverCredentials(user.id, { userKey: "u-key", appToken: "a-token" });

    const row = getDb()
      .prepare("SELECT credentials_encrypted FROM integration_settings WHERE capability = 'pushover' AND user_id = ?")
      .get(user.id) as { credentials_encrypted: string };
    expect(row.credentials_encrypted).not.toContain("u-key");
    expect(row.credentials_encrypted).not.toContain("a-token");
    expect(decryptValue(row.credentials_encrypted)).toContain("u-key");
    expect(getPushoverCredentials(user.id)).toEqual({ userKey: "u-key", appToken: "a-token" });
    expect(getPushoverCredentials(null)).toBeNull();

    clearPushoverCredentials(user.id);
    expect(getPushoverCredentials(user.id)).toBeNull();
  });
});

describe("delivery retry policy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function dispatchWith(fetchImpls: Array<() => Promise<Response>>) {
    fetchMock.mockImplementation(() => {
      const next = fetchImpls.shift() ?? (() => Promise.resolve(jsonResponse(200)));
      return next();
    });
    const automation = createAutomation({ ...baseAutomationInput() });
    getDb()
      .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
      .run(
        buildStoredNotifyConfig({ channels: [{ kind: "webhook", url: "https://hooks.example.com/x" }] }, "{}"),
        automation.id
      );
    await dispatchRunNotification({
      kind: "automation_run_done",
      status: "completed",
      automationId: automation.id,
      runId: "run_missing",
      finishedAt: "2026-01-01T00:00:00.000Z"
    });
  }

  it("retries retryable statuses at most twice", async () => {
    await dispatchWith([
      () => Promise.resolve(jsonResponse(500)),
      () => Promise.resolve(jsonResponse(500)),
      () => Promise.resolve(jsonResponse(200))
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after two retries", async () => {
    await dispatchWith([
      () => Promise.resolve(jsonResponse(500)),
      () => Promise.resolve(jsonResponse(500)),
      () => Promise.resolve(jsonResponse(500))
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries network errors and never throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const automation = createAutomation({ ...baseAutomationInput() });
    getDb()
      .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
      .run(
        buildStoredNotifyConfig({ channels: [{ kind: "ntfy", topic: "t" }] }, "{}"),
        automation.id
      );

    await expect(
      dispatchRunNotification({
        kind: "automation_run_done",
        status: "completed",
        automationId: automation.id,
        runId: "run_x",
        finishedAt: "2026-01-01T00:00:00.000Z"
      })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent client errors", async () => {
    await dispatchWith([() => Promise.resolve(jsonResponse(403))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts attempts after the request timeout", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        })
      );
      const automation = createAutomation({ ...baseAutomationInput() });
      getDb()
        .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
        .run(
          buildStoredNotifyConfig({ channels: [{ kind: "ntfy", topic: "t" }] }, "{}"),
          automation.id
        );

      const pending = dispatchRunNotification({
        kind: "automation_run_done",
        status: "completed",
        automationId: automation.id,
        runId: "run_x",
        finishedAt: "2026-01-01T00:00:00.000Z"
      });
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dispatch seam", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not fetch synchronously and fires once per terminal transition", async () => {
    const automation = createAutomation({
      ...baseAutomationInput(),
      notifyConfig: { channels: [{ kind: "ntfy", topic: "seam" }] }
    });
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, { status: "running", startedAt: "2026-01-01T00:01:00.000Z" });
    expect(fetchMock).not.toHaveBeenCalled();

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:02:00.000Z"
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:03:00.000Z"
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not notify for missed or non-terminal statuses", async () => {
    const automation = createAutomation({ ...baseAutomationInput() });
    getDb()
      .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
      .run(
        buildStoredNotifyConfig({ channels: [{ kind: "ntfy", topic: "seam" }] }, "{}"),
        automation.id
      );
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, { status: "missed", finishedAt: "2026-01-01T00:01:00.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when the automation has no channels or was deleted", async () => {
    const plain = createAutomation({ ...baseAutomationInput() });
    const run = createAutomationRun({
      automationId: plain.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });
    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:02:00.000Z"
    });

    const deleted = createAutomation({
      ...baseAutomationInput(),
      notifyConfig: { channels: [{ kind: "ntfy", topic: "gone" }] }
    });
    const deletedRun = createAutomationRun({
      automationId: deleted.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });
    getDb().prepare("DELETE FROM automations WHERE id = ?").run(deleted.id);
    updateAutomationRunStatus(deletedRun.id, {
      status: "failed",
      errorMessage: "deleted",
      finishedAt: "2026-01-01T00:02:00.000Z"
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers to all configured channels independently", async () => {
    const automation = createAutomation({
      ...baseAutomationInput(),
      notifyConfig: {
        channels: [
          { kind: "ntfy", topic: "one" },
          { kind: "webhook", url: "https://hooks.example.com/two" }
        ]
      }
    });
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:02:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain("https://ntfy.sh");
    expect(urls).toContain("https://hooks.example.com/two");
  });

  it("uses the completed run's last assistant message as summary", async () => {
    const user = await createLocalUser({ username: "summary-user", password: "Password123!", role: "user" });
    const conversationId = `conv_${crypto.randomUUID()}`;
    getDb()
      .prepare(
        `INSERT INTO conversations (id, user_id, title, created_at, updated_at)
         VALUES (?, ?, 'Run conversation', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
      )
      .run(conversationId, user.id);
    for (const [id, content] of [
      ["m1", "first answer"],
      ["m2", "final answer"]
    ] as const) {
      getDb()
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, thinking_content, status, created_at)
           VALUES (?, ?, 'assistant', ?, '', 'completed', '2026-01-01T00:00:30.000Z')`
        )
        .run(id, conversationId, content);
    }

    const automation = createAutomation({ ...baseAutomationInput() }, user.id);
    getDb()
      .prepare("UPDATE automations SET notify_config_json = ? WHERE id = ?")
      .run(
        buildStoredNotifyConfig(
          { channels: [{ kind: "webhook", url: "https://hooks.example.com/s", includeSummary: true }] },
          "{}"
        ),
        automation.id
      );
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });
    getDb()
      .prepare("UPDATE automation_runs SET conversation_id = ? WHERE id = ?")
      .run(conversationId, run.id);

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.summary).toBe("final answer");
  });

  it("redacts notify config on automation API reads and preserves markers on update", async () => {
    const automation = createAutomation({
      ...baseAutomationInput(),
      notifyConfig: {
        channels: [{ kind: "webhook", url: "https://hooks.example.com/SECRET", includeSummary: false }]
      }
    });

    const stored = getDb()
      .prepare("SELECT notify_config_json FROM automations WHERE id = ?")
      .get(automation.id) as { notify_config_json: string };
    expect(stored.notify_config_json).not.toContain("SECRET");
    expect(JSON.stringify(automation.notifyConfig)).not.toContain("SECRET");

    const { getAutomation, updateAutomation } = await import("@/lib/automations");
    const fetched = getAutomation(automation.id)!;
    expect(JSON.stringify(fetched.notifyConfig)).not.toContain("SECRET");
    const webhook = fetched.notifyConfig.channels[0] as { kind: "webhook"; url: { set: true } };
    expect(webhook.url).toEqual({ set: true });

    updateAutomation(automation.id, {
      notifyConfig: { channels: [{ ...webhook, includeSummary: true }] }
    });
    const reparsed = parseNotifyChannels(
      (getDb()
        .prepare("SELECT notify_config_json FROM automations WHERE id = ?")
        .get(automation.id) as { notify_config_json: string }).notify_config_json
    );
    expect(reparsed[0]).toMatchObject({
      kind: "webhook",
      url: "https://hooks.example.com/SECRET",
      includeSummary: true
    });
  });

  it("encrypts webhook secrets at rest", () => {
    const encrypted = encryptValue("secret-value");
    expect(encrypted).not.toContain("secret-value");
    expect(decryptValue(encrypted)).toBe("secret-value");
  });
});

describe("run deep links in payloads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.EIDON_BASE_URL = "https://eidon.example.com";
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.EIDON_BASE_URL;
    vi.unstubAllGlobals();
  });

  it("includes a run URL in ntfy, webhook, and pushover payloads when a base URL is configured", async () => {
    const user = await createLocalUser({ username: "deeplink-user", password: "Password123!", role: "user" });
    setPushoverCredentials(user.id, { userKey: "u", appToken: "a" });
    const automation = createAutomation(
      {
        ...baseAutomationInput(),
        notifyConfig: {
          channels: [
            { kind: "ntfy", topic: "links" },
            { kind: "webhook", url: "https://hooks.example.com/x" },
            { kind: "pushover" }
          ]
        }
      },
      user.id
    );
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const expectedUrl = `https://eidon.example.com/automations/${automation.id}/runs/${run.id}`;
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const ntfyBody = JSON.parse(String(calls.find(([url]) => url === "https://ntfy.sh")![1].body));
    expect(ntfyBody.click).toBe(expectedUrl);
    const webhookBody = JSON.parse(
      String(calls.find(([url]) => url === "https://hooks.example.com/x")![1].body)
    );
    expect(webhookBody.runUrl).toBe(expectedUrl);
    const pushoverForm = new URLSearchParams(
      String(calls.find(([url]) => url === "https://api.pushover.net/1/messages.json")![1].body)
    );
    expect(pushoverForm.get("url")).toBe(expectedUrl);
    expect(pushoverForm.get("url_title")).toBe("View run");
  });

  it("omits run URLs when no base URL is configured", async () => {
    delete process.env.EIDON_BASE_URL;
    const automation = createAutomation({
      ...baseAutomationInput(),
      notifyConfig: { channels: [{ kind: "webhook", url: "https://hooks.example.com/x" }] }
    });
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-01-01T00:05:00.000Z"
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.runUrl).toBeUndefined();
  });

  it("strips trailing slashes and rejects non-http base URLs", () => {
    process.env.EIDON_BASE_URL = "https://eidon.example.com/";
    expect(getExternalBaseUrl()).toBe("https://eidon.example.com");
    process.env.EIDON_BASE_URL = "ftp://eidon.example.com";
    expect(getExternalBaseUrl()).toBeNull();
  });
});
