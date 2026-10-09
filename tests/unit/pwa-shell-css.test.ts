import { expectRuleDeclaration } from "@/tests/fixtures/globals-css";

describe("PWA shell CSS", () => {
  it("locks the iOS PWA document while preserving scroll containment rules", () => {
    expectRuleDeclaration("html", "overscroll-behavior: none;");
    expectRuleDeclaration("html.ios-pwa", "overflow: hidden;");
    expectRuleDeclaration("html.ios-pwa body", "overflow: hidden;");
    expectRuleDeclaration("body", "overscroll-behavior: none;");
    expectRuleDeclaration(".conversation-scroller", "scrollbar-gutter: auto !important;");
  });
});
