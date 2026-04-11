import { describe, expect, it } from "vitest";

import { resolveSpeechLocale } from "@/lib/speech/locales";

describe("browser speech engine", () => {
  it("maps app languages to browser recognition locales", () => {
    expect(resolveSpeechLocale("en")).toBe("en-US");
    expect(resolveSpeechLocale("fr")).toBe("fr-FR");
    expect(resolveSpeechLocale("es")).toBe("es-ES");
  });
});
