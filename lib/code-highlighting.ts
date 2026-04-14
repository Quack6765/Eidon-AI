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

  if (detection.relevance < AUTO_DETECT_MIN_RELEVANCE) {
    return null;
  }

  return normalizeCodeFenceLanguage(detection.language);
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
