import { resolveEditInputImages } from "@/lib/image-generation/edit-inputs";
import type { Message, PromptMessage } from "@/lib/types";

const { readAttachmentBuffer, listMessages } = vi.hoisted(() => ({
  readAttachmentBuffer: vi.fn(),
  listMessages: vi.fn()
}));

vi.mock("@/lib/attachments", () => ({ readAttachmentBuffer }));
vi.mock("@/lib/conversations", () => ({ listMessages }));

function imagePart(overrides: Partial<{ attachmentId: string; filename: string; mimeType: string; relativePath: string }> = {}) {
  return {
    type: "image" as const,
    attachmentId: overrides.attachmentId ?? "att_1",
    filename: overrides.filename ?? "photo.png",
    mimeType: overrides.mimeType ?? "image/png",
    relativePath: overrides.relativePath ?? "attachments/photo.png"
  };
}

function userMessage(content: PromptMessage["content"]): PromptMessage {
  return { role: "user", content };
}

beforeEach(() => {
  readAttachmentBuffer.mockReset();
  readAttachmentBuffer.mockImplementation((source: { relativePath: string }) =>
    Buffer.from(`bytes:${source.relativePath}`));
  listMessages.mockReset();
  listMessages.mockReturnValue([]);
});

describe("resolveEditInputImages", () => {
  it("uses image parts from the latest user message", () => {
    const result = resolveEditInputImages([
      { role: "system", content: "system" },
      userMessage("generate a cat"),
      userMessage([imagePart(), { type: "text", text: "make the hat red" }])
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: "photo.png",
      mimeType: "image/png",
      bytes: Buffer.from("bytes:attachments/photo.png")
    });
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("falls back to the most recent assistant-generated images from storage", () => {
    listMessages.mockReturnValue([
      {
        role: "user",
        content: "generate a cat"
      },
      {
        role: "assistant",
        content: "Here you go.",
        actions: [{ kind: "image_generation", status: "completed" }],
        attachments: [{
          id: "att_gen",
          filename: "20250820-ab-1.png",
          mimeType: "image/png",
          kind: "image",
          relativePath: "attachments/generated-1.png"
        }]
      },
      { role: "user", content: "change the hat to red" }
    ] as unknown as Message[]);

    const result = resolveEditInputImages([
      { role: "system", content: "system" },
      userMessage("generate a cat"),
      userMessage("change the hat to red")
    ], "conv_1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ filename: "20250820-ab-1.png" });
    expect(result[0].bytes).toEqual(Buffer.from("bytes:attachments/generated-1.png"));
  });

  it("falls back to image parts from earlier user messages", () => {
    const result = resolveEditInputImages([
      { role: "system", content: "system" },
      userMessage([imagePart({ relativePath: "attachments/old.png", filename: "old.png" })]),
      userMessage("remove the background")
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ filename: "old.png" });
  });

  it("caps inputs at four images, dedupes, and skips unreadable files", () => {
    readAttachmentBuffer.mockImplementation((source: { relativePath: string }) => {
      if (source.relativePath.endsWith("broken.png")) throw new Error("ENOENT");
      return Buffer.from(`bytes:${source.relativePath}`);
    });

    const result = resolveEditInputImages([
      userMessage([
        imagePart({ relativePath: "a.png", filename: "a.png" }),
        imagePart({ relativePath: "a.png", filename: "a.png" }),
        imagePart({ relativePath: "b.png", filename: "b.png" }),
        imagePart({ relativePath: "c.png", filename: "c.png" }),
        imagePart({ relativePath: "broken.png", filename: "broken.png" }),
        imagePart({ relativePath: "d.png", filename: "d.png" }),
        imagePart({ relativePath: "e.png", filename: "e.png" })
      ])
    ]);

    expect(result.map((image) => image.filename)).toEqual(["a.png", "b.png", "c.png", "d.png"]);
  });

  it("returns no inputs when no references exist anywhere", () => {
    expect(resolveEditInputImages([
      { role: "system", content: "system" },
      userMessage("generate a cat"),
      userMessage("generate a dog")
    ], "conv_1")).toEqual([]);
  });

  it("defaults the first image to canvas and the rest to content", () => {
    const result = resolveEditInputImages([
      userMessage([
        imagePart({ relativePath: "base.png", filename: "base.png" }),
        imagePart({ relativePath: "logo.png", filename: "logo.png" })
      ])
    ]);

    expect(result.map((image) => ({ filename: image.filename, role: image.role }))).toEqual([
      { filename: "base.png", role: "canvas" },
      { filename: "logo.png", role: "content" }
    ]);
  });

  it("lets explicit overrides win over inferred roles and labels", () => {
    const result = resolveEditInputImages(
      [userMessage([
        imagePart({ relativePath: "base.png", filename: "base.png" }),
        imagePart({ relativePath: "logo.png", filename: "logo.png" })
      ])],
      undefined,
      [
        { filename: "logo.png", role: "canvas", label: "the photo to edit" },
        { filename: "base.png", role: "content", label: "brand mark" }
      ]
    );

    expect(result.map((image) => ({ filename: image.filename, role: image.role, label: image.label }))).toEqual([
      { filename: "logo.png", role: "canvas", label: "the photo to edit" },
      { filename: "base.png", role: "content", label: "brand mark" }
    ]);
  });

  it("orders canvas before content, style and character", () => {
    const result = resolveEditInputImages([
      userMessage([
        imagePart({ relativePath: "character.png", filename: "character.png" }),
        imagePart({ relativePath: "style.png", filename: "style.png" }),
        imagePart({ relativePath: "logo.png", filename: "logo.png" }),
        imagePart({ relativePath: "base.png", filename: "base.png" })
      ])
    ], undefined, [
      { filename: "character.png", role: "character", label: "the hero" },
      { filename: "style.png", role: "style", label: "mood board" },
      { filename: "logo.png", role: "content", label: "the logo" },
      { filename: "base.png", role: "canvas", label: "base photo" }
    ]);

    expect(result.map((image) => image.filename)).toEqual([
      "base.png",
      "logo.png",
      "style.png",
      "character.png"
    ]);
  });

  it("keeps the canvas when the cap trims trailing images", () => {
    const result = resolveEditInputImages([
      userMessage([
        imagePart({ relativePath: "d.png", filename: "d.png" }),
        imagePart({ relativePath: "c.png", filename: "c.png" }),
        imagePart({ relativePath: "b.png", filename: "b.png" }),
        imagePart({ relativePath: "a.png", filename: "a.png" }),
        imagePart({ relativePath: "z.png", filename: "z.png" })
      ])
    ], undefined, [
      { filename: "z.png", role: "canvas", label: "base photo" }
    ]);

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ filename: "z.png", role: "canvas" });
  });
});
