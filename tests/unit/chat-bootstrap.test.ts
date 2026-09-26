// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { consumeComposerDraft, storeComposerDraft } from "@/lib/chat-bootstrap";

describe("composer draft handoff", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("hands a draft to the next conversation exactly once", () => {
    storeComposerDraft("conv_fork", { content: "Try it this way", attachments: [] });

    expect(consumeComposerDraft("conv_other")).toBeNull();
    expect(consumeComposerDraft("conv_fork")).toEqual({ content: "Try it this way", attachments: [] });
    expect(consumeComposerDraft("conv_fork")).toBeNull();
  });

  it("drops a malformed draft and fills in missing fields", () => {
    sessionStorage.setItem("eidon:composer-draft:conv_bad", "{not json");
    sessionStorage.setItem("eidon:composer-draft:conv_partial", JSON.stringify({ attachments: "nope" }));

    expect(consumeComposerDraft("conv_bad")).toBeNull();
    expect(sessionStorage.getItem("eidon:composer-draft:conv_bad")).toBeNull();
    expect(consumeComposerDraft("conv_partial")).toEqual({ content: "", attachments: [] });
  });
});
