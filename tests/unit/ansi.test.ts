import { parseAnsiText } from "@/lib/ansi";

describe("ansi text parser", () => {
  it("parses foreground colors and reset sequences into styled segments", () => {
    expect(parseAnsiText("\u001b[32m✓\u001b[0m ok \u001b[31mnope\u001b[0m")).toEqual([
      {
        text: "✓",
        foregroundColor: "green",
        bold: false
      },
      {
        text: " ok ",
        foregroundColor: null,
        bold: false
      },
      {
        text: "nope",
        foregroundColor: "red",
        bold: false
      }
    ]);
  });

  it("tracks bold independently from foreground colors", () => {
    expect(parseAnsiText("\u001b[1mstrong\u001b[22m plain")).toEqual([
      {
        text: "strong",
        foregroundColor: null,
        bold: true
      },
      {
        text: " plain",
        foregroundColor: null,
        bold: false
      }
    ]);
  });
});
