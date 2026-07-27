import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANARY_SAMPLE_RATE,
  configureCanaryModelForTests,
  ensureCanaryModelReady,
  mergeCanaryTranscripts,
  resetCanaryModelForTests,
  transcribeWithCanary
} from "@/lib/speech/canary-model";
import type { OfflineRecognizer } from "sherpa-onnx-node";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createModelFixture() {
  const data = new Map([
    ["encoder.int8.onnx", new TextEncoder().encode("encoder")],
    ["decoder.int8.onnx", new TextEncoder().encode("decoder")],
    ["tokens.txt", new TextEncoder().encode("tokens")]
  ]);
  const files = [...data].map(([name, bytes]) => ({
    name,
    size: bytes.byteLength,
    sha256: sha256(bytes)
  }));
  return { data, files };
}

describe("Canary model runtime", () => {
  const directories: string[] = [];

  afterEach(async () => {
    resetCanaryModelForTests();
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("downloads pinned model files once and reuses the loaded runtime", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "eidon-canary-"));
    directories.push(directory);
    const fixture = createModelFixture();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const filename = new URL(String(url)).pathname.split("/").pop()!;
      const bytes = fixture.data.get(filename)!;
      return new Response(bytes, {
        headers: { "content-length": String(bytes.byteLength) }
      });
    });
    const recognizer = {
      setConfig: vi.fn(),
      createStream: vi.fn(),
      decodeAsync: vi.fn()
    } as unknown as OfflineRecognizer;
    const createRecognizer = vi.fn(async () => recognizer);

    configureCanaryModelForTests({
      directory,
      files: fixture.files,
      fetcher: fetcher as typeof fetch,
      createRecognizer
    });

    const first = await ensureCanaryModelReady();
    const second = await ensureCanaryModelReady();

    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(createRecognizer).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(directory, "encoder.int8.onnx"), "utf8")).toBe("encoder");
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining(["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"])
    );
  });

  it("uses verified cached files without another download", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "eidon-canary-cache-"));
    directories.push(directory);
    const fixture = createModelFixture();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const filename = new URL(String(url)).pathname.split("/").pop()!;
      return new Response(fixture.data.get(filename)!);
    });
    const createRecognizer = vi.fn(async () => ({}) as OfflineRecognizer);
    configureCanaryModelForTests({
      directory,
      files: fixture.files,
      fetcher: fetcher as typeof fetch,
      createRecognizer
    });
    await ensureCanaryModelReady();

    resetCanaryModelForTests();
    const noDownload = vi.fn<typeof fetch>();
    configureCanaryModelForTests({
      directory,
      files: fixture.files,
      fetcher: noDownload,
      createRecognizer
    });
    await ensureCanaryModelReady();

    expect(noDownload).not.toHaveBeenCalled();
  });

  it("rejects corrupt downloads and removes partial files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "eidon-canary-corrupt-"));
    directories.push(directory);
    const fixture = createModelFixture();
    configureCanaryModelForTests({
      directory,
      files: fixture.files.map((file) => ({ ...file, sha256: "0".repeat(64) })),
      fetcher: (async (url: string | URL | Request) => {
        const filename = new URL(String(url)).pathname.split("/").pop()!;
        return new Response(fixture.data.get(filename)!);
      }) as typeof fetch,
      createRecognizer: vi.fn()
    });

    await expect(ensureCanaryModelReady()).rejects.toThrow("Integrity check failed");
    expect((await readdir(directory)).some((filename) => filename.endsWith(".download"))).toBe(false);
  });

  it("chunks long recordings and removes overlap from transcripts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "eidon-canary-chunks-"));
    directories.push(directory);
    const fixture = createModelFixture();
    const acceptWaveform = vi.fn();
    const decodeAsync = vi.fn()
      .mockResolvedValueOnce({ text: "Hello, world" })
      .mockResolvedValueOnce({ text: "world again" });
    const recognizer = {
      setConfig: vi.fn(),
      createStream: vi.fn(() => ({ acceptWaveform })),
      decodeAsync
    } as unknown as OfflineRecognizer;
    configureCanaryModelForTests({
      directory,
      files: fixture.files,
      fetcher: (async (url: string | URL | Request) => {
        const filename = new URL(String(url)).pathname.split("/").pop()!;
        return new Response(fixture.data.get(filename)!);
      }) as typeof fetch,
      createRecognizer: vi.fn(async () => recognizer)
    });

    const samples = new Float32Array(CANARY_SAMPLE_RATE * 31);
    await expect(transcribeWithCanary(samples, "fr")).resolves.toBe("Hello, world again");
    expect(recognizer.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelConfig: expect.objectContaining({
          canary: expect.objectContaining({ srcLang: "fr", tgtLang: "fr" })
        })
      })
    );
    expect(acceptWaveform).toHaveBeenCalledTimes(2);
  });

  it("merges empty, overlapping, and distinct transcript chunks", () => {
    expect(mergeCanaryTranscripts("", " hello ")).toBe("hello");
    expect(mergeCanaryTranscripts("hello", "")).toBe("hello");
    expect(mergeCanaryTranscripts("Hello, world", "world again")).toBe("Hello, world again");
    expect(mergeCanaryTranscripts("hello world", "different words")).toBe(
      "hello world different words"
    );
  });
});
