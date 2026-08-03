import {
  getProviderAdapter,
  getProviderConnectionMode,
  getProviderReadinessError
} from "@/lib/provider-adapters";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

describe("provider adapters", () => {
  it("reports readiness through the same contract for every provider kind", () => {
    const apiKeyKinds = ["openai_compatible", "anthropic"] as const;
    for (const providerKind of apiKeyKinds) {
      expect(getProviderReadinessError(createRuntimeProviderProfile({
        providerKind,
        credentials: {}
      }))).toContain("API key");
      expect(getProviderReadinessError(createRuntimeProviderProfile({
        providerKind,
        credentials: { apiKey: "secret" }
      }))).toBeNull();
    }

    expect(getProviderReadinessError(createRuntimeProviderProfile({
      providerKind: "github_copilot",
      credentials: {}
    }))).toContain("Connect an account");
    expect(getProviderReadinessError(createRuntimeProviderProfile({
      providerKind: "github_copilot",
      credentials: { accessToken: "token" }
    }))).toBeNull();
  });

  it("exposes retry and connection behavior from the provider boundary", () => {
    expect(getProviderAdapter("openai_compatible").supportsStreamRetry).toBe(true);
    expect(getProviderAdapter("anthropic").supportsStreamRetry).toBe(true);
    expect(getProviderAdapter("github_copilot").supportsStreamRetry).toBe(false);
    expect(getProviderAdapter("openai_compatible").connectionFlows).toBeUndefined();
    expect(getProviderAdapter("github_copilot").connectionFlows).toBeDefined();
    expect(getProviderConnectionMode("openai_compatible")).toBe("api_key");
    expect(getProviderConnectionMode("anthropic")).toBe("api_key");
    expect(getProviderConnectionMode("github_copilot")).toBe("oauth");
  });
});
