import webpush from "web-push";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { nowIso } from "@/lib/utils";

const VAPID_CAPABILITY = "push_vapid";
const VAPID_PROVIDER_ID = "vapid";
const VAPID_SUBJECT = "mailto:notifications@eidon.local";

export type VapidKeys = { publicKey: string; privateKey: string };

export type PushSubscriptionRecord = {
  id: string;
  userId: string;
  endpoint: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type VapidRow = {
  configuration_json: string;
  credentials_encrypted: string;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  created_at: string;
  last_success_at: string | null;
  last_error_at: string | null;
};

function parseObjectJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getVapidRow(): VapidRow | undefined {
  return getDb()
    .prepare(
      "SELECT configuration_json, credentials_encrypted FROM integration_settings WHERE capability = ? AND user_id IS NULL"
    )
    .get(VAPID_CAPABILITY) as VapidRow | undefined;
}

export function getVapidKeys(): VapidKeys | null {
  const row = getVapidRow();
  if (!row) return null;
  const publicKey = parseObjectJson(row.configuration_json).publicKey;
  if (typeof publicKey !== "string" || !publicKey) return null;
  if (!row.credentials_encrypted) return null;
  try {
    const credentials = parseObjectJson(decryptValue(row.credentials_encrypted));
    if (typeof credentials.privateKey !== "string" || !credentials.privateKey) return null;
    return { publicKey, privateKey: credentials.privateKey };
  } catch {
    return null;
  }
}

export function ensureVapidKeys(): VapidKeys {
  const existing = getVapidKeys();
  if (existing) return existing;
  const generated = webpush.generateVAPIDKeys();
  setVapidKeys(generated);
  return getVapidKeys() ?? generated;
}

export function getVapidPublicKey(): string {
  return ensureVapidKeys().publicKey;
}

export function setVapidKeys(keys: VapidKeys) {
  const publicKey = keys.publicKey.trim();
  const privateKey = keys.privateKey.trim();
  if (!publicKey || !privateKey) {
    throw new Error("VAPID public and private keys are required");
  }
  const encrypted = encryptValue(JSON.stringify({ privateKey }));
  const timestamp = nowIso();
  const existing = getVapidRow();
  if (existing) {
    getDb()
      .prepare(
        `UPDATE integration_settings
         SET configuration_json = ?, credentials_encrypted = ?, updated_at = ?
         WHERE capability = ? AND user_id IS NULL`
      )
      .run(JSON.stringify({ publicKey }), encrypted, timestamp, VAPID_CAPABILITY);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO integration_settings (
        capability, user_id, provider_id, configuration_json,
        credentials_encrypted, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?)`
    )
    .run(
      VAPID_CAPABILITY,
      VAPID_PROVIDER_ID,
      JSON.stringify({ publicKey }),
      encrypted,
      timestamp,
      timestamp
    );
}

export function savePushSubscription(userId: string, input: PushSubscriptionInput) {
  const endpoint = input.endpoint.trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new Error("Push endpoint must use http or https");
  }
  if (!input.keys.p256dh || !input.keys.auth) {
    throw new Error("Push subscription keys are required");
  }
  const timestamp = nowIso();
  const existing = getDb()
    .prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?")
    .get(endpoint) as { id: string } | undefined;

  if (existing) {
    getDb()
      .prepare(
        `UPDATE push_subscriptions
         SET user_id = ?, p256dh = ?, auth = ?, disabled_at = NULL, last_error_at = NULL
         WHERE endpoint = ?`
      )
      .run(userId, input.keys.p256dh, input.keys.auth, endpoint);
    return getPushSubscriptionByEndpoint(userId, endpoint);
  }

  const id = createId("pushsub");
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (
        id, user_id, endpoint, p256dh, auth, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, endpoint, input.keys.p256dh, input.keys.auth, timestamp);
  return getPushSubscriptionByEndpoint(userId, endpoint);
}

function rowToPushSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at
  };
}

export function getPushSubscriptionByEndpoint(userId: string, endpoint: string) {
  const row = getDb()
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .get(userId, endpoint) as PushSubscriptionRow | undefined;
  return row ? rowToPushSubscription(row) : null;
}

export function listPushSubscriptions(userId: string): PushSubscriptionRecord[] {
  return (
    getDb()
      .prepare("SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at ASC")
      .all(userId) as PushSubscriptionRow[]
  ).map(rowToPushSubscription);
}

export function deletePushSubscription(userId: string, endpoint: string) {
  const result = getDb()
    .prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .run(userId, endpoint.trim());
  return result.changes > 0;
}

function purgePushSubscription(subscriptionId: string) {
  getDb().prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subscriptionId);
}

export async function sendWebPush(input: {
  userId: string;
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  const keys = ensureVapidKeys();

  const subscriptions = getDb()
    .prepare(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND disabled_at IS NULL"
    )
    .all(input.userId) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;

  if (subscriptions.length === 0) {
    return;
  }

  const payload = JSON.stringify({ title: input.title, body: input.body, url: input.url ?? "/" });
  const vapidDetails = {
    subject: VAPID_SUBJECT,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey
  };

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload,
          { vapidDetails }
        );
        getDb()
          .prepare("UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?")
          .run(nowIso(), subscription.id);
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? (error as { statusCode?: unknown }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          purgePushSubscription(subscription.id);
          return;
        }
        getDb()
          .prepare("UPDATE push_subscriptions SET last_error_at = ? WHERE id = ?")
          .run(nowIso(), subscription.id);
        console.warn("[push] delivery failed", {
          detail: error instanceof Error ? error.name : "unexpected error"
        });
      }
    })
  );
}
