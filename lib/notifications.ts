import { z } from "zod";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { getExternalBaseUrl } from "@/lib/request-url";
import { sendWebPush } from "@/lib/push-notifications";
import type {
  AutomationRunStatus,
  NotifyChannel,
  NotifyConfig,
  NotifySecretRef,
  NtfyNotifyChannel,
  PushNotifyChannel,
  PushoverNotifyChannel
} from "@/lib/types";
import { nowIso } from "@/lib/utils";

export const MAX_NOTIFY_CHANNELS = 10;
export const NOTIFY_SUMMARY_MAX_CHARS = 1000;
export const NOTIFY_TITLE_MAX_CHARS = 250;
export const NOTIFY_ERROR_MAX_CHARS = 180;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const DEFAULT_NTFY_SERVER = "https://ntfy.sh";
const PUSHOVER_MESSAGES_ENDPOINT = "https://api.pushover.net/1/messages.json";
const PUSHOVER_MESSAGE_MAX_CHARS = 1024;
const PUSHOVER_CAPABILITY = "pushover";
const PUSHOVER_PROVIDER_ID = "pushover";

export type AutomationRunDoneEvent = {
  kind: "automation_run_done";
  status: "completed" | "failed" | "stopped";
  automationId: string;
  runId: string;
  finishedAt: string;
  errorMessage?: string | null;
};

export type NotificationEvent = AutomationRunDoneEvent;

export type ResolvedNotifyChannel =
  | NtfyNotifyChannel
  | (Omit<Extract<NotifyChannel, { kind: "webhook" }>, "url" | "headers"> & {
      url: string;
      headers?: Record<string, string>;
    })
  | PushoverNotifyChannel
  | PushNotifyChannel;

export function isNotifiableRunStatus(status: AutomationRunStatus): status is "completed" | "failed" | "stopped" {
  return status === "completed" || status === "failed" || status === "stopped";
}

const secretInputSchema = z.union([z.string().min(1), z.object({ set: z.literal(true) })]);

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "URL must use http or https");

const notifyChannelInputSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal("ntfy"),
    server: httpUrlSchema.optional(),
    topic: z.string().trim().min(1).max(128),
    priority: z.number().int().min(1).max(5).optional(),
    includeSummary: z.boolean().optional()
  }),
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal("webhook"),
    url: secretInputSchema,
    headers: z.record(z.string().min(1).max(64), secretInputSchema).optional(),
    includeSummary: z.boolean().optional()
  }),
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal("pushover"),
    device: z.string().trim().min(1).max(64).optional(),
    priority: z.number().int().min(-2).max(1).optional(),
    includeSummary: z.boolean().optional()
  }),
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal("push"),
    includeSummary: z.boolean().optional()
  })
]);

export const notifyConfigInputSchema = z.object({
  channels: z.array(notifyChannelInputSchema).max(MAX_NOTIFY_CHANNELS)
});

type StoredSecret = { encrypted: string };

function isStoredSecret(value: unknown): value is StoredSecret {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as StoredSecret).encrypted === "string" &&
    (value as StoredSecret).encrypted.length > 0
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseRawChannels(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const channels = (parsed as { channels?: unknown }).channels;
    if (!Array.isArray(channels)) {
      return [];
    }
    return channels
      .filter((channel): channel is Record<string, unknown> =>
        Boolean(channel) && typeof channel === "object" && !Array.isArray(channel)
      )
      .slice(0, MAX_NOTIFY_CHANNELS);
  } catch {
    return [];
  }
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim().slice(0, maxLength);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalPriority(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function channelId(value: unknown): string {
  return typeof value === "string" && value ? value : createId("nch");
}

function decryptSecret(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (isStoredSecret(value)) {
    try {
      const decrypted = decryptValue(value.encrypted);
      return decrypted || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function parseNotifyChannels(raw: string): ResolvedNotifyChannel[] {
  return parseRawChannels(raw).flatMap<ResolvedNotifyChannel>((record) => {
    switch (record.kind) {
      case "ntfy": {
        const topic = optionalString(record.topic, 128);
        if (!topic) {
          return [];
        }
        const server = optionalString(record.server, 2048);
        if (server && !isHttpUrl(server)) {
          return [];
        }
        const channel: NtfyNotifyChannel = {
          id: channelId(record.id),
          kind: "ntfy",
          topic,
          ...(server ? { server } : {}),
          ...(optionalPriority(record.priority, 1, 5) !== undefined
            ? { priority: optionalPriority(record.priority, 1, 5) }
            : {}),
          ...(optionalBoolean(record.includeSummary) !== undefined
            ? { includeSummary: optionalBoolean(record.includeSummary) }
            : {})
        };
        return [channel];
      }
      case "webhook": {
        const url = decryptSecret(record.url);
        if (!url || !isHttpUrl(url)) {
          return [];
        }
        const rawHeaders = record.headers;
        let headers: Record<string, string> | undefined;
        if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
          const entries = Object.entries(rawHeaders as Record<string, unknown>);
          const decoded: Array<[string, string]> = [];
          for (const [name, value] of entries) {
            const decodedValue = decryptSecret(value);
            if (decodedValue === null) {
              return [];
            }
            decoded.push([name, decodedValue]);
          }
          if (decoded.length) {
            headers = Object.fromEntries(decoded);
          }
        }
        return [
          {
            id: channelId(record.id),
            kind: "webhook",
            url,
            ...(headers ? { headers } : {}),
            ...(optionalBoolean(record.includeSummary) !== undefined
              ? { includeSummary: optionalBoolean(record.includeSummary) }
              : {})
          }
        ];
      }
      case "pushover": {
        return [
          {
            id: channelId(record.id),
            kind: "pushover",
            ...(optionalString(record.device, 64)
              ? { device: optionalString(record.device, 64) }
              : {}),
            ...(optionalPriority(record.priority, -2, 1) !== undefined
              ? { priority: optionalPriority(record.priority, -2, 1) }
              : {}),
            ...(optionalBoolean(record.includeSummary) !== undefined
              ? { includeSummary: optionalBoolean(record.includeSummary) }
              : {})
          }
        ];
      }
      case "push": {
        return [
          {
            id: channelId(record.id),
            kind: "push",
            ...(optionalBoolean(record.includeSummary) !== undefined
              ? { includeSummary: optionalBoolean(record.includeSummary) }
              : {})
          }
        ];
      }
      default:
        return [];
    }
  });
}

export function redactStoredNotifyConfig(raw: string): NotifyConfig {
  return {
    channels: parseRawChannels(raw).flatMap<NotifyChannel>((record) => {
      const redactedSecret = (value: unknown): NotifySecretRef | undefined =>
        (typeof value === "string" && value) || isStoredSecret(value) ? { set: true } : undefined;

      switch (record.kind) {
        case "ntfy": {
          const topic = optionalString(record.topic, 128);
          if (!topic) {
            return [];
          }
          const server = optionalString(record.server, 2048);
          if (server && !isHttpUrl(server)) {
            return [];
          }
          return [
            {
              id: channelId(record.id),
              kind: "ntfy",
              topic,
              ...(server ? { server } : {}),
              ...(optionalPriority(record.priority, 1, 5) !== undefined
                ? { priority: optionalPriority(record.priority, 1, 5) }
                : {}),
              ...(optionalBoolean(record.includeSummary) !== undefined
                ? { includeSummary: optionalBoolean(record.includeSummary) }
                : {})
            }
          ];
        }
        case "webhook": {
          const url = redactedSecret(record.url);
          if (!url) {
            return [];
          }
          const rawHeaders = record.headers;
          let headers: Record<string, NotifySecretRef> | undefined;
          if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
            const entries = Object.entries(rawHeaders as Record<string, unknown>);
            const redacted: Array<[string, NotifySecretRef]> = [];
            for (const [name, value] of entries) {
              const ref = redactedSecret(value);
              if (!ref) {
                return [];
              }
              redacted.push([name, ref]);
            }
            if (redacted.length) {
              headers = Object.fromEntries(redacted);
            }
          }
          return [
            {
              id: channelId(record.id),
              kind: "webhook",
              url,
              ...(headers ? { headers } : {}),
              ...(optionalBoolean(record.includeSummary) !== undefined
                ? { includeSummary: optionalBoolean(record.includeSummary) }
                : {})
            }
          ];
        }
        case "pushover": {
          return [
            {
              id: channelId(record.id),
              kind: "pushover",
              ...(optionalString(record.device, 64)
                ? { device: optionalString(record.device, 64) }
                : {}),
              ...(optionalPriority(record.priority, -2, 1) !== undefined
                ? { priority: optionalPriority(record.priority, -2, 1) }
                : {}),
              ...(optionalBoolean(record.includeSummary) !== undefined
                ? { includeSummary: optionalBoolean(record.includeSummary) }
                : {})
            }
          ];
        }
        case "push": {
          return [
            {
              id: channelId(record.id),
              kind: "push",
              ...(optionalBoolean(record.includeSummary) !== undefined
                ? { includeSummary: optionalBoolean(record.includeSummary) }
                : {})
            }
          ];
        }
        default:
          return [];
      }
    })
  };
}

function resolveSecretInput(
  input: string | NotifySecretRef,
  current: unknown,
  options: { label: string; validate: (value: string) => boolean; invalidMessage: string }
): StoredSecret {
  if (typeof input !== "string") {
    if (isStoredSecret(current)) {
      return current;
    }
    throw new Error(`Stored ${options.label} is no longer available; re-enter the value`);
  }
  if (!options.validate(input)) {
    throw new Error(options.invalidMessage);
  }
  return { encrypted: encryptValue(input) };
}

export function buildStoredNotifyConfig(input: NotifyConfig, currentRaw: string): string {
  const currentChannels = parseRawChannels(currentRaw);

  const findCurrentWebhook = (id: string) =>
    currentChannels.find(
      (channel) => channel.kind === "webhook" && channelId(channel.id) === id
    ) as
      | { url?: unknown; headers?: Record<string, unknown> }
      | undefined;

  const channels = input.channels.map((channel) => {
    const id = channel.id ?? createId("nch");

    if (channel.kind === "webhook") {
      const current = findCurrentWebhook(id);
      const headers =
        channel.headers &&
        Object.fromEntries(
          Object.entries(channel.headers).map(([name, value]) => [
            name,
            resolveSecretInput(value, current?.headers?.[name], {
              label: `webhook header "${name}"`,
              validate: (headerValue) =>
                headerValue.length <= 512 && !/[\r\n]/.test(headerValue),
              invalidMessage: `Webhook header "${name}" is invalid`
            })
          ])
        );
      return {
        id,
        kind: "webhook" as const,
        url: resolveSecretInput(channel.url, current?.url, {
          label: "webhook URL",
          validate: isHttpUrl,
          invalidMessage: "Webhook URL must use http or https"
        }),
        ...(Object.keys(headers ?? {}).length ? { headers } : {}),
        ...(channel.includeSummary !== undefined ? { includeSummary: channel.includeSummary } : {})
      };
    }

    return { ...channel, id };
  });

  return JSON.stringify({ channels });
}

export function buildRunUrl(automationId: string, runId: string): string | null {
  const base = getExternalBaseUrl();
  return base ? `${base}/automations/${automationId}/runs/${runId}` : null;
}

export function capText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function renderRunNotificationTitle(input: {
  automationName: string;
  status: "completed" | "failed" | "stopped";
  errorMessage?: string | null;
}): string {
  const quotedName = `"${input.automationName}"`;
  if (input.status === "failed") {
    const reason = capText(
      (input.errorMessage ?? "").trim() || "unknown error",
      NOTIFY_ERROR_MAX_CHARS
    );
    return capText(`Eidon: ${quotedName} failed: ${reason}`, NOTIFY_TITLE_MAX_CHARS);
  }
  if (input.status === "stopped") {
    return capText(`Eidon: ${quotedName} stopped`, NOTIFY_TITLE_MAX_CHARS);
  }
  return capText(`Eidon: ${quotedName} completed`, NOTIFY_TITLE_MAX_CHARS);
}

async function drainResponse(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    return;
  }
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
      await drainResponse(response);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        return response;
      }
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        return null;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export type PushoverCredentials = { userKey: string; appToken: string };

export function getPushoverCredentials(userId: string | null): PushoverCredentials | null {
  if (!userId) {
    return null;
  }
  const row = getDb()
    .prepare(
      "SELECT credentials_encrypted FROM integration_settings WHERE capability = ? AND user_id = ?"
    )
    .get(PUSHOVER_CAPABILITY, userId) as { credentials_encrypted: string } | undefined;

  if (!row?.credentials_encrypted) {
    return null;
  }
  try {
    const parsed = JSON.parse(decryptValue(row.credentials_encrypted)) as {
      userKey?: unknown;
      appToken?: unknown;
    };
    if (
      typeof parsed?.userKey === "string" &&
      parsed.userKey &&
      typeof parsed?.appToken === "string" &&
      parsed.appToken
    ) {
      return { userKey: parsed.userKey, appToken: parsed.appToken };
    }
    return null;
  } catch {
    return null;
  }
}

export function setPushoverCredentials(userId: string, credentials: PushoverCredentials) {
  const userKey = credentials.userKey.trim();
  const appToken = credentials.appToken.trim();
  if (!userKey || !appToken) {
    throw new Error("Pushover user key and app token are required");
  }
  const encrypted = encryptValue(JSON.stringify({ userKey, appToken }));
  const timestamp = nowIso();
  const existing = getDb()
    .prepare("SELECT 1 AS one FROM integration_settings WHERE capability = ? AND user_id = ?")
    .get(PUSHOVER_CAPABILITY, userId);
  if (existing) {
    getDb()
      .prepare(
        `UPDATE integration_settings
         SET credentials_encrypted = ?, updated_at = ?
         WHERE capability = ? AND user_id = ?`
      )
      .run(encrypted, timestamp, PUSHOVER_CAPABILITY, userId);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO integration_settings (
        capability, user_id, provider_id, configuration_json,
        credentials_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, '{}', ?, ?, ?)`
    )
    .run(PUSHOVER_CAPABILITY, userId, PUSHOVER_PROVIDER_ID, encrypted, timestamp, timestamp);
}

export function clearPushoverCredentials(userId: string) {
  getDb()
    .prepare("DELETE FROM integration_settings WHERE capability = ? AND user_id = ?")
    .run(PUSHOVER_CAPABILITY, userId);
}

export function pushoverCredentialsConfigured(userId: string | null): boolean {
  return getPushoverCredentials(userId) !== null;
}

function getAutomationRunSummary(
  runId: string,
  status: "completed" | "failed" | "stopped"
): string | null {
  if (status === "failed") {
    const run = getDb()
      .prepare("SELECT error_message FROM automation_runs WHERE id = ?")
      .get(runId) as { error_message: string | null } | undefined;
    const message = run?.error_message?.trim();
    return message || null;
  }
  if (status !== "completed") {
    return null;
  }
  const row = getDb()
    .prepare(
      `SELECT m.content AS content
       FROM automation_runs r
       JOIN messages m
         ON m.conversation_id = r.conversation_id
        AND m.role = 'assistant'
        AND m.status = 'completed'
       WHERE r.id = ?
         AND r.conversation_id IS NOT NULL
         AND m.rowid = (
           SELECT MAX(m2.rowid)
           FROM messages m2
           WHERE m2.conversation_id = r.conversation_id
             AND m2.role = 'assistant'
             AND m2.status = 'completed'
         )`
    )
    .get(runId) as { content: string } | undefined;
  const content = row?.content?.trim();
  return content || null;
}

type ChannelDelivery = {
  event: AutomationRunDoneEvent;
  automationName: string;
  title: string;
  summary: string | null;
  runUrl: string | null;
  ownerUserId: string | null;
};

function logDeliveryFailure(kind: string, delivery: ChannelDelivery, detail: string) {
  console.warn("[notifications] channel delivery failed", {
    channelKind: kind,
    runId: delivery.event.runId,
    detail
  });
}

async function sendNtfy(channel: Extract<ResolvedNotifyChannel, { kind: "ntfy" }>, delivery: ChannelDelivery) {
  const server = (channel.server ?? DEFAULT_NTFY_SERVER).replace(/\/+$/, "");
  if (!isHttpUrl(server)) {
    logDeliveryFailure(channel.kind, delivery, "invalid server URL");
    return;
  }
  const response = await fetchWithRetry(server, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: channel.topic,
      title: delivery.title,
      message: delivery.summary || delivery.title,
      ...(channel.priority !== undefined ? { priority: channel.priority } : {}),
      ...(delivery.runUrl ? { click: delivery.runUrl } : {})
    })
  });
  if (!response || !response.ok) {
    logDeliveryFailure(channel.kind, delivery, response ? `status ${response.status}` : "network error");
  }
}

async function sendWebhook(
  channel: Extract<ResolvedNotifyChannel, { kind: "webhook" }>,
  delivery: ChannelDelivery
) {
  if (!isHttpUrl(channel.url)) {
    logDeliveryFailure(channel.kind, delivery, "invalid URL");
    return;
  }
  const response = await fetchWithRetry(channel.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(channel.headers ?? {}) },
    body: JSON.stringify({
      kind: delivery.event.kind,
      status: delivery.event.status,
      automationId: delivery.event.automationId,
      automationName: delivery.automationName,
      runId: delivery.event.runId,
      finishedAt: delivery.event.finishedAt,
      title: delivery.title,
      ...(delivery.summary !== null ? { summary: delivery.summary } : {}),
      ...(delivery.runUrl ? { runUrl: delivery.runUrl } : {})
    })
  });
  if (!response || !response.ok) {
    logDeliveryFailure(channel.kind, delivery, response ? `status ${response.status}` : "network error");
  }
}

async function sendPushover(
  channel: Extract<ResolvedNotifyChannel, { kind: "pushover" }>,
  delivery: ChannelDelivery
) {
  const credentials = getPushoverCredentials(delivery.ownerUserId);
  if (!credentials) {
    logDeliveryFailure(channel.kind, delivery, "pushover credentials not configured");
    return;
  }
  const form = new URLSearchParams({
    token: credentials.appToken,
    user: credentials.userKey,
    title: capText(delivery.title, NOTIFY_TITLE_MAX_CHARS),
    message: capText(delivery.summary || delivery.title, PUSHOVER_MESSAGE_MAX_CHARS)
  });
  if (channel.device) {
    form.set("device", channel.device);
  }
  if (channel.priority !== undefined) {
    form.set("priority", String(channel.priority));
  }
  if (delivery.runUrl) {
    form.set("url", delivery.runUrl);
    form.set("url_title", "View run");
  }
  const response = await fetchWithRetry(PUSHOVER_MESSAGES_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (!response || !response.ok) {
    logDeliveryFailure(channel.kind, delivery, response ? `status ${response.status}` : "network error");
  }
}

async function sendPush(delivery: ChannelDelivery) {
  if (!delivery.ownerUserId) {
    logDeliveryFailure("push", delivery, "automation has no owner");
    return;
  }
  await sendWebPush({
    userId: delivery.ownerUserId,
    title: delivery.title,
    body: delivery.summary || "",
    url: delivery.runUrl ?? "/"
  });
}

export async function dispatchRunNotification(event: NotificationEvent): Promise<void> {
  try {
    const automation = getDb()
      .prepare("SELECT name, user_id, notify_config_json FROM automations WHERE id = ?")
      .get(event.automationId) as
      | { name: string; user_id: string | null; notify_config_json: string | null }
      | undefined;

    if (!automation) {
      return;
    }

    const channels = parseNotifyChannels(automation.notify_config_json ?? "{}");
    if (channels.length === 0) {
      return;
    }

    const delivery: ChannelDelivery = {
      event,
      automationName: automation.name,
      title: renderRunNotificationTitle({
        automationName: automation.name,
        status: event.status,
        errorMessage: event.errorMessage
      }),
      summary: null,
      runUrl: buildRunUrl(event.automationId, event.runId),
      ownerUserId: automation.user_id
    };

    if (channels.some((channel) => channel.includeSummary)) {
      const summary = getAutomationRunSummary(event.runId, event.status);
      if (summary) {
        delivery.summary = capText(summary, NOTIFY_SUMMARY_MAX_CHARS);
      }
    }

    await Promise.all(
      channels.map(async (channel) => {
        try {
          if (channel.kind === "ntfy") {
            await sendNtfy(channel, delivery);
          } else if (channel.kind === "webhook") {
            await sendWebhook(channel, delivery);
          } else if (channel.kind === "pushover") {
            await sendPushover(channel, delivery);
          } else if (channel.kind === "push") {
            await sendPush(delivery);
          }
        } catch (error) {
          logDeliveryFailure(channel.kind, delivery, error instanceof Error ? error.name : "unexpected error");
        }
      })
    );
  } catch (error) {
    console.warn("[notifications] dispatch failed", {
      kind: event.kind,
      runId: event.runId,
      detail: error instanceof Error ? error.name : "unexpected error"
    });
  }
}
