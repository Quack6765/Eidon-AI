import { generateComfyUiImages } from "@/lib/image-generation/comfyui";

describe("generateComfyUiImages", () => {
  it("injects mapped values into the workflow and downloads output images", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: "prompt-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "prompt-1": {
            outputs: {
              "9": {
                images: [
                  {
                    filename: "out.png",
                    subfolder: "",
                    type: "output"
                  }
                ]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        headers: new Headers({ "content-type": "image/png" })
      });

    const result = await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: "https://comfy.example.com",
        comfyuiAuthType: "bearer",
        comfyuiBearerToken: "secret",
        comfyuiWorkflowJson: '{"3":{"inputs":{"text":"old"}}}',
        comfyuiPromptPath: "3.inputs.text",
        comfyuiNegativePromptPath: "",
        comfyuiWidthPath: "",
        comfyuiHeightPath: "",
        comfyuiSeedPath: ""
      },
      instruction: {
        imagePrompt: "new prompt",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      clientId: "client-1",
      fetchImpl: fetchMock,
      connectWebSocket: async () => ({
        waitForPromptDone: async () => {},
        close: () => {}
      })
    });

    expect(result.images[0]).toMatchObject({
      mimeType: "image/png",
      filename: "out.png"
    });
  });

  it("sends bearer token in Authorization header when auth type is bearer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: "prompt-2" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "prompt-2": {
            outputs: {
              "9": {
                images: [
                  {
                    filename: "out.png",
                    subfolder: "",
                    type: "output"
                  }
                ]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers({ "content-type": "image/png" })
      });

    await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: "https://comfy.example.com",
        comfyuiAuthType: "bearer",
        comfyuiBearerToken: "my-token",
        comfyuiWorkflowJson: '{"3":{"inputs":{"text":"prompt"}}}',
        comfyuiPromptPath: "3.inputs.text",
        comfyuiNegativePromptPath: "",
        comfyuiWidthPath: "",
        comfyuiHeightPath: "",
        comfyuiSeedPath: ""
      },
      instruction: {
        imagePrompt: "test prompt",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      clientId: "client-2",
      fetchImpl: fetchMock,
      connectWebSocket: async () => ({
        waitForPromptDone: async () => {},
        close: () => {}
      })
    });

    const queueCall = fetchMock.mock.calls[0];
    expect(queueCall[1]?.headers?.Authorization).toBe("Bearer my-token");
  });

  it("does not send Authorization header when auth type is none", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: "prompt-3" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "prompt-3": {
            outputs: {
              "9": {
                images: [
                  {
                    filename: "out.png",
                    subfolder: "",
                    type: "output"
                  }
                ]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers({ "content-type": "image/png" })
      });

    await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: "https://comfy.example.com",
        comfyuiAuthType: "none",
        comfyuiBearerToken: "",
        comfyuiWorkflowJson: '{"3":{"inputs":{"text":"prompt"}}}',
        comfyuiPromptPath: "3.inputs.text",
        comfyuiNegativePromptPath: "",
        comfyuiWidthPath: "",
        comfyuiHeightPath: "",
        comfyuiSeedPath: ""
      },
      instruction: {
        imagePrompt: "test prompt",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      clientId: "client-3",
      fetchImpl: fetchMock,
      connectWebSocket: async () => ({
        waitForPromptDone: async () => {},
        close: () => {}
      })
    });

    const queueCall = fetchMock.mock.calls[0];
    expect(queueCall[1]?.headers?.Authorization).toBeUndefined();
  });

  it("injects negative prompt, width, height, and seed when paths are configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: "prompt-4" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "prompt-4": {
            outputs: {
              "9": {
                images: [{ filename: "out.png", subfolder: "", type: "output" }]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers({ "content-type": "image/png" })
      });

    await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: "https://comfy.example.com",
        comfyuiAuthType: "none",
        comfyuiBearerToken: "",
        comfyuiWorkflowJson: '{"3":{"inputs":{"text":"","negative":"","width":512,"height":512,"seed":0}}}',
        comfyuiPromptPath: "3.inputs.text",
        comfyuiNegativePromptPath: "3.inputs.negative",
        comfyuiWidthPath: "3.inputs.width",
        comfyuiHeightPath: "3.inputs.height",
        comfyuiSeedPath: "3.inputs.seed"
      },
      instruction: {
        imagePrompt: "a cat",
        negativePrompt: "blurry",
        assistantText: "",
        aspectRatio: "16:9",
        width: 1024,
        height: 576,
        seed: 42,
        count: 1
      },
      clientId: "client-4",
      fetchImpl: fetchMock,
      connectWebSocket: async () => ({
        waitForPromptDone: async () => {},
        close: () => {}
      })
    });

    const queueCall = fetchMock.mock.calls[0];
    const body = JSON.parse(queueCall[1]?.body);
    expect(body["3"].inputs.text).toBe("a cat");
    expect(body["3"].inputs.negative).toBe("blurry");
    expect(body["3"].inputs.width).toBe(1024);
    expect(body["3"].inputs.height).toBe(576);
    expect(body["3"].inputs.seed).toBe(42);
  });

  it("includes client_id in the queue request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: "prompt-5" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "prompt-5": {
            outputs: {
              "9": {
                images: [{ filename: "out.png", subfolder: "", type: "output" }]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers({ "content-type": "image/png" })
      });

    await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: "https://comfy.example.com",
        comfyuiAuthType: "none",
        comfyuiBearerToken: "",
        comfyuiWorkflowJson: '{"3":{"inputs":{"text":"prompt"}}}',
        comfyuiPromptPath: "3.inputs.text",
        comfyuiNegativePromptPath: "",
        comfyuiWidthPath: "",
        comfyuiHeightPath: "",
        comfyuiSeedPath: ""
      },
      instruction: {
        imagePrompt: "test",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      clientId: "my-client-id",
      fetchImpl: fetchMock,
      connectWebSocket: async () => ({
        waitForPromptDone: async () => {},
        close: () => {}
      })
    });

    const queueCall = fetchMock.mock.calls[0];
    const body = JSON.parse(queueCall[1]?.body);
    expect(body.client_id).toBe("my-client-id");
  });

  it("connects websocket with the correct URL and closes after completion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prompt_id: "prompt-6" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "prompt-6": {
            outputs: {
              "9": {
                images: [{ filename: "out.png", subfolder: "", type: "output" }]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Headers({ "content-type": "image/png" })
      });

    const closeMock = vi.fn();
    await generateComfyUiImages({
      settings: {
        comfyuiBaseUrl: "https://comfy.example.com",
        comfyuiAuthType: "none",
        comfyuiBearerToken: "",
        comfyuiWorkflowJson: '{"3":{"inputs":{"text":"prompt"}}}',
        comfyuiPromptPath: "3.inputs.text",
        comfyuiNegativePromptPath: "",
        comfyuiWidthPath: "",
        comfyuiHeightPath: "",
        comfyuiSeedPath: ""
      },
      instruction: {
        imagePrompt: "test",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      clientId: "client-ws",
      fetchImpl: fetchMock,
      connectWebSocket: async (url) => {
        expect(url).toContain("ws");
        expect(url).toContain("client-ws");
        return {
          waitForPromptDone: async () => {},
          close: closeMock
        };
      }
    });

    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the queue response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    });

    await expect(
      generateComfyUiImages({
        settings: {
          comfyuiBaseUrl: "https://comfy.example.com",
          comfyuiAuthType: "none",
          comfyuiBearerToken: "",
          comfyuiWorkflowJson: '{"3":{"inputs":{"text":"prompt"}}}',
          comfyuiPromptPath: "3.inputs.text",
          comfyuiNegativePromptPath: "",
          comfyuiWidthPath: "",
          comfyuiHeightPath: "",
          comfyuiSeedPath: ""
        },
        instruction: {
          imagePrompt: "test",
          negativePrompt: "",
          assistantText: "",
          aspectRatio: "1:1",
          count: 1
        },
        clientId: "client-err",
        fetchImpl: fetchMock,
        connectWebSocket: async () => ({
          waitForPromptDone: async () => {},
          close: () => {}
        })
      })
    ).rejects.toThrow("ComfyUI queue failed");
  });
});
