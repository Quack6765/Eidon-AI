import { describe, it, expect, afterEach, vi } from "vitest";

const REPAIR_ENV = "NEXT_PUBLIC_MARKDOWN_REPAIR_ENABLED";

async function loadIndex(repairEnabled: boolean) {
  vi.resetModules();
  if (repairEnabled) {
    process.env[REPAIR_ENV] = "true";
  } else {
    delete process.env[REPAIR_ENV];
  }
  return import("@/lib/markdown/plugins");
}

describe("markdown plugins index — global repair toggle", () => {
  const original = process.env[REPAIR_ENV];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[REPAIR_ENV];
    } else {
      process.env[REPAIR_ENV] = original;
    }
    vi.resetModules();
  });

  it("MARKDOWN_REMARK_PLUGINS always lists the custom plugins regardless of toggle", async () => {
    const off = await loadIndex(false);
    const on = await loadIndex(true);
    expect(off.MARKDOWN_REMARK_PLUGINS.length).toBeGreaterThan(0);
    expect(on.MARKDOWN_REMARK_PLUGINS.length).toBe(off.MARKDOWN_REMARK_PLUGINS.length);
  });

  it("STREAMDOWN_REMARK_PLUGINS excludes custom plugins when repair is disabled (default)", async () => {
    const off = await loadIndex(false);
    // None of the custom repair plugins should be present in the runtime list.
    for (const custom of off.MARKDOWN_REMARK_PLUGINS) {
      expect(off.STREAMDOWN_REMARK_PLUGINS).not.toContain(custom);
    }
  });

  it("STREAMDOWN_REMARK_PLUGINS includes custom plugins when repair is enabled", async () => {
    const on = await loadIndex(true);
    expect(on.STREAMDOWN_REMARK_PLUGINS).toEqual(
      expect.arrayContaining(on.MARKDOWN_REMARK_PLUGINS)
    );
  });

  it("enabling repair adds exactly the custom plugins on top of the disabled baseline", async () => {
    const off = await loadIndex(false);
    const offCount = off.STREAMDOWN_REMARK_PLUGINS.length;
    const customCount = off.MARKDOWN_REMARK_PLUGINS.length;
    const on = await loadIndex(true);
    expect(on.STREAMDOWN_REMARK_PLUGINS.length).toBe(offCount + customCount);
  });
});
