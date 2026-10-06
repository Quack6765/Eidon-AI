import { beforeEach, describe, expect, it, vi } from "vitest";

const agentOptions = vi.fn();
const undiciFetch = vi.fn(async () => new Response("ok"));

vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) {
      agentOptions(options);
    }
  },
  fetch: undiciFetch
}));

describe("provider http", () => {
  beforeEach(() => {
    undiciFetch.mockClear();
  });

  it("keeps provider connections alive for 60 seconds", async () => {
    await import("@/lib/provider-http");

    expect(agentOptions).toHaveBeenCalledWith({ keepAliveTimeout: 60_000 });
  });

  it("sends every request through the shared dispatcher", async () => {
    const { providerHttpOptions } = await import("@/lib/provider-http");

    await providerHttpOptions.fetch("https://provider.test/a", { method: "POST" });
    await providerHttpOptions.fetch("https://provider.test/b");

    const [first, second] = undiciFetch.mock.calls as unknown as Array<[string, { method?: string; dispatcher: unknown }]>;
    expect(first[1].method).toBe("POST");
    expect(second[1].dispatcher).toBe(first[1].dispatcher);
    expect(agentOptions).toHaveBeenCalledTimes(1);
  });
});
