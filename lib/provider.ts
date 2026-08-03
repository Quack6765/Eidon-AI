import { getProviderAdapter } from "@/lib/provider-adapters";
import type {
  ProviderStreamInput,
  ProviderStreamResult,
  ProviderTextInput
} from "@/lib/provider-adapters/types";
import type { ChatStreamEvent } from "@/lib/types";

export async function callProviderText(input: ProviderTextInput) {
  return getProviderAdapter(input.settings.providerKind).callText(input);
}

export async function* streamProviderResponse(
  input: ProviderStreamInput
): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  return yield* getProviderAdapter(input.settings.providerKind).stream(input);
}
