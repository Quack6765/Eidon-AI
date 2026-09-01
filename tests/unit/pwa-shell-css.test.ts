import fs from "node:fs";
import path from "node:path";

const globalsCss = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

function findRule(selector: string) {
  return globalsCss
    .match(/[^{}]+{[^{}]+}/g)
    ?.find((rule) =>
      rule
        .slice(0, rule.indexOf("{"))
        .split(",")
        .map((item) => item.trim())
        .includes(selector)
    );
}

function expectRuleDeclaration(selector: string, declaration: string) {
  expect(findRule(selector)).toEqual(expect.stringContaining(declaration));
}

describe("PWA shell CSS", () => {
  it("locks the iOS PWA document while preserving scroll containment rules", () => {
    expectRuleDeclaration("html", "overscroll-behavior: none;");
    expectRuleDeclaration("html.ios-pwa", "overflow: hidden;");
    expectRuleDeclaration("html.ios-pwa body", "overflow: hidden;");
    expectRuleDeclaration("body", "overscroll-behavior: none;");
    expectRuleDeclaration(".conversation-scroller", "scrollbar-gutter: auto !important;");
  });
});
