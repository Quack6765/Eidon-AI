import {
  isPluginEnabled,
  getDisabledPlugins,
  isMarkdownRepairEnabled,
} from "@/lib/markdown/feature-flags";

describe("markdown feature flags", () => {
  const originalEnv = process.env.NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS;

  afterEach(() => {
    process.env.NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS = originalEnv;
  });

  it("returns true for every plugin when env var is unset", () => {
    delete process.env.NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS;
    expect(isPluginEnabled("tighten-lists")).toBe(true);
    expect(getDisabledPlugins()).toEqual([]);
  });

  it("returns false for plugins listed in the env var", () => {
    process.env.NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS = "tighten-lists,renumber-ordered-lists";
    expect(isPluginEnabled("tighten-lists")).toBe(false);
    expect(isPluginEnabled("renumber-ordered-lists")).toBe(false);
    expect(isPluginEnabled("split-inline-table")).toBe(true);
  });

  it("ignores whitespace and unknown names in the env var", () => {
    process.env.NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS = "  tighten-lists  , unknown-plugin ";
    expect(isPluginEnabled("tighten-lists")).toBe(false);
    expect(getDisabledPlugins()).toEqual(["tighten-lists"]);
  });

  describe("isMarkdownRepairEnabled", () => {
    const original = process.env.NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED;
    afterEach(() => {
      if (original === undefined) {
        delete process.env.NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED;
      } else {
        process.env.NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED = original;
      }
    });

    it("is disabled by default when env var is unset", () => {
      delete process.env.NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED;
      expect(isMarkdownRepairEnabled()).toBe(false);
    });

    it("is enabled only when set to exactly 'true'", () => {
      process.env.NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED = "true";
      expect(isMarkdownRepairEnabled()).toBe(true);
    });

    it("is disabled for any other value", () => {
      for (const value of ["false", "1", "yes", "TRUE", "on", ""]) {
        process.env.NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED = value;
        expect(isMarkdownRepairEnabled()).toBe(false);
      }
    });
  });
});
