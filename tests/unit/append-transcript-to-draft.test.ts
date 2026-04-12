import { appendTranscriptToDraft } from "@/lib/speech/append-transcript-to-draft";

describe("appendTranscriptToDraft", () => {
  it("keeps the current draft when the transcript is empty after trimming", () => {
    expect(appendTranscriptToDraft("Existing draft", "   \n\t  ")).toBe("Existing draft");
  });

  it("returns the trimmed transcript when the current draft is blank", () => {
    expect(appendTranscriptToDraft("   ", "  Bonjour  ")).toBe("Bonjour");
  });

  it("appends a trimmed transcript on a new line after removing trailing draft whitespace", () => {
    expect(appendTranscriptToDraft("Existing draft   ", "  hello from voice input  ")).toBe(
      "Existing draft\nhello from voice input"
    );
  });
});
