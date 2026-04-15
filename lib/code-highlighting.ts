import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const REGISTERED_LANGUAGES = [
  "bash",
  "css",
  "javascript",
  "json",
  "python",
  "sql",
  "typescript",
  "xml",
  "yaml"
] as const;

const LANGUAGE_ALIASES: Record<string, (typeof REGISTERED_LANGUAGES)[number]> = {
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "bash"
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

const AUTO_DETECT_MIN_RELEVANCE: Record<string, number> = {
  bash: 1,
  sql: 2,
  yaml: 3
};

const highlighter = createHighlighter();

export type HighlightedCodeResult = {
  displayLanguage: string | null;
  html: string;
  language: string | null;
  usedFallback: boolean;
};

export function normalizeCodeFenceLanguage(language?: string | null): string | null {
  if (typeof language !== "string") {
    return null;
  }

  const normalized = language.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function detectCodeLanguage(code: string): string | null {
  const patternLanguage = detectPatternLanguage(code);

  if (patternLanguage) {
    return patternLanguage;
  }

  const detection = highlighter.highlightAuto(code, [...REGISTERED_LANGUAGES]);
  const normalizedLanguage = normalizeCodeFenceLanguage(detection.language);

  // highlightAuto is intentionally filtered here because plain prose often scores as a language.
  if (
    !normalizedLanguage ||
    detection.relevance < getAutoDetectMinRelevance(normalizedLanguage) ||
    isAmbiguousAutoDetection(detection) ||
    !isSupportedAutoDetection(normalizedLanguage, code)
  ) {
    return null;
  }

  return normalizedLanguage;
}

export function renderHighlightedCode(language: string | null | undefined, code: string): HighlightedCodeResult {
  const normalizedLanguage = normalizeCodeFenceLanguage(language);
  const explicitDisplayLanguage = getExplicitDisplayLanguage(language);

  if (normalizedLanguage) {
    if (!highlighter.getLanguage(normalizedLanguage)) {
      return createFallbackResult(code, explicitDisplayLanguage ?? normalizedLanguage);
    }

    return highlightCode(normalizedLanguage, code, explicitDisplayLanguage ?? normalizedLanguage);
  }

  const detectedLanguage = detectCodeLanguage(code);

  if (!detectedLanguage) {
    return createFallbackResult(code, null);
  }

  return highlightCode(detectedLanguage, code, detectedLanguage);
}

function createHighlighter() {
  const instance = hljs.newInstance();

  instance.registerLanguage("bash", bash);
  instance.registerLanguage("css", css);
  instance.registerLanguage("javascript", javascript);
  instance.registerLanguage("json", json);
  instance.registerLanguage("python", python);
  instance.registerLanguage("sql", sql);
  instance.registerLanguage("typescript", typescript);
  instance.registerLanguage("xml", xml);
  instance.registerLanguage("yaml", yaml);

  for (const [languageName, aliases] of Object.entries(groupAliasesByLanguage())) {
    instance.registerAliases(aliases, { languageName });
  }

  return instance;
}

function highlightCode(language: string, code: string, displayLanguage: string): HighlightedCodeResult {
  try {
    return {
      displayLanguage,
      language,
      html: highlighter.highlight(code, { ignoreIllegals: true, language }).value,
      usedFallback: false
    };
  } catch {
    return createFallbackResult(code, displayLanguage);
  }
}

function createFallbackResult(code: string, displayLanguage: string | null): HighlightedCodeResult {
  return {
    displayLanguage,
    html: escapeHtml(code),
    language: null,
    usedFallback: true
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

function getExplicitDisplayLanguage(language?: string | null) {
  if (typeof language !== "string") {
    return null;
  }

  const trimmedLanguage = language.trim();

  return trimmedLanguage || null;
}

function groupAliasesByLanguage() {
  const aliasesByLanguage: Record<string, string[]> = {};

  for (const [alias, language] of Object.entries(LANGUAGE_ALIASES)) {
    aliasesByLanguage[language] ??= [];
    aliasesByLanguage[language].push(alias);
  }

  return aliasesByLanguage;
}

function isAmbiguousAutoDetection(detection: { relevance: number; secondBest?: { relevance: number } | undefined }) {
  return detection.secondBest?.relevance === detection.relevance;
}

function isSupportedAutoDetection(language: string, code: string) {
  switch (language) {
    case "bash":
      return isBashLike(code);
    case "css":
      return isCssLike(code);
    case "sql":
      return isSqlLike(code);
    case "yaml":
      return isYamlLike(code);
    default:
      return true;
  }
}

function isBashLike(code: string) {
  return /(^|\n)\s*(\$|#!\/|(?:[A-Za-z_][\w-]*=)|(?:echo|cat|grep|curl|wget|npm|pnpm|yarn|git|cd|ls|mkdir|rm|cp|mv|node|python|bash|sh|zsh)\b)/.test(
    code
  ) || /(?:\|\||&&|>>?|<<|`)/.test(code);
}

function isCssLike(code: string) {
  return /[{}]/.test(code) || /(^|\n)\s*[.#@a-zA-Z][^{}\n]*:\s*[^;\n]+;/.test(code);
}

function isSqlLike(code: string) {
  return matchesSqlStatement(code.trim());
}

function isYamlLike(code: string) {
  const lines = code.split("\n");
  const contentLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (contentLines.length < 2) {
    return false;
  }

  if (!contentLines.every((line) => /^(?:-\s+)?[A-Za-z0-9_-]+\s*:/.test(line))) {
    return false;
  }

  const hasYamlStructure = lines.some((line) => /^\s+/.test(line)) || lines.some((line) => line.trim().startsWith("#"));

  if (hasYamlStructure) {
    return true;
  }

  const keys = contentLines
    .map((line) => line.match(/^(?:-\s+)?([A-Za-z0-9_-]+)\s*:/)?.[1]?.toLowerCase())
    .filter((key): key is string => Boolean(key));

  return !keys.every((key) => COMMON_LABEL_LIKE_YAML_KEYS.has(key));
}

function getAutoDetectMinRelevance(language: string) {
  return AUTO_DETECT_MIN_RELEVANCE[language] ?? 3;
}

function detectPatternLanguage(code: string) {
  if (isLikelySqlSnippet(code)) {
    return "sql";
  }

  if (isLikelyBashSnippet(code)) {
    return "bash";
  }

  return null;
}

function isLikelySqlSnippet(code: string) {
  return matchesSqlStatement(code.trim());
}

function isLikelyBashSnippet(code: string) {
  return /^\s*(?:git|npm|pnpm|yarn|curl|wget|node|python|bash|sh|zsh)\b/.test(code.trim());
}

const COMMON_LABEL_LIKE_YAML_KEYS = new Set(["name", "role", "status", "title", "email", "phone", "user"]);

function matchesSqlStatement(code: string) {
  return matchesSelectStatement(code) || matchesUpdateStatement(code) || matchesDeleteStatement(code) || matchesInsertStatement(code);
}

function matchesSelectStatement(code: string) {
  const match = code.match(
    /^select\s+([A-Za-z_][\w.]*|\*)(?:\s*,\s*([A-Za-z_][\w.]*|\*))*\s+from\s+([A-Za-z_][\w.]*)(?:\s+(where|join|group\s+by|order\s+by|limit)\b.*)?;?$/i
  );

  return Boolean(match);
}

function matchesUpdateStatement(code: string) {
  return /^update\s+[A-Za-z_][\w.]*\s+set\s+[A-Za-z_][\w.]*\s*=.+$/i.test(code);
}

function matchesDeleteStatement(code: string) {
  return /^delete\s+from\s+[A-Za-z_][\w.]*?(?:\s+where\b.+)?;?$/i.test(code);
}

function matchesInsertStatement(code: string) {
  return /^insert\s+into\s+[A-Za-z_][\w.]*\s*(?:\([^)]*\))?\s+values\s*\(.+\);?$/i.test(code);
}
