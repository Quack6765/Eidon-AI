import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { SONIOX_LANGUAGES } from "@/lib/speech/soniox-languages";
import { convertFloat32ToPcm16 } from "@/lib/speech/raw-audio";

const target = vi.hoisted(() => ({ url: "" }));

vi.mock("ws", async () => {
  const actual = await vi.importActual<typeof import("ws")>("ws");
  class RedirectedWebSocket extends actual.WebSocket {
    constructor() {
      super(target.url);
    }
  }
  return { ...actual, default: RedirectedWebSocket };
});

const { SONIOX_REALTIME_MODEL, transcribeWithSoniox } = await import("@/lib/speech/soniox");

let server: WebSocketServer;

beforeAll(() => {
  server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  target.url = `ws://127.0.0.1:${port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

afterEach(() => {
  server.removeAllListeners("connection");
});

describe("Soniox realtime transcription", () => {
  it("lists only Soniox-supported languages and the realtime model", () => {
    expect(SONIOX_LANGUAGES.length).toBe(60);
    expect(SONIOX_LANGUAGES.find((option) => option.value === "en")).toEqual({
      value: "en",
      label: "English"
    });
    expect(SONIOX_LANGUAGES.map((option) => option.value)).not.toContain("auto");
    for (const unsupported of ["fil", "is", "ga"]) {
      expect(SONIOX_LANGUAGES.map((option) => option.value)).not.toContain(unsupported);
    }
    expect(SONIOX_REALTIME_MODEL).toBe("stt-rt-v5");
  });

  it("streams PCM16 frames and omits hints when no language is selected", async () => {
    const samples = new Float32Array([0.1, -0.1, 0.2, -0.2, 0.3]);
    const expectedPcm = Buffer.from(convertFloat32ToPcm16(samples));
    const captured: { config: Record<string, unknown> | null } = { config: null };
    let receivedAudio = Buffer.alloc(0);

    server.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          receivedAudio = Buffer.concat([receivedAudio, data as Buffer]);
          return;
        }
        const text = data.toString();
        if (text === "") {
          ws.send(
            JSON.stringify({
              tokens: [
                { text: "Hello ", is_final: true },
                { text: "world", is_final: false }
              ],
              finished: false
            })
          );
          ws.send(
            JSON.stringify({
              tokens: [{ text: "world", is_final: true }],
              finished: true
            })
          );
          return;
        }
        captured.config = JSON.parse(text);
      });
    });

    await expect(
      transcribeWithSoniox({
        apiKey: "soniox-secret",
        samples,
        language: []
      })
    ).resolves.toBe("Hello world");

    expect(captured.config).toMatchObject({
      api_key: "soniox-secret",
      model: SONIOX_REALTIME_MODEL,
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      enable_endpoint_detection: true
    });
    expect(captured.config?.language_hints).toBeUndefined();
    expect(receivedAudio).toEqual(expectedPcm);
  });

  it("excludes Soniox event markers from the final transcript", async () => {
    server.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        if (!isBinary && data.toString() === "") {
          ws.send(
            JSON.stringify({
              tokens: [
                { text: "Hello", is_final: true },
                { text: " ", is_final: true },
                { text: "<end>", is_final: true },
                { text: "world", is_final: true }
              ],
              finished: true
            })
          );
        }
      });
    });

    await expect(
      transcribeWithSoniox({
        apiKey: "soniox-secret",
        samples: new Float32Array([0.1]),
        language: []
      })
    ).resolves.toBe("Hello world");
  });

  it("sends selected languages as language hints", async () => {
    const captured: { config: Record<string, unknown> | null } = { config: null };

    server.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        if (!isBinary) {
          const text = data.toString();
          if (text === "") {
            ws.send(
              JSON.stringify({
                tokens: [{ text: "bonjour", is_final: true }],
                finished: true
              })
            );
            return;
          }
          captured.config = JSON.parse(text);
        }
      });
    });

    await expect(
      transcribeWithSoniox({
        apiKey: "soniox-secret",
        samples: new Float32Array([0.1]),
        language: ["fr", "es"]
      })
    ).resolves.toBe("bonjour");

    expect(captured.config?.language_hints).toEqual(["fr", "es"]);
  });

  it("rejects when Soniox reports an authentication error", async () => {
    server.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        if (!isBinary && data.toString() === "") {
          ws.send(
            JSON.stringify({
              tokens: [],
              error_code: "invalid_api_key",
              error_message: "Unauthorized"
            })
          );
        }
      });
    });

    await expect(
      transcribeWithSoniox({
        apiKey: "bad",
        samples: new Float32Array([0.1]),
        language: []
      })
    ).rejects.toThrow("rejected the API key");
  });

  it("rejects when the socket closes before transcription finishes", async () => {
    server.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        if (!isBinary && data.toString() === "") {
          ws.close();
        }
      });
    });

    await expect(
      transcribeWithSoniox({
        apiKey: "soniox-secret",
        samples: new Float32Array([0.1]),
        language: []
      })
    ).rejects.toThrow();
  });

  it("rejects immediately without an API key", async () => {
    await expect(
      transcribeWithSoniox({
        apiKey: "",
        samples: new Float32Array([0.1]),
        language: []
      })
    ).rejects.toThrow("rejected the API key");
  });

  it("aborts when the signal fires before completion", async () => {
    server.on("connection", () => {
      // Never respond; force the caller to abort.
    });
    const controller = new AbortController();
    const promise = transcribeWithSoniox({
      apiKey: "soniox-secret",
      samples: new Float32Array([0.1]),
      language: [],
      signal: controller.signal
    });
    controller.abort();

    await expect(promise).rejects.toThrow("cancelled");
  });
});
