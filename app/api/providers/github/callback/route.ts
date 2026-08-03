import { handleGithubProviderConnectionCallback } from "@/lib/provider-adapters/github-provider-connection";

export async function GET(request: Request) {
  return handleGithubProviderConnectionCallback(request);
}
