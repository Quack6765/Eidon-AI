// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";

import { usePendingAttachments } from "@/hooks/use-pending-attachments";

function okResponse() {
  return new Response(
    JSON.stringify({
      attachments: [
        {
          id: `att_${Math.random().toString(36).slice(2, 8)}`,
          conversationId: "conv_1",
          messageId: null,
          filename: "photo.jpg",
          mimeType: "image/jpeg",
          byteSize: 10,
          sha256: "hash",
          relativePath: "conv_1/att_photo.jpg",
          kind: "image",
          extractedText: "",
          createdAt: new Date().toISOString()
        }
      ]
    }),
    { status: 201 }
  );
}

describe("usePendingAttachments", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uploads per file, keeps partial successes, and reports the failed file by name", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const formData = (init?.body as FormData) ?? new FormData();
      const file = formData.get("files") as File;
      if (file.name === "bad.jpg") {
        return new Response(JSON.stringify({ error: "Attachment is empty: bad.jpg" }), { status: 400 });
      }
      return okResponse();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const errors: string[] = [];
    const { result } = renderHook(() =>
      usePendingAttachments({
        resolveConversationId: () => "conv_1",
        onError: (message) => errors.push(message)
      })
    );

    await act(async () => {
      await result.current.uploadFiles([
        new File(["aaa"], "good1.jpg", { type: "image/jpeg" }),
        new File(["bbb"], "bad.jpg", { type: "image/jpeg" }),
        new File(["ccc"], "good2.jpg", { type: "image/jpeg" })
      ]);
    });

    await waitFor(() => expect(result.current.pendingAttachments).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errors.at(-1)).toContain("1 of 3 files failed to upload");
    expect(errors.at(-1)).toContain("bad.jpg: Attachment is empty: bad.jpg");
    expect(errors.at(-1)).toContain("Re-attach the failed files to retry.");
  });

  it("skips zero-byte picks with an iCloud hint without uploading them", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const errors: string[] = [];
    const { result } = renderHook(() =>
      usePendingAttachments({
        resolveConversationId: () => "conv_1",
        onError: (message) => errors.push(message)
      })
    );

    await act(async () => {
      await result.current.uploadFiles([new File([], "late.jpg", { type: "image/jpeg" })]);
    });

    await waitFor(() => expect(errors.at(-1)).toContain("late.jpg"));
    expect(errors.at(-1)).toContain("did not finish downloading from iCloud");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pendingAttachments).toHaveLength(0);
  });

  it("retries files that failed transiently when the next upload runs", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      usePendingAttachments({
        resolveConversationId: () => "conv_1",
        onError: () => {}
      })
    );

    await act(async () => {
      await result.current.uploadFiles([new File(["aaa"], "flaky.jpg", { type: "image/jpeg" })]);
    });

    await waitFor(() => expect(result.current.pendingAttachments).toHaveLength(0));

    await act(async () => {
      await result.current.uploadFiles([]);
    });

    await waitFor(() => expect(result.current.pendingAttachments).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.pendingAttachments[0]?.filename).toBe("photo.jpg");
  });
});
