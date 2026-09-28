"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bell, Trash2 } from "lucide-react";

import { Badge } from "@/components/settings/badge";
import { DetailHeader } from "@/components/settings/detail-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import { isChatPingEnabled, setChatPingEnabled as persistChatPingEnabled } from "@/lib/chat-turn-ping";
import { fieldLabel, sectionTitle } from "@/lib/settings-styles";
import { useToastState } from "@/hooks/use-toast-state";

type PushSubscriptionSummary = {
  id: string;
  endpoint: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
};

const PUSH_SERVICE_HOST_SUFFIXES = ["googleapis.com", "push.apple.com", "mozilla.com"];

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}

function describePushEndpoint(endpoint: string): string {
  try {
    const hostname = new URL(endpoint).hostname;
    const knownService = PUSH_SERVICE_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
    return knownService ? "This browser" : hostname;
  } catch {
    return endpoint;
  }
}

function formatCreatedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

async function detectLocalPushEndpoint(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return null;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      return null;
    }
    const subscription = await registration.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

export function NotificationsSection() {
  const toast = useToastState();
  const [isLoading, setIsLoading] = useState(true);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionSummary[]>([]);
  const [pushoverConfigured, setPushoverConfigured] = useState(false);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [pushoverUserKey, setPushoverUserKey] = useState("");
  const [pushoverAppToken, setPushoverAppToken] = useState("");
  const [isPushoverEditing, setIsPushoverEditing] = useState(false);
  const [chatPingOn, setChatPingOn] = useState(true);
  const [localPushEndpoint, setLocalPushEndpoint] = useState<string | null>(null);

  useEffect(() => {
    setChatPingOn(isChatPingEnabled(window.localStorage));
  }, []);

  useEffect(() => {
    void detectLocalPushEndpoint().then(setLocalPushEndpoint);
  }, []);

  useEffect(() => {
    async function loadNotificationSettings() {
      setIsLoading(true);
      try {
        const [vapidResponse, subscriptionsResponse, pushoverResponse] = await Promise.all([
          fetch("/api/push/vapid"),
          fetch("/api/push/subscribe"),
          fetch("/api/pushover")
        ]);

        if (vapidResponse.ok) {
          const payload = (await vapidResponse.json()) as { publicKey?: string | null };
          setVapidPublicKey(
            typeof payload.publicKey === "string" && payload.publicKey ? payload.publicKey : null
          );
        }
        if (subscriptionsResponse.ok) {
          const payload = (await subscriptionsResponse.json()) as {
            subscriptions?: PushSubscriptionSummary[];
          };
          setSubscriptions(Array.isArray(payload.subscriptions) ? payload.subscriptions : []);
        }
        if (pushoverResponse.ok) {
          const payload = (await pushoverResponse.json()) as { configured?: boolean };
          setPushoverConfigured(Boolean(payload.configured));
        }
      } finally {
        setIsLoading(false);
      }
    }

    void loadNotificationSettings();
  }, []);

  async function refreshSubscriptions() {
    const response = await fetch("/api/push/subscribe");
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { subscriptions?: PushSubscriptionSummary[] };
    setSubscriptions(Array.isArray(payload.subscriptions) ? payload.subscriptions : []);
  }

  async function enablePush() {
    setPushMessage("");
    setIsEnablingPush(true);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushMessage(
          "Notification permission was denied. Allow notifications for Eidon in your browser settings and try again."
        );
        return;
      }

      if (!vapidPublicKey) {
        setPushMessage("Push configuration could not be loaded. Reload the page and try again.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) {
        throw new Error("Push subscription keys are missing");
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth }
        })
      });

      if (!response.ok) {
        throw new Error("Unable to save push subscription");
      }

      await refreshSubscriptions();
      setLocalPushEndpoint(subscription.endpoint);
      toast.showToast("success", "Push notifications enabled for this browser.");
    } catch {
      setPushMessage("Unable to enable push notifications on this browser.");
    } finally {
      setIsEnablingPush(false);
    }
  }

  async function removeSubscription(subscription: PushSubscriptionSummary) {
    const response = await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });

    if (!response.ok) {
      toast.showToast("error", "Unable to remove subscription");
      return;
    }

    await refreshSubscriptions();
    toast.showToast("success", "Subscription removed.");
  }

  async function savePushover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userKey = pushoverUserKey.trim();
    const appToken = pushoverAppToken.trim();

    if (!userKey || !appToken) {
      toast.showToast("error", "Pushover user key and app token are required");
      return;
    }

    const response = await fetch("/api/pushover", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userKey, appToken })
    });

    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: string };
      toast.showToast("error", failure.error ?? "Unable to save Pushover keys");
      return;
    }

    setPushoverUserKey("");
    setPushoverAppToken("");
    setIsPushoverEditing(false);
    setPushoverConfigured(true);
    toast.showToast("success", "Pushover connected.");
  }

  async function removePushover() {
    const response = await fetch("/api/pushover", { method: "DELETE" });

    if (!response.ok) {
      toast.showToast("error", "Unable to remove Pushover keys");
      return;
    }

    setIsPushoverEditing(false);
    setPushoverConfigured(false);
    toast.showToast("success", "Pushover keys removed.");
  }

  function toggleChatPing(enabled: boolean) {
    persistChatPingEnabled(window.localStorage, enabled);
    setChatPingOn(enabled);
  }

  const showPushoverForm = !pushoverConfigured || isPushoverEditing;
  const isPushEnabled =
    localPushEndpoint !== null &&
    subscriptions.some((subscription) => subscription.endpoint === localPushEndpoint);

  return (
    <div className="h-full w-full max-w-[760px] space-y-6 overflow-y-auto px-5 py-6 sm:px-7 md:px-9 md:py-8">
      <div className="space-y-6">
        <DetailHeader
          title="Notifications"
          summary="Choose how Eidon reaches you when automation runs finish and replies complete."
          badge={
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300">
              <Bell className="h-4 w-4" />
            </div>
          }
        />

        {isLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading notification settings...</p>
        ) : (
          <>
            <section className="space-y-4">
              <div className="space-y-1">
                <h4 className={sectionTitle}>Web push</h4>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  Get an OS notification on this browser when one of your automation runs completes, fails, or stops.
                </p>
              </div>

              {isPushEnabled ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge variant="default">Enabled</Badge>
                    <p className="truncate text-xs text-[var(--muted)]">
                      This browser receives OS notifications for your automation runs.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 px-5 text-sm md:min-h-10"
                    onClick={() => void enablePush()}
                    disabled={isEnablingPush}
                  >
                    Enable push on this browser
                  </Button>
                  {pushMessage ? <p className="text-xs leading-5 text-red-300/90">{pushMessage}</p> : null}
                </div>
              )}

              {subscriptions.length ? (
                <div className="space-y-2">
                  <label className={fieldLabel}>Subscribed browsers</label>
                  {subscriptions.map((subscription) => (
                    <div
                      key={subscription.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-[var(--text)]">
                          {describePushEndpoint(subscription.endpoint)}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          Added {formatCreatedDate(subscription.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeSubscription(subscription)}
                        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 md:min-h-10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="space-y-4 border-t border-white/[0.06] pt-6">
              <div className="space-y-1">
                <h4 className={sectionTitle}>Pushover</h4>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  Personal Pushover keys used to deliver automation alerts to your devices.
                </p>
              </div>

              {showPushoverForm ? (
                <form onSubmit={(event) => void savePushover(event)} className="space-y-3">
                  <div>
                    <label htmlFor="pushover-user-key" className={fieldLabel}>
                      User key
                    </label>
                    <Input
                      id="pushover-user-key"
                      type="password"
                      value={pushoverUserKey}
                      onChange={(event) => setPushoverUserKey(event.target.value)}
                      placeholder="Your Pushover user key"
                    />
                  </div>
                  <div>
                    <label htmlFor="pushover-app-token" className={fieldLabel}>
                      App/API token
                    </label>
                    <Input
                      id="pushover-app-token"
                      type="password"
                      value={pushoverAppToken}
                      onChange={(event) => setPushoverAppToken(event.target.value)}
                      placeholder="Token for your Eidon application"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="lg" className="min-h-11 px-5 text-sm md:min-h-10">
                      Save
                    </Button>
                    {isPushoverEditing ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        className="min-h-11 px-4 text-sm md:min-h-10"
                        onClick={() => {
                          setIsPushoverEditing(false);
                          setPushoverUserKey("");
                          setPushoverAppToken("");
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge variant="default">Configured</Badge>
                    <p className="truncate text-xs text-[var(--muted)]">
                      Automation alerts are delivered through Pushover.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => setIsPushoverEditing(true)}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-[var(--muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text)] md:min-h-10"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => void removePushover()}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-red-400/80 transition-colors hover:bg-red-500/[0.06] hover:text-red-300 md:min-h-10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs leading-5 text-[var(--muted)]">
                Find your user key on your{" "}
                <a
                  href="https://pushover.net/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  Pushover dashboard
                </a>{" "}
                and create an application token under{" "}
                <a
                  href="https://pushover.net/apps/build"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  Apps &amp; Plugins
                </a>
                .
              </p>
            </section>

            <section className="space-y-4 border-t border-white/[0.06] pt-6">
              <div className="space-y-1">
                <h4 className={sectionTitle}>Chat completion ping</h4>
              </div>
              <label
                htmlFor="chat-ping-enabled"
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-sm text-[var(--text)] sm:max-w-md"
              >
                <input
                  id="chat-ping-enabled"
                  type="checkbox"
                  checked={chatPingOn}
                  onChange={(event) => toggleChatPing(event.target.checked)}
                />
                <span className="flex flex-col gap-1">
                  <span className="font-medium">Notify me when a reply finishes while Eidon is in a background tab</span>
                  <span className="text-xs leading-5 text-[var(--muted)]">
                    Requires notification permission. Only fires while this tab is hidden.
                  </span>
                </span>
              </label>
            </section>
          </>
        )}
      </div>

      <Toast visible={toast.visible} variant={toast.variant} message={toast.message} />
    </div>
  );
}
