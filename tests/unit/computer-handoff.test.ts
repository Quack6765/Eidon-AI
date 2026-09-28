import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  conversationBrowserTarget,
  getComputerControl,
  getComputerHandoff,
  resetAgentComputerRelayForTests
} from "@/lib/agent-computer-relay";
import {
  COMPUTER_HANDOFF_TIMEOUT_MS,
  requestComputerHandoff,
  returnComputerControl,
  takeComputerControl
} from "@/lib/computer-handoff";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { executeShellCommand, executeToolCall, type RuntimeAction } from "@/lib/tool-executors";
import { settleUserGate, waitForUserGate } from "@/lib/user-gate";
import { rememberSecretForRedaction, resetSecretRedactionForTests } from "@/lib/secret-redaction";
import { declineComputerSecret } from "@/lib/computer-secrets";
import { setUserAllowAllTools } from "@/lib/user-preferences";
import { createLocalUser } from "@/lib/users";
import type { ComputerHandoffProposalPayload, PromptMessage } from "@/lib/types";

const localShellMocks = vi.hoisted(() => ({ executeLocalShellCommand: vi.fn() }));

vi.mock("@/lib/local-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-shell")>();
  return { ...actual, executeLocalShellCommand: localShellMocks.executeLocalShellCommand };
});

async function fixture(username: string) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });
  const { socketDir, sessionName } = conversationBrowserTarget(conversation.id);
  mkdirSync(socketDir, { recursive: true });
  writeFileSync(join(socketDir, `${sessionName}.stream`), "45123");
  const started: string[] = [];
  const onActionStart = vi.fn(async (action: RuntimeAction) => {
    const persisted = createMessageAction({ messageId: message.id, ...action });
    started.push(persisted.id);
    return persisted.id;
  });
  return { user, conversation, message, onActionStart, started };
}

function readCard(actionId: string) {
  const row = getDb()
    .prepare("SELECT status, proposal_state, proposal_payload_json, result_summary FROM message_actions WHERE id = ?")
    .get(actionId) as { status: string; proposal_state: string; proposal_payload_json: string; result_summary: string };
  return { ...row, payload: JSON.parse(row.proposal_payload_json) as ComputerHandoffProposalPayload };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("user gate", () => {
  it("resolves with the settled value, and reports gates that no longer wait", async () => {
    const waiting = waitForUserGate<string>("act_gate_settle", {
      timeoutMs: 60_000,
      readRecorded: () => null,
      onExpire: () => "expired",
      onStop: () => "stopped"
    });

    expect(settleUserGate("act_gate_settle", "returned")).toBe(true);
    await expect(waiting).resolves.toBe("returned");
    expect(settleUserGate("act_gate_settle", "again")).toBe(false);
  });

  it("expires after its timeout and stops when the run is aborted", async () => {
    vi.useFakeTimers();
    try {
      const expiring = waitForUserGate<string>("act_gate_expire", {
        timeoutMs: 1_000,
        readRecorded: () => null,
        onExpire: () => "expired",
        onStop: () => "stopped"
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(expiring).resolves.toBe("expired");
    } finally {
      vi.useRealTimers();
    }

    const controller = new AbortController();
    const stopping = waitForUserGate<string>("act_gate_stop", {
      timeoutMs: 60_000,
      abortSignal: controller.signal,
      readRecorded: () => null,
      onExpire: () => "expired",
      onStop: () => "stopped"
    });
    controller.abort();
    await expect(stopping).resolves.toBe("stopped");
  });

  it("adopts an answer already recorded, even when the run was stopped first", async () => {
    await expect(
      waitForUserGate<string>("act_gate_recorded", {
        timeoutMs: 60_000,
        readRecorded: () => "recorded",
        onExpire: () => "expired",
        onStop: () => "stopped"
      })
    ).resolves.toBe("recorded");

    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForUserGate<string>("act_gate_aborted", {
        timeoutMs: 60_000,
        abortSignal: controller.signal,
        readRecorded: () => null,
        onExpire: () => "expired",
        onStop: () => "stopped"
      })
    ).resolves.toBe("stopped");
  });
});

describe("computer hand-off", () => {
  beforeEach(() => {
    resetAgentComputerRelayForTests();
    localShellMocks.executeLocalShellCommand.mockReset();
  });

  it("pauses the bot until the user returns control, then passes on their note", async () => {
    const { conversation, onActionStart, started } = await fixture("handoff-return");
    const target = conversationBrowserTarget(conversation.id);
    const onWaitChange = vi.fn();

    const result = requestComputerHandoff({
      conversationId: conversation.id,
      reason: "Enter the two-factor code for GitHub",
      onActionStart,
      onWaitChange
    });
    await flush();

    const actionId = started[0];
    expect(readCard(actionId)).toMatchObject({
      status: "pending",
      proposal_state: "pending",
      payload: { operation: "computer_handoff", reason: "Enter the two-factor code for GitHub" }
    });
    expect(getComputerControl(target)).toBe("user");
    expect(getComputerHandoff(target)).toBe(actionId);
    expect(onWaitChange).toHaveBeenCalledWith(true);

    returnComputerControl(conversation.id, "  Signed in, the code was 2FA by SMS  ");

    await expect(result).resolves.toBe(
      "The user completed the step in the browser and returned control. Continue from the page as they left it. Their note: Signed in, the code was 2FA by SMS"
    );
    expect(readCard(actionId)).toMatchObject({
      status: "completed",
      proposal_state: "approved",
      result_summary: "You returned control",
      payload: { resolution: "returned", note: "Signed in, the code was 2FA by SMS" }
    });
    expect(getComputerControl(target)).toBe("bot");
    expect(getComputerHandoff(target)).toBeNull();
    expect(onWaitChange).toHaveBeenLastCalledWith(false);
  });

  it("gives up after 30 minutes and when the run is stopped", async () => {
    const expiring = await fixture("handoff-expire");
    vi.useFakeTimers();
    try {
      const result = requestComputerHandoff({
        conversationId: expiring.conversation.id,
        reason: "Solve the CAPTCHA",
        onActionStart: expiring.onActionStart
      });
      await vi.advanceTimersByTimeAsync(COMPUTER_HANDOFF_TIMEOUT_MS);
      await expect(result).resolves.toContain("Nobody took over the browser within 30 minutes");
    } finally {
      vi.useRealTimers();
    }
    expect(readCard(expiring.started[0])).toMatchObject({
      proposal_state: "dismissed",
      result_summary: "Nobody took over within 30 minutes",
      payload: { resolution: "expired" }
    });

    const stopping = await fixture("handoff-stop");
    const controller = new AbortController();
    const stopped = requestComputerHandoff({
      conversationId: stopping.conversation.id,
      reason: "Confirm the payment",
      abortSignal: controller.signal,
      onActionStart: stopping.onActionStart
    });
    await flush();
    controller.abort();
    await expect(stopped).resolves.toContain("stopped before the user returned control");
    expect(readCard(stopping.started[0]).payload.resolution).toBe("stopped");
    expect(getComputerControl(conversationBrowserTarget(stopping.conversation.id))).toBe("bot");
  });

  it("says so when the conversation cannot show a hand-off card or the browser is not open", async () => {
    await expect(requestComputerHandoff({ reason: "Sign in" })).resolves.toContain("can't be handed to the user");

    const { conversation, onActionStart } = await fixture("handoff-closed");
    const { socketDir, sessionName } = conversationBrowserTarget(conversation.id);
    rmSync(join(socketDir, `${sessionName}.stream`));
    await expect(
      requestComputerHandoff({ conversationId: conversation.id, reason: "Sign in", onActionStart })
    ).resolves.toContain("Your browser is not open yet");
    expect(onActionStart).not.toHaveBeenCalled();
  });

  it("lets the user take and return control without a pending hand-off", async () => {
    const { conversation } = await fixture("handoff-manual");
    const target = conversationBrowserTarget(conversation.id);

    takeComputerControl(conversation.id);
    expect(getComputerControl(target)).toBe("user");
    returnComputerControl(conversation.id, "ignored");
    expect(getComputerControl(target)).toBe("bot");
  });

  it("refuses browser commands while the user has control and runs request_takeover as a tool", async () => {
    const { user, conversation, onActionStart, started } = await fixture("handoff-tools");
    takeComputerControl(conversation.id);
    const context = {
      input: {
        conversationId: conversation.id,
        onActionStart,
        toolApproval: { userId: user.id, unattended: false },
        skills: [],
        mcpToolSets: []
      },
      mcpServers: [],
      loadedSkillIds: new Set<string>(),
      successfulReadOnlyToolResults: new Map(),
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    };

    const refused = await executeShellCommand("call_browser", { command: "agent-browser open https://example.com" }, context);
    expect(localShellMocks.executeLocalShellCommand).not.toHaveBeenCalled();
    expect(JSON.stringify(refused.promptMessages.at(-1))).toContain("The user has control of the browser right now");
    expect(started).toHaveLength(0);

    const takeover = executeToolCall(
      { id: "call_takeover", name: "request_takeover", arguments: JSON.stringify({ reason: "  Type the SMS code  " }) },
      context
    );
    await flush();
    expect(readCard(started[0]).payload.reason).toBe("Type the SMS code");
    returnComputerControl(conversation.id);

    const result = await takeover;
    expect(result.nextSortOrder).toBe(1);
    expect(JSON.stringify(result.promptMessages.at(-1))).toContain("returned control");
  });

  it("asks for a secret as a tool and hides a filled secret from later tool results", async () => {
    const { user, conversation, onActionStart, started } = await fixture("secret-tools");
    resetSecretRedactionForTests();
    const onActionComplete = vi.fn();
    const context = {
      input: {
        conversationId: conversation.id,
        onActionStart,
        onActionComplete,
        toolApproval: { userId: user.id, unattended: false },
        skills: [],
        mcpToolSets: []
      },
      mcpServers: [],
      loadedSkillIds: new Set<string>(),
      successfulReadOnlyToolResults: new Map(),
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    };

    const asked = executeToolCall(
      { id: "call_secret", name: "request_secret", arguments: JSON.stringify({ label: "password", origin: "https://example.com/login", target: "#pw", replace_saved: true }) },
      context
    );
    await flush();
    const card = getDb().prepare("SELECT proposal_payload_json FROM message_actions WHERE id = ?").get(started[0]) as { proposal_payload_json: string };
    expect(JSON.parse(card.proposal_payload_json)).toMatchObject({ origin: "https://example.com", target: "#pw", save: true });
    declineComputerSecret(started[0], user.id);
    expect(JSON.stringify((await asked).promptMessages.at(-1))).toContain("declined");

    rememberSecretForRedaction(conversation.id, "correct-horse-battery");
    setUserAllowAllTools(user.id, true);
    localShellMocks.executeLocalShellCommand.mockResolvedValueOnce({
      stdout: "value is correct-horse-battery",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      isError: false
    });
    const shell = await executeShellCommand("call_eval", { command: "agent-browser get value '#pw'" }, context);

    expect(JSON.stringify(shell.promptMessages)).not.toContain("correct-horse-battery");
    expect(JSON.stringify(shell.promptMessages)).toContain("[hidden secret]");
    expect(JSON.stringify(onActionComplete.mock.calls)).not.toContain("correct-horse-battery");
  });
});
