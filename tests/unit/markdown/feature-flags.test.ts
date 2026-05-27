import { isPluginEnabled, getDisabledPlugins } from "@/lib/markdown/feature-flags";

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
});
