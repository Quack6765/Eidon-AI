const CHAT_PING_STORAGE_KEY = "eidon.notifications.chatPing";

export const CHAT_PING_TITLE = "Eidon";
export const CHAT_PING_BODY = "Reply ready";

export function isChatPingEnabled(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    const raw = storage?.getItem(CHAT_PING_STORAGE_KEY);
    return raw === null || raw === undefined ? true : raw !== "false";
  } catch {
    return true;
  }
}

export function setChatPingEnabled(storage: Pick<Storage, "setItem"> | null, enabled: boolean) {
  try {
    storage?.setItem(CHAT_PING_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    return;
  }
}

export function shouldNotifyTurnReady(input: {
  visibilityState?: string;
  permission?: string;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.visibilityState === "hidden" &&
    input.permission === "granted"
  );
}

async function showTurnReadyNotification(): Promise<void> {
  const serviceWorker =
    typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  const registration = serviceWorker ? await serviceWorker.ready : null;
  if (registration) {
    await registration.showNotification(CHAT_PING_TITLE, {
      body: CHAT_PING_BODY,
      icon: "/icon-192.png",
      tag: "eidon-chat-turn"
    });
    return;
  }
  if (typeof Notification !== "undefined") {
    new Notification(CHAT_PING_TITLE, { body: CHAT_PING_BODY });
  }
}

export async function maybeNotifyTurnReady(): Promise<void> {
  try {
    if (typeof document === "undefined") {
      return;
    }
    const enabled = isChatPingEnabled(
      typeof localStorage !== "undefined" ? localStorage : null
    );
    const permission = typeof Notification !== "undefined" ? Notification.permission : "default";
    if (
      !shouldNotifyTurnReady({
        visibilityState: document.visibilityState,
        permission,
        enabled
      })
    ) {
      return;
    }
    await showTurnReadyNotification();
  } catch {
    return;
  }
}
