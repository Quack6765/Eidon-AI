import { Agent, fetch as undiciFetch } from "undici";

export const PROVIDER_KEEP_ALIVE_TIMEOUT_MS = 60_000;

const dispatcher = new Agent({ keepAliveTimeout: PROVIDER_KEEP_ALIVE_TIMEOUT_MS });

export const providerHttpOptions = {
  fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as never, { ...init, dispatcher } as never)) as unknown as typeof fetch
};
