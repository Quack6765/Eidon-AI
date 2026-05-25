import { normalizeMarkdown } from "@/lib/markdown-normalization";

describe("normalizeMarkdown", () => {
  describe("inline bullet markers", () => {
    it("splits inline * marker after emphasis on list item line into sub-item", () => {
      expect(normalizeMarkdown("* **Hardware**  * Sub-item")).toBe(
        "* **Hardware**\n  * Sub-item"
      );
    });

    it("splits inline * marker after text on list item line into sub-item", () => {
      expect(normalizeMarkdown("* item * sub")).toBe("* item\n  * sub");
    });

    it("splits inline * marker on non-list line at same indent", () => {
      expect(normalizeMarkdown("text * item")).toBe("text\n\n* item");
    });

    it("splits inline + marker on list item line", () => {
      expect(normalizeMarkdown("* item + sub")).toBe("* item\n  + sub");
    });

    it("splits * * item as emphasis-list on list line", () => {
      expect(normalizeMarkdown("* * item")).toBe("*\n  * item");
    });

    it("does not split when before char is +", () => {
      expect(normalizeMarkdown("+ + item")).toBe("+ + item");
    });

    it("preserves 5 * 3 as multiplication", () => {
      expect(normalizeMarkdown("5 * 3")).toBe("5 * 3");
    });

    it("splits inline * marker with no space after text", () => {
      expect(normalizeMarkdown("word* item")).toBe("word\n\n* item");
    });

    it("does not split no-space when before char is *", () => {
      expect(normalizeMarkdown("*** item")).toBe("*** item");
    });

    it("does not split no-space digit guard", () => {
      expect(normalizeMarkdown("5*3")).toBe("5*3");
    });
  });

  describe("nested inline markers", () => {
    it("produces correct multi-level nesting from collapsed inline markers", () => {
      const result = normalizeMarkdown(
        "* **Hardware**  * Consumer Electronics    * Smart Home"
      );
      expect(result).toBe(
        "* **Hardware**\n  * Consumer Electronics\n    * Smart Home"
      );
    });

    it("indents sub-items deeper on already-indented list lines", () => {
      const result = normalizeMarkdown(
        "  * Consumer Electronics    * Smart Home"
      );
      expect(result).toBe(
        "  * Consumer Electronics\n    * Smart Home"
      );
    });
  });

  describe("inline ordered markers", () => {
    it("splits inline ordered marker after text", () => {
      expect(normalizeMarkdown("text3. item")).toBe("text\n\n3. item");
    });

    it("does not split when before char is a digit (version number)", () => {
      expect(normalizeMarkdown("v1.2 item")).toBe("v1.2 item");
    });
  });

  describe("inline dash markers", () => {
    it("splits inline dash marker after text", () => {
      expect(normalizeMarkdown("text- item")).toBe("text\n\n- item");
    });

    it("does not split when before char is |", () => {
      expect(normalizeMarkdown("text| - item")).toBe("text| - item");
    });

    it("does not split when before char is >", () => {
      expect(normalizeMarkdown("text> - item")).toBe("text> - item");
    });

    it("does not split when before char is -", () => {
      expect(normalizeMarkdown("text-- item")).toBe("text-- item");
    });
  });

  describe("inline heading markers", () => {
    it("splits inline heading marker immediately after text", () => {
      expect(normalizeMarkdown("text## Heading")).toBe("text\n\n## Heading");
    });

    it("does not split heading after space", () => {
      expect(normalizeMarkdown("text ## Heading")).toBe("text ## Heading");
    });
  });

  describe("inline table markers", () => {
    it("splits inline table opener after text", () => {
      expect(normalizeMarkdown("text| data")).toBe("text\n\n| data");
    });
  });

  describe("inline blockquote markers", () => {
    it("splits inline nested blockquote after emphasis on list line", () => {
      const result = normalizeMarkdown("* **bold**  > > nested");
      expect(result).toBe("* **bold**\n\n  > > nested");
    });

    it("splits inline nested blockquote after text", () => {
      expect(normalizeMarkdown("text  > > nested")).toBe("text\n\n> > nested");
    });

    it("does not split when before char is >", () => {
      expect(normalizeMarkdown("> > > deep")).toBe("> > > deep");
    });

    it("does not split comparison operator >= with digits", () => {
      expect(normalizeMarkdown("x >= 3 > > deep")).toBe("x >= 3\n\n> > deep");
    });

    it("does not split digit guard for blockquote", () => {
      const result = normalizeMarkdown("5 > > deep");
      expect(result).toContain("5");
      expect(result).toContain("> > deep");
    });
  });

  describe("ATX heading fix", () => {
    it("adds space after # when missing", () => {
      expect(normalizeMarkdown("##Heading")).toBe("## Heading");
    });
  });

  describe("horizontal rule fusion fix", () => {
    it("separates fused --- before text", () => {
      const result = normalizeMarkdown("text---more");
      expect(result).toContain("---");
    });
  });

  describe("code fence protection", () => {
    it("does not modify content inside code fences", () => {
      const input = "```\n* item * sub\n```";
      expect(normalizeMarkdown(input)).toBe(input);
    });
  });

  describe("horizontal rule fusion", () => {
    it("separates --- fused after text", () => {
      const result = normalizeMarkdown("some text---");
      expect(result).toContain("---");
      expect(result).not.toBe("some text---");
    });

    it("separates --- fused before text", () => {
      const result = normalizeMarkdown("---some text");
      expect(result).toContain("---");
      expect(result).not.toBe("---some text");
    });

    it("separates --- fused between text", () => {
      const result = normalizeMarkdown("text---more");
      expect(result).toContain("---");
    });
  });

  describe("blank line enforcement", () => {
    it("inserts blank line before heading after paragraph", () => {
      const result = normalizeMarkdown("Some text\n## Heading");
      expect(result).toBe("Some text\n\n## Heading");
    });

    it("inserts blank line before code fence", () => {
      const result = normalizeMarkdown("Some text\n```js\ncode\n```");
      expect(result).toContain("Some text\n\n```");
    });

    it("preserves existing blank lines", () => {
      const input = "Some text\n\n## Heading";
      expect(normalizeMarkdown(input)).toBe(input);
    });

    it("inserts blank line between list and heading", () => {
      const result = normalizeMarkdown("- item\n- item2\n## Heading");
      expect(result).toContain("- item2\n\n## Heading");
    });
  });

  describe("collapsed table rows", () => {
    it("splits || into separate rows", () => {
      const result = normalizeMarkdown("|a||b|");
      expect(result).toBe("|a|\n|b|");
    });
  });

  describe("code fence protection (extended)", () => {
    it("does not modify inline markers inside code fences", () => {
      const input = "```\n* item * sub\n```";
      expect(normalizeMarkdown(input)).toBe(input);
    });

    it("does not modify ATX heading inside code fences", () => {
      const input = "```\n##NoSpace\n```";
      expect(normalizeMarkdown(input)).toBe(input);
    });

    it("normalizes outside code fences but preserves inside", () => {
      const result = normalizeMarkdown("text## Heading\n```\ntext- not a list\n```\nmore- item");
      expect(result).toContain("## Heading");
      expect(result).toContain("text- not a list");
      expect(result).toContain("- item");
    });
  });

  describe("combined scenarios", () => {
    it("handles multiple issues in one document", () => {
      const result = normalizeMarkdown(
        "Intro## Overview\ntext- item1- item2\n```\nraw## code\n```\n##NoSpace"
      );
      expect(result).toContain("## Overview");
      expect(result).toContain("- item1");
      expect(result).toContain("raw## code");
      expect(result).toContain("## NoSpace");
    });

    it("is idempotent", () => {
      const input = "text- item\n##Heading";
      const first = normalizeMarkdown(input);
      const second = normalizeMarkdown(first);
      expect(second).toBe(first);
    });
  });

  describe("triple backtick after text", () => {
    it("separates closing fence from text", () => {
      const result = normalizeMarkdown("--set resources.limits.memory=8Gi```");
      expect(result).toBe("--set resources.limits.memory=8Gi\n\n```");
    });

    it("separates opening fence from text", () => {
      const result = normalizeMarkdown("some code:```");
      expect(result).toContain("some code:\n\n```");
    });
  });

  describe("ordered list after closing paren", () => {
    it("splits ordered list after closing parenthesis", () => {
      const result = normalizeMarkdown(
        "Docker Engine (version 24.0+)2. Kubernetes cluster (v1.28+)"
      );
      expect(result).toContain("24.0+)\n\n2. Kubernetes");
    });

    it("preserves version number in parentheses", () => {
      expect(normalizeMarkdown("requires (v2.0) to run")).toBe(
        "requires (v2.0) to run"
      );
    });
  });

  describe("space before ordered list marker", () => {
    it("splits ordered list after space when not a decimal number", () => {
      const result = normalizeMarkdown(
        "1. Minimum16 GB RAM 2.8 CPU cores 3. 100 GB SSD storage"
      );
      expect(result).toContain("CPU cores\n3. 100 GB SSD storage");
    });

    it("preserves decimal numbers like 2.8", () => {
      expect(normalizeMarkdown("RAM 2.8 GHz")).toBe("RAM 2.8 GHz");
    });

    it("preserves IP addresses", () => {
      expect(normalizeMarkdown("192.168.1.1")).toBe("192.168.1.1");
    });
  });

  describe("unclosed inline before list", () => {
    it("closes unclosed italic before bullet list", () => {
      const result = normalizeMarkdown(
        "Contains *confidential\n* information regarding"
      );
      expect(result).toContain("*confidential*");
      expect(result).toContain("\n\n* information");
    });

    it("closes unclosed bold before bullet list", () => {
      const result = normalizeMarkdown(
        "Contains **confidential\n* information regarding"
      );
      expect(result).toContain("**confidential**");
    });

    it("does not add closer when italic is already closed", () => {
      const result = normalizeMarkdown(
        "This is *confidential*\n* next item"
      );
      expect(result).toBe("This is *confidential*\n\n* next item");
    });

    it("does not close italic when next line is not a list", () => {
      const result = normalizeMarkdown(
        "Contains *confidential\nSome other text"
      );
      expect(result).toBe("Contains *confidential\nSome other text");
    });

    it("preserves multiplication before list", () => {
      const result = normalizeMarkdown("5 * 3 equals 15\n* list item");
      expect(result).toContain("5 * 3 equals 15");
    });

    it("closes unclosed italic before dash list", () => {
      const result = normalizeMarkdown(
        "Contains *confidential\n- information regarding"
      );
      expect(result).toContain("*confidential*");
    });
  });
});
