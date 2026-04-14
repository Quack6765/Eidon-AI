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

const AUTO_DETECT_MIN_RELEVANCE = 3;

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
  const detection = highlighter.highlightAuto(code, [...REGISTERED_LANGUAGES]);
  const normalizedLanguage = normalizeCodeFenceLanguage(detection.language);

  if (
    !normalizedLanguage ||
    detection.relevance < AUTO_DETECT_MIN_RELEVANCE ||
    isAmbiguousAutoDetection(detection) ||
    !isSupportedAutoDetection(normalizedLanguage, code)
  ) {
    return null;
  }

  return normalizedLanguage;
}

export function renderHighlightedCode(language: string | null | undefined, code: string): HighlightedCodeResult {
  const normalizedLanguage = normalizeCodeFenceLanguage(language);

  if (normalizedLanguage) {
    if (!highlighter.getLanguage(normalizedLanguage)) {
      return createFallbackResult(code, normalizedLanguage);
    }

    return highlightCode(normalizedLanguage, code, normalizedLanguage);
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
  const keywordMatches = code.match(
    /\b(select|from|where|join|insert|into|values|update|set|delete|create|table|alter|drop|with|group\s+by|order\s+by|having|limit)\b/gi
  );

  return new Set(keywordMatches?.map((match) => match.toLowerCase()) ?? []).size >= 2;
}

function isYamlLike(code: string) {
  const lines = code.split("\n").map((line) => line.trim()).filter(Boolean);

  if (lines.length < 2) {
    return false;
  }

  return lines.every((line) => /^(?:-\s+)?[a-z0-9_-]+\s*:/.test(line));
}
