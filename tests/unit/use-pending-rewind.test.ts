// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REWIND_UNDO_WINDOW_MS, usePendingRewind } from "@/hooks/use-pending-rewind";
import type { Message, MessageAttachment } from "@/lib/types";

function message(id: string, role: Message["role"], content: string, attachments: MessageAttachment[] = []): Message {
  return {
    id,
    conversationId: "conv_1",
    role,
    content,
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 1,
    systemKind: null,
    compactedAt: null,
    createdAt: "2026-09-25T10:00:00.000Z",
    attachments
  };
}

const attachment: MessageAttachment = {
  id: "att_1",
  conversationId: "conv_1",
  messageId: "msg_u2",
  filename: "brief.txt",
  mimeType: "text/plain",
  byteSize: 5,
  sha256: "hash",
  relativePath: "conv_1/att_1_brief.txt",
  kind: "text",
  extractedText: "brief",
  createdAt: "2026-09-25T10:00:00.000Z"
};

const thread = [
  message("msg_u1", "user", "First question"),
  message("msg_a1", "assistant", "First answer"),
  message("msg_u2", "user", "Second question", [attachment]),
  message("msg_a2", "assistant", "Second answer")
];

function setup(fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(
    fetchImpl ??
      (async () =>
        ({
          ok: true,
          json: async () => ({ conversation: {}, messages: thread.slice(0, 2), queuedMessages: [], draft: null })
        }) as Response)
  );
  vi.stubGlobal("fetch", fetchMock);
  const composer = { input: "", attachments: [] as MessageAttachment[] };
  const callbacks = {
    onCommitted: vi.fn(),
    onError: vi.fn()
  };
  const hook = renderHook(
    ({ conversationId }) =>
      usePendingRewind({
        conversationId,
        getMessages: () => thread,
        composer: {
          getInput: () => composer.input,
          setInput: (value) => {
            composer.input = value;
          },
          getAttachments: () => composer.attachments,
          setAttachments: (attachments) => {
            composer.attachments = attachments;
          }
        },
        ...callbacks
      }),
    { initialProps: { conversationId: "conv_1" } }
  );
  return { hook, fetchMock, composer, callbacks };
}

describe("usePendingRewind", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hides the tail at once and saves it when the undo window passes", async () => {
    const { hook, fetchMock, callbacks } = setup();

    await act(async () => {
      await hook.result.current.start("msg_a1");
    });

    expect([...hook.result.current.removedMessageIds]).toEqual(["msg_u2", "msg_a2"]);
    expect(hook.result.current.isUndoVisible).toBe(true);
    expect(hook.result.current.undoLabel).toBe("Rewound 2 messages");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REWIND_UNDO_WINDOW_MS);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/messages/msg_a1/rewind", { method: "POST" });
    expect(callbacks.onCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ messages: thread.slice(0, 2), draft: null })
    );
    expect(hook.result.current.pendingRewind).toBeNull();
    expect(hook.result.current.removedMessageIds.size).toBe(0);
  });

  it("pauses the countdown while the toast is held", async () => {
    const { hook, fetchMock } = setup();

    await act(async () => {
      await hook.result.current.start("msg_a1");
    });
    act(() => hook.result.current.hold(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REWIND_UNDO_WINDOW_MS * 2);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => hook.result.current.hold(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REWIND_UNDO_WINDOW_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("moves a rewound user message into the composer and undo puts the earlier draft back", async () => {
    const { hook, composer, fetchMock } = setup();
    composer.input = "Unsent draft";

    await act(async () => {
      await hook.result.current.start("msg_u2");
    });

    expect(composer.input).toBe("Second question");
    expect(composer.attachments).toEqual([attachment]);

    act(() => hook.result.current.undo());

    expect(composer.input).toBe("Unsent draft");
    expect(composer.attachments).toEqual([]);
    expect(hook.result.current.pendingRewind).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REWIND_UNDO_WINDOW_MS);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps text typed over the restored draft when the rewind fails", async () => {
    const { hook, composer, callbacks } = setup(async () =>
      ({ ok: false, json: async () => ({ error: "Conversation is busy" }) }) as Response
    );

    await act(async () => {
      await hook.result.current.start("msg_u2");
    });
    composer.input = "Edited after rewind";

    let committed = true;
    await act(async () => {
      committed = await hook.result.current.commit();
    });

    expect(committed).toBe(false);
    expect(callbacks.onError).toHaveBeenCalledWith("Conversation is busy");
    expect(composer.input).toBe("Edited after rewind");
    expect(composer.attachments).toEqual([]);
    expect(hook.result.current.removedMessageIds.size).toBe(0);
  });

  it("reports a network failure with a generic message", async () => {
    const { hook, callbacks } = setup(async () => {
      throw new Error("offline");
    });

    await act(async () => {
      await hook.result.current.start("msg_a1");
      await hook.result.current.commit();
    });

    expect(callbacks.onError).toHaveBeenCalledWith("offline");
  });

  it("saves the pending rewind before starting another one", async () => {
    const { hook, fetchMock } = setup();

    await act(async () => {
      await hook.result.current.start("msg_a2");
    });
    expect(hook.result.current.pendingRewind).toBeNull();

    await act(async () => {
      await hook.result.current.start("msg_a1");
    });
    await act(async () => {
      await hook.result.current.start("msg_u1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/messages/msg_a1/rewind", { method: "POST" });
    expect(hook.result.current.pendingRewind?.messageId).toBe("msg_u1");
    expect([...hook.result.current.removedMessageIds]).toEqual(["msg_u1", "msg_a1"]);
    expect(hook.result.current.undoLabel).toBe("Rewound 2 messages");
  });

  it("undoes and explains when cancelled", async () => {
    const { hook, callbacks } = setup();

    await act(async () => {
      await hook.result.current.start("msg_a1");
    });
    act(() => hook.result.current.cancel("A new reply started"));

    expect(hook.result.current.pendingRewind).toBeNull();
    expect(callbacks.onError).toHaveBeenCalledWith("A new reply started");

    act(() => hook.result.current.cancel("ignored"));
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending rewind and restores the composer when the conversation changes", async () => {
    const { hook, fetchMock, composer } = setup();
    composer.input = "Unsent draft";

    await act(async () => {
      await hook.result.current.start("msg_u2");
    });
    expect(composer.input).toBe("Second question");

    hook.rerender({ conversationId: "conv_2" });

    expect(hook.result.current.pendingRewind).toBeNull();
    expect(composer.input).toBe("Unsent draft");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REWIND_UNDO_WINDOW_MS * 2);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never saves a pending rewind once the view goes away", async () => {
    const { hook, fetchMock } = setup();

    await act(async () => {
      await hook.result.current.start("msg_a1");
    });
    hook.unmount();
    await vi.advanceTimersByTimeAsync(REWIND_UNDO_WINDOW_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
