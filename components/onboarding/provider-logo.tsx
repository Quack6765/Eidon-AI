import Image from "next/image";

import type { ProviderKind, ProviderPresetId } from "@/lib/provider-catalog";

export const PROVIDER_LOGO_PATHS: Record<ProviderPresetId, string> = {
  ollama_cloud: "/logos/ollama.svg",
  glm_coding_plan: "/logos/zai.svg",
  openrouter: "/logos/openrouter.svg",
  opencode_go: "/logos/opencode.svg",
  deepseek: "/logos/deepseek.svg",
  xiaomi_mimo: "/logos/xiaomi.svg",
  openai_official: "/logos/openai.svg",
  anthropic_official: "/logos/anthropic.svg",
  opencode_go_anthropic: "/logos/opencode.svg"
};

export const OAUTH_PROVIDER_LOGO_PATHS: Partial<Record<ProviderKind, string>> = {
  github_copilot: "/logos/githubcopilot.svg"
};

function LogoImage({ src }: { src: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={16}
      height={16}
      aria-hidden="true"
      unoptimized
      className="h-4 w-4"
    />
  );
}

export function ProviderLogo({ presetId }: { presetId: ProviderPresetId }) {
  return <LogoImage src={PROVIDER_LOGO_PATHS[presetId]} />;
}

export function OAuthProviderLogo({ providerKind }: { providerKind: ProviderKind }) {
  const src = OAUTH_PROVIDER_LOGO_PATHS[providerKind];
  return src ? <LogoImage src={src} /> : null;
}
