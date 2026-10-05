import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

import { GET as getWorkspaceFile } from "@/app/api/bots/[botId]/workspace/file/route";
import { GET as getWorkspace } from "@/app/api/bots/[botId]/workspace/route";
import { resolveBotSandbox, getSharedBotWorkspaceDir } from "@/lib/bot-sandbox";
import { createBot } from "@/lib/bots";
import { createLocalUser } from "@/lib/users";

function fileRequest(botId: string, query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost/api/bots/${botId}/workspace/file?${params.toString()}`);
}

function context(botId: string) {
  return { params: Promise.resolve({ botId }) };
}

async function setupBot(username = "filesowner") {
  const user = await createLocalUser({ username, password: "password-123", role: "user" });
  const bot = createBot({ name: `Analyst ${username}` }, user.id);
  const sandbox = resolveBotSandbox(bot);
  requireUserMock.mockResolvedValue(user);
  return { user, bot, workspaceDir: sandbox.workspaceDir, sharedDir: getSharedBotWorkspaceDir(bot) };
}

describe("bot workspace file route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("requires a signed-in user", async () => {
    requireUserMock.mockResolvedValue(null);
    const response = await getWorkspaceFile(fileRequest("bot-any", { path: "a.txt" }), context("bot-any"));
    expect(response.status).toBe(401);
  });

  it("does not serve another user's bot workspace", async () => {
    const { bot, workspaceDir } = await setupBot();
    fs.writeFileSync(path.join(workspaceDir, "notes.txt"), "private");
    const stranger = await createLocalUser({ username: "stranger", password: "password-123", role: "user" });
    requireUserMock.mockResolvedValue(stranger);

    const response = await getWorkspaceFile(fileRequest(bot.id, { path: "notes.txt" }), context(bot.id));
    expect(response.status).toBe(404);
  });

  it("returns a text preview for text files", async () => {
    const { bot, workspaceDir } = await setupBot();
    fs.mkdirSync(path.join(workspaceDir, "reports"));
    fs.writeFileSync(path.join(workspaceDir, "reports", "june.md"), "# June\r\nRevenue up");

    const response = await getWorkspaceFile(
      fileRequest(bot.id, { path: "reports/june.md", format: "text" }),
      context(bot.id)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      filename: "june.md",
      mimeType: "text/markdown",
      content: "# June\nRevenue up"
    });
  });

  it("refuses a text preview for binary files", async () => {
    const { bot, workspaceDir } = await setupBot();
    fs.writeFileSync(path.join(workspaceDir, "archive.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const response = await getWorkspaceFile(
      fileRequest(bot.id, { path: "archive.zip", format: "text" }),
      context(bot.id)
    );
    expect(response.status).toBe(415);
  });

  it("streams images inline and other files as downloads", async () => {
    const { bot, workspaceDir } = await setupBot();
    fs.writeFileSync(path.join(workspaceDir, "chart.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(workspaceDir, "data.csv"), "a,b\n1,2");

    const image = await getWorkspaceFile(fileRequest(bot.id, { path: "chart.png" }), context(bot.id));
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-disposition")).toBe('inline; filename="chart.png"');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const imageDownload = await getWorkspaceFile(
      fileRequest(bot.id, { path: "chart.png", download: "1" }),
      context(bot.id)
    );
    expect(imageDownload.headers.get("content-disposition")).toBe('attachment; filename="chart.png"');
    await imageDownload.arrayBuffer();

    const csv = await getWorkspaceFile(fileRequest(bot.id, { path: "data.csv" }), context(bot.id));
    expect(csv.headers.get("content-type")).toBe("application/octet-stream");
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="data.csv"');
    expect(csv.headers.get("content-length")).toBe("7");
    expect(csv.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await csv.text()).toBe("a,b\n1,2");
  });

  it("encodes filenames that are not header-safe", async () => {
    const { bot, workspaceDir } = await setupBot();
    const filename = "rapport d'été (final)\".txt";
    fs.writeFileSync(path.join(workspaceDir, filename), "ok");

    const response = await getWorkspaceFile(fileRequest(bot.id, { path: filename }), context(bot.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="rapport_d_t_final_.txt"; filename*=UTF-8''rapport%20d%27%C3%A9t%C3%A9%20%28final%29%22.txt`
    );
    await response.arrayBuffer();
  });

  it("serves the team's shared workspace when asked", async () => {
    const { bot, sharedDir } = await setupBot();
    fs.writeFileSync(path.join(sharedDir, "handoff.txt"), "from another bot");

    const own = await getWorkspaceFile(fileRequest(bot.id, { path: "handoff.txt" }), context(bot.id));
    expect(own.status).toBe(404);

    const shared = await getWorkspaceFile(
      fileRequest(bot.id, { path: "handoff.txt", scope: "shared", format: "text" }),
      context(bot.id)
    );
    expect(shared.status).toBe(200);
    expect((await shared.json()).content).toBe("from another bot");
  });

  it("rejects paths that escape the workspace", async () => {
    const { bot, workspaceDir } = await setupBot();
    fs.writeFileSync(path.join(process.env.EIDON_DATA_DIR!, "secret.txt"), "secret");
    fs.symlinkSync(path.join(process.env.EIDON_DATA_DIR!, "secret.txt"), path.join(workspaceDir, "link.txt"));

    for (const filePath of ["../../../secret.txt", "link.txt", path.join(process.env.EIDON_DATA_DIR!, "secret.txt")]) {
      const response = await getWorkspaceFile(fileRequest(bot.id, { path: filePath }), context(bot.id));
      expect(response.status).toBe(404);
    }
  });

  it("validates the query", async () => {
    const { bot } = await setupBot();
    const missingPath = await getWorkspaceFile(fileRequest(bot.id, {}), context(bot.id));
    expect(missingPath.status).toBe(400);
    const badScope = await getWorkspaceFile(fileRequest(bot.id, { path: "a.txt", scope: "root" }), context(bot.id));
    expect(badScope.status).toBe(400);
  });

  it("lists the bot and shared workspace trees together", async () => {
    const { bot, workspaceDir, sharedDir } = await setupBot();
    fs.writeFileSync(path.join(workspaceDir, "mine.txt"), "mine");
    fs.writeFileSync(path.join(sharedDir, "ours.txt"), "ours");

    const response = await getWorkspace(new Request("http://localhost"), context(bot.id));
    const payload = (await response.json()) as {
      tree: { children: Array<{ name: string }> };
      sharedTree: { name: string; children: Array<{ name: string }> };
    };

    expect(payload.tree.children.map((node) => node.name)).toEqual(["mine.txt"]);
    expect(payload.sharedTree.name).toBe("shared");
    expect(payload.sharedTree.children.map((node) => node.name)).toEqual(["ours.txt"]);
  });
});
