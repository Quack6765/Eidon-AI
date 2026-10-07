import { withToolResultImagesAsUserMessages } from "@/lib/provider-message-formatting";
import type { PromptImageContentPart, PromptMessage } from "@/lib/types";

function image(name: string): PromptImageContentPart {
  return {
    type: "image",
    attachmentId: `att_${name}`,
    filename: `${name}.png`,
    mimeType: "image/png",
    relativePath: `conv/att_${name}.png`
  };
}

function screenshotTurn(names: string[]): PromptMessage[] {
  return names.flatMap((name): PromptMessage[] => [
    { role: "assistant", content: "", toolCalls: [{ id: name, name: "execute_shell_command", arguments: "{}" }] },
    { role: "tool", toolCallId: name, content: [{ type: "text", text: `saved ${name}` }, image(name)] }
  ]);
}

function inlineImageNames(messages: PromptMessage[]) {
  return messages.flatMap((message) =>
    typeof message.content === "string"
      ? []
      : message.content.flatMap((part) => (part.type === "image" ? [part.filename] : []))
  );
}

describe("withToolResultImagesAsUserMessages", () => {
  it("leaves prompts without tool images unchanged", () => {
    const messages: PromptMessage[] = [
      { role: "user", content: [{ type: "text", text: "look" }, image("upload")] },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "search", arguments: "{}" }] },
      { role: "tool", toolCallId: "t1", content: "result" }
    ];

    expect(withToolResultImagesAsUserMessages(messages)).toEqual(messages);
  });

  it("moves the images of a run of tool results into one user message after the run", () => {
    const messages: PromptMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "t1", name: "execute_shell_command", arguments: "{}" },
          { id: "t2", name: "execute_shell_command", arguments: "{}" }
        ]
      },
      { role: "tool", toolCallId: "t1", content: [{ type: "text", text: "first" }, { type: "text", text: "second" }, image("one")] },
      { role: "tool", toolCallId: "t2", content: [{ type: "text", text: "done" }, image("two")] },
      { role: "user", content: "next" }
    ];

    expect(withToolResultImagesAsUserMessages(messages)).toEqual([
      messages[0],
      { role: "tool", toolCallId: "t1", content: "first\nsecond" },
      { role: "tool", toolCallId: "t2", content: "done" },
      {
        role: "user",
        content: [
          { type: "text", text: "Images returned by the tool calls above:" },
          { type: "text", text: "Attached image: one.png" },
          image("one"),
          { type: "text", text: "Attached image: two.png" },
          image("two")
        ]
      },
      { role: "user", content: "next" }
    ]);
  });

  it("joins text-only array tool results with newlines", () => {
    const messages: PromptMessage[] = [
      { role: "tool", toolCallId: "t1", content: [{ type: "text", text: "saved" }, { type: "text", text: "Attached image: a.png" }] }
    ];

    expect(withToolResultImagesAsUserMessages(messages)).toEqual([
      { role: "tool", toolCallId: "t1", content: "saved\nAttached image: a.png" }
    ]);
  });

  it.each([
    { count: 8, kept: 8 },
    { count: 9, kept: 5 },
    { count: 12, kept: 8 },
    { count: 13, kept: 5 }
  ])("keeps the newest $kept of $count tool images, omitting the oldest in blocks of four", ({ count, kept }) => {
    const names = Array.from({ length: count }, (_, index) => `shot${index + 1}`);

    const result = withToolResultImagesAsUserMessages(screenshotTurn(names));

    expect(inlineImageNames(result)).toEqual(names.slice(count - kept).map((name) => `${name}.png`));
    if (count > kept) {
      expect(result[1]).toEqual({
        role: "tool",
        toolCallId: "shot1",
        content: "saved shot1\n[image omitted from context to save tokens: shot1.png — file remains attached to this message]"
      });
    }
  });
});
