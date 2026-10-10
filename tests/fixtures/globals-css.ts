import fs from "node:fs";
import path from "node:path";

export const globalsCss = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

export function findRule(selector: string) {
  return globalsCss
    .match(/[^{}]+{[^{}]+}/g)
    ?.find((rule) =>
      rule
        .slice(0, rule.indexOf("{"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((item) => item.trim())
        .includes(selector)
    );
}

export function expectRuleDeclaration(selector: string, declaration: string) {
  expect(findRule(selector)).toEqual(expect.stringContaining(declaration));
}
