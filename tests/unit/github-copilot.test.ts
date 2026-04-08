import { encryptValue } from "@/lib/crypto";
import {
  clearGithubCopilotConnection,
  getGithubConnectionStatus,
  shouldRefreshGithubToken
} from "@/lib/github-copilot";

describe("github copilot helpers", () => {
  it("detects when a token should be refreshed", () => {
    expect(
      shouldRefreshGithubToken({
        githubTokenExpiresAt: new Date(Date.now() + 30_000).toISOString()
      })
    ).toBe(true);

    expect(
      shouldRefreshGithubToken({
        githubTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      })
    ).toBe(false);
  });

  it("computes connection state from stored credentials", () => {
    expect(
      getGithubConnectionStatus({
        providerKind: "github_copilot",
        githubUserAccessTokenEncrypted: "",
        githubTokenExpiresAt: null
      })
    ).toBe("disconnected");

    expect(
      getGithubConnectionStatus({
        providerKind: "github_copilot",
        githubUserAccessTokenEncrypted: encryptValue("ghu_123"),
        githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString()
      })
    ).toBe("connected");
  });

  it("clears only github oauth fields when disconnecting", () => {
    expect(
      clearGithubCopilotConnection({
        githubUserAccessTokenEncrypted: "ciphertext-access",
        githubRefreshTokenEncrypted: "ciphertext-refresh",
        githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
        githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
        githubAccountLogin: "octocat",
        githubAccountName: "The Octocat"
      })
    ).toEqual({
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    });
  });
});
