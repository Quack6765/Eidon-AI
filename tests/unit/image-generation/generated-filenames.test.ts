import { renameGeneratedImages } from "@/lib/image-generation/generated-filenames";

describe("renameGeneratedImages", () => {
  it("applies one batch token across images and keeps their file extensions", () => {
    const renamed = renameGeneratedImages(
      [
        {
          bytes: Buffer.from("one"),
          mimeType: "image/png",
          filename: "generated-1.png"
        },
        {
          bytes: Buffer.from("two"),
          mimeType: "image/jpeg",
          filename: "raw-output.jpg"
        }
      ],
      {
        now: new Date("2026-04-16T12:34:56Z"),
        batchToken: "deadbeef"
      }
    );

    expect(renamed.map((image) => image.filename)).toEqual([
      "20260416-123456-deadbeef-1.png",
      "20260416-123456-deadbeef-2.jpg"
    ]);
  });

  it("falls back to mime-derived extensions and defaults unknown types to png", () => {
    const renamed = renameGeneratedImages(
      [
        {
          bytes: Buffer.from("one"),
          mimeType: "image/webp",
          filename: "generated-output"
        },
        {
          bytes: Buffer.from("two"),
          mimeType: "image/unknown",
          filename: ""
        }
      ],
      {
        now: new Date("2026-04-16T12:34:56Z"),
        batchToken: "deadbeef"
      }
    );

    expect(renamed.map((image) => image.filename)).toEqual([
      "20260416-123456-deadbeef-1.webp",
      "20260416-123456-deadbeef-2.png"
    ]);
  });
});
