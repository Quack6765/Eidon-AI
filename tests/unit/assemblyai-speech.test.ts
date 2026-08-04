import {
  ASSEMBLYAI_API_BASE_URL,
  transcribeWithAssemblyAi
} from "@/lib/speech/assemblyai";
import {
  ASSEMBLYAI_UNIVERSAL_2_LANGUAGES,
  ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES
} from "@/lib/speech/assemblyai-languages";
import { encodeFloat32ToWav } from "@/lib/speech/raw-audio";

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("AssemblyAI transcription", () => {
  it("publishes strict model language catalogs with Automatic first", () => {
    expect(ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES[0]).toEqual({
      value: "auto",
      label: "Automatic"
    });
    expect(ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES).toHaveLength(19);
    expect(ASSEMBLYAI_UNIVERSAL_2_LANGUAGES.length).toBeGreaterThan(99);
    expect(ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES).not.toContainEqual({
      value: "sw",
      label: "Swahili"
    });
    expect(ASSEMBLYAI_UNIVERSAL_2_LANGUAGES).toContainEqual({
      value: "sw",
      label: "Swahili"
    });
  });

  it("encodes mono PCM16 WAV audio", () => {
    const wav = encodeFloat32ToWav(new Float32Array([-1, 0, 1]), 16_000);
    const view = new DataView(wav);
    const text = (offset: number, length: number) => String.fromCharCode(
      ...new Uint8Array(wav, offset, length)
    );

    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect([0, 1, 2].map((index) => view.getInt16(44 + index * 2, true))).toEqual([
      -32768,
      0,
      32767
    ]);
  });

  it("uploads WAV audio, submits strict automatic detection, and polls to completion", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ id: "transcript_1" }))
      .mockResolvedValueOnce(response({ status: "processing" }))
      .mockResolvedValueOnce(response({
        status: "completed",
        text: "  hello world  ",
        speech_model_used: "universal-3-5-pro"
      }));

    await expect(transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0.2, -0.2]),
      model: "universal-3-5-pro",
      language: "auto",
      fetcher,
      sleep: async () => {}
    })).resolves.toEqual({
      model: "universal-3-5-pro",
      transcript: "hello world"
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `${ASSEMBLYAI_API_BASE_URL}/v2/upload`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "assembly-secret",
          "Content-Type": "application/octet-stream"
        },
        body: expect.any(ArrayBuffer),
        signal: undefined
      })
    );
    const submit = fetcher.mock.calls[1][1] as RequestInit;
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `${ASSEMBLYAI_API_BASE_URL}/v2/transcript`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "assembly-secret",
          "Content-Type": "application/json"
        },
        signal: undefined
      })
    );
    expect(JSON.parse(String(submit.body))).toEqual({
      audio_url: "https://cdn.example/audio",
      speech_models: ["universal-3-5-pro"],
      language_detection: true
    });
    expect(String(submit.body)).not.toContain("assembly-secret");
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `${ASSEMBLYAI_API_BASE_URL}/v2/transcript/transcript_1`,
      expect.objectContaining({ headers: { Authorization: "assembly-secret" } })
    );
  });

  it("submits an explicit language with Universal 2", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ id: "transcript_2" }))
      .mockResolvedValueOnce(response({
        status: "completed",
        text: "bonjour",
        speech_model_used: "universal-2"
      }));

    await expect(transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "fr",
      fetcher
    })).resolves.toEqual({ model: "universal-2", transcript: "bonjour" });
    expect(JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body))).toEqual({
      audio_url: "https://cdn.example/audio",
      speech_models: ["universal-2"],
      language_code: "fr"
    });
  });

  it.each([
    [401, 502, "rejected the API key"],
    [403, 502, "rejected the API key"],
    [429, 429, "rate limited"]
  ])("maps upload status %s to a safe provider error", async (httpStatus, status, message) => {
    const error = await transcribeWithAssemblyAi({
      apiKey: "bad-secret",
      samples: new Float32Array([0]),
      model: "universal-3-5-pro",
      language: "en",
      fetcher: vi.fn(async () => response({ error: "provider details" }, httpStatus))
    }).catch((caught) => caught);

    expect(error).toMatchObject({ status });
    expect(error.message).toContain(message);
    expect(error.message).not.toContain("provider details");
  });

  it("maps failed jobs and malformed responses without leaking provider details", async () => {
    const failedFetcher = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ id: "transcript_3" }))
      .mockResolvedValueOnce(response({ status: "error", error: "private provider detail" }));

    await expect(transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "en",
      fetcher: failedFetcher
    })).rejects.toThrow("could not transcribe this recording");

    await expect(transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "en",
      fetcher: vi.fn(async () => response({ upload_url: 42 }))
    })).rejects.toThrow("invalid upload response");

    const rejectedSubmission = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ error: "private request detail" }, 422));
    const submissionError = await transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "en",
      fetcher: rejectedSubmission
    }).catch((caught) => caught);
    expect(submissionError).toMatchObject({ status: 502 });
    expect(submissionError.message).toContain("selected model, language, and account balance");
    expect(submissionError.message).not.toContain("private request detail");

    const malformedCompletion = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ id: "transcript_invalid" }))
      .mockResolvedValueOnce(response({
        status: "completed",
        text: "hello",
        speech_model_used: "unexpected-model",
        error: "private completion detail"
      }));
    const completionError = await transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "en",
      fetcher: malformedCompletion
    }).catch((caught) => caught);
    expect(completionError).toMatchObject({ status: 502 });
    expect(completionError.message).toContain("invalid transcription response");
    expect(completionError.message).not.toContain("private completion detail");
  });

  it("times out bounded polling and propagates cancellation", async () => {
    let currentTime = 0;
    const timeoutFetcher = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ id: "transcript_4" }))
      .mockImplementation(async () => response({ status: "processing" }));

    const timeoutError = await transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "en",
      fetcher: timeoutFetcher,
      pollIntervalMs: 1,
      timeoutMs: 2,
      now: () => currentTime,
      sleep: async (milliseconds) => { currentTime += milliseconds; }
    }).catch((caught) => caught);
    expect(timeoutError).toMatchObject({ status: 504 });
    expect(timeoutError.message).toContain("timed out");

    const controller = new AbortController();
    const abortFetcher = vi.fn()
      .mockResolvedValueOnce(response({ upload_url: "https://cdn.example/audio" }))
      .mockResolvedValueOnce(response({ id: "transcript_5" }))
      .mockImplementationOnce(async () => {
        controller.abort();
        return response({ status: "processing" });
      });
    const abortError = await transcribeWithAssemblyAi({
      apiKey: "assembly-secret",
      samples: new Float32Array([0]),
      model: "universal-2",
      language: "en",
      fetcher: abortFetcher,
      signal: controller.signal
    }).catch((caught) => caught);
    expect(abortError).toMatchObject({ status: 499 });
    expect(abortError.message).toContain("cancelled");
  });
});
