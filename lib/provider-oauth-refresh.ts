import {
  getRuntimeProviderProfile,
  updateProviderConnectionIfRefreshTokenMatches
} from "@/lib/provider-profiles";
import type { RuntimeProviderProfile } from "@/lib/types";

export type OAuthTokenRefresh = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  refreshExpiresAt?: string | null;
};

type RefreshEntry = {
  refreshTokenVersion: string;
  promise: Promise<RuntimeProviderProfile>;
};

const REFRESH_REGISTRY_KEY = Symbol.for("eidon:provider-oauth-refreshes");

function getRefreshes() {
  const runtime = globalThis as Record<symbol, Map<string, RefreshEntry> | undefined>;
  let registry = runtime[REFRESH_REGISTRY_KEY];
  if (!registry) {
    registry = new Map<string, RefreshEntry>();
    runtime[REFRESH_REGISTRY_KEY] = registry;
  }
  return registry;
}

export function createAbortError(label: string) {
  const error = new Error(`${label} operation aborted`);
  error.name = "AbortError";
  return error;
}

export async function withAbort<T>(
  operation: Promise<T>,
  label: string,
  signal?: AbortSignal,
  onAbort?: () => void
): Promise<T> {
  if (!signal) {
    return operation;
  }

  if (signal.aborted) {
    onAbort?.();
    throw createAbortError(label);
  }

  return await new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      onAbort?.();
      reject(createAbortError(label));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

function withStoredConnection(profile: RuntimeProviderProfile): RuntimeProviderProfile {
  const stored = getRuntimeProviderProfile(profile.id);
  if (!stored || stored.providerKind !== profile.providerKind) return profile;
  return {
    ...profile,
    credentials: stored.credentials,
    connectionMetadata: stored.connectionMetadata
  };
}

export async function ensureFreshOAuthAccessToken(
  profile: RuntimeProviderProfile,
  options: {
    label: string;
    shouldRefresh(profile: RuntimeProviderProfile): boolean;
    refresh(profile: RuntimeProviderProfile): Promise<OAuthTokenRefresh>;
  },
  abortSignal?: AbortSignal
): Promise<RuntimeProviderProfile> {
  if (abortSignal?.aborted) {
    throw createAbortError(options.label);
  }

  if (!options.shouldRefresh(profile)) {
    return profile;
  }

  const current = withStoredConnection(profile);
  if (!options.shouldRefresh(current)) {
    return current;
  }

  const refreshes = getRefreshes();
  const refreshToken = current.credentials.refreshToken ?? "";
  const existingRefresh = refreshes.get(current.id);
  if (existingRefresh?.refreshTokenVersion === refreshToken) {
    return withAbort(existingRefresh.promise, options.label, abortSignal);
  }

  const refresh = (async () => {
    const refreshed = await options.refresh(current);
    const credentials = {
      ...current.credentials,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken
    };
    const connectionMetadata = {
      ...current.connectionMetadata,
      expiresAt: refreshed.expiresAt,
      ...(refreshed.refreshExpiresAt !== undefined
        ? { refreshExpiresAt: refreshed.refreshExpiresAt }
        : {})
    };

    const persisted = updateProviderConnectionIfRefreshTokenMatches(
      current.id,
      refreshToken,
      { credentials, metadata: connectionMetadata }
    );
    if (!persisted) {
      throw new Error(`${options.label} connection changed during token refresh`);
    }

    return { ...current, credentials, connectionMetadata };
  })();

  const entry = { refreshTokenVersion: refreshToken, promise: refresh };
  refreshes.set(current.id, entry);
  const clearRefresh = () => {
    if (refreshes.get(current.id) === entry) refreshes.delete(current.id);
  };
  void refresh.then(clearRefresh, clearRefresh);
  return await withAbort(refresh, options.label, abortSignal);
}
