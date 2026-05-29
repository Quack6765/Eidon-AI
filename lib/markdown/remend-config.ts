import type { RemendOptions } from "remend";

/**
 * Explicit configuration for the remend incomplete-syntax preprocessor that
 * runs inside Streamdown. Surfacing the config (rather than relying on remend's
 * defaults) makes the split between "complete incomplete syntax" (remend) and
 * "repair structural malformations" (our plugins) visible at the call site.
 */
export const REMEND_OPTIONS: RemendOptions = {
  bold: true,
  italic: true,
  boldItalic: true,
  strikethrough: true,
  inlineCode: true,
  links: true,
  images: true,
  katex: true,
  inlineKatex: false,
  htmlTags: true,
  setextHeadings: true,
  singleTilde: true,
  comparisonOperators: true,
  linkMode: "protocol",
};
