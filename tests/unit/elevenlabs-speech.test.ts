import {
  convertFloat32ToPcm16,
  ELEVENLABS_SPEECH_TO_TEXT_URL,
  transcribeWithElevenLabs
} from "@/lib/speech/elevenlabs";
import { ELEVENLABS_SCRIBE_LANGUAGES } from "@/lib/speech/elevenlabs-languages";

describe("ElevenLabs Scribe transcription", () => {
  it("offers automatic detection first and the complete Scribe language catalog", () => {
    expect(ELEVENLABS_SCRIBE_LANGUAGES[0]).toEqual({
      value: "auto",
      label: "Automatic"
    });
    expect(ELEVENLABS_SCRIBE_LANGUAGES.length).toBeGreaterThan(90);
    expect(ELEVENLABS_SCRIBE_LANGUAGES).toContainEqual({
      value: "zho",
      label: "Mandarin Chinese"
    });
  });

  it("converts normalized Float32 samples to little-endian PCM16", () => {
    const pcm = convertFloat32ToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    const view = new DataView(pcm);

    expect(Array.from({ length: 5 }, (_, index) => view.getInt16(index * 2, true))).toEqual([
      -32768,
      -16384,
      0,
      16384,
      32767
    ]);
  });

  it("sends Scribe v2 multipart audio without exposing the key in the form", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.headers).toEqual({ "xi-api-key": "xi-secret" });
      expect(form.get("model_id")).toBe("scribe_v2");
      expect(form.get("file_format")).toBe("pcm_s16le_16");
      expect(form.get("tag_audio_events")).toBe("false");
      expect(form.get("timestamps_granularity")).toBe("none");
      expect(form.get("language_code")).toBeNull();
      expect(form.get("file")).toBeInstanceOf(Blob);
      expect(Array.from(form.values())).not.toContain("xi-secret");
      return new Response(JSON.stringify({ text: "  hello world  " }), { status: 200 });
    });

    await expect(transcribeWithElevenLabs({
      apiKey: "xi-secret",
      samples: new Float32Array([0.2, -0.2]),
      language: "auto",
      fetcher
    })).resolves.toBe("hello world");
    expect(fetcher).toHaveBeenCalledWith(
      ELEVENLABS_SPEECH_TO_TEXT_URL,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("passes explicit language and returns actionable provider failures", async () => {
    const unauthorized = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.body as FormData).get("language_code")).toBe("fra");
      return new Response(null, { status: 401 });
    });

    await expect(transcribeWithElevenLabs({
      apiKey: "invalid",
      samples: new Float32Array([0]),
      language: "fra",
      fetcher: unauthorized
    })).rejects.toThrow("rejected the API key");

    await expect(transcribeWithElevenLabs({
      apiKey: "valid",
      samples: new Float32Array([0]),
      language: "eng",
      fetcher: vi.fn(async () => new Response(JSON.stringify({ text: 42 }), { status: 200 }))
    })).rejects.toThrow("invalid transcription response");
  });
});
