import {
  resolveConversationReasoningEffort,
  resolveProviderProfileCapabilities
} from "@/lib/provider-profile";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const GLM_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

describe("resolveProviderProfileCapabilities", () => {
  it("offers effort levels instead of a thinking toggle for GLM", () => {
    const profile = createRuntimeProviderProfile({
      model: "glm-5.1",
      providerConfig: {
        apiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
        apiMode: "chat_completions"
      }
    });

    const capabilities = resolveProviderProfileCapabilities(profile);

    expect(capabilities.reasoningControl).toBe("levels");
    expect(capabilities.reasoningEfforts).toEqual(GLM_EFFORTS);
  });

  it("keeps the thinking toggle for binary-thinking chat completions models", () => {
    const deepSeek = createRuntimeProviderProfile({
      model: "deepseek-v4-flash",
      providerConfig: { apiMode: "chat_completions" }
    });
    const mimo = createRuntimeProviderProfile({
      model: "mimo-v2.5",
      providerConfig: { apiMode: "chat_completions" }
    });

    expect(resolveProviderProfileCapabilities(deepSeek).reasoningControl).toBe("toggle");
    expect(resolveProviderProfileCapabilities(mimo).reasoningControl).toBe("toggle");
  });

  it("offers effort levels for anthropic profiles", () => {
    const profile = createRuntimeProviderProfile({
      providerKind: "anthropic",
      model: "claude-opus-4-8"
    });

    const capabilities = resolveProviderProfileCapabilities(profile);

    expect(capabilities.reasoningControl).toBe("levels");
    expect(capabilities.reasoningEfforts).toContain("high");
  });

  it("still adds max reasoning on the official OpenAI endpoint with gpt-5.6", () => {
    const profile = createRuntimeProviderProfile({
      model: "gpt-5.6-luna",
      providerConfig: {
        apiBaseUrl: "https://api.openai.com/v1",
        apiMode: "responses"
      }
    });

    expect(resolveProviderProfileCapabilities(profile).reasoningEfforts).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]);
  });

  it("falls back to the profile effort when a stored conversation effort is unsupported", () => {
    const profile = createRuntimeProviderProfile({
      model: "glm-5.1",
      reasoningEffort: "medium",
      providerConfig: {
        apiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
        apiMode: "chat_completions"
      }
    });

    expect(resolveConversationReasoningEffort("none", profile)).toBe("medium");
    expect(resolveConversationReasoningEffort("high", profile)).toBe("high");
  });
});
