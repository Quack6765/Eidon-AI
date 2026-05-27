import type { Pluggable, PluggableList } from "unified";
import { PLUGIN_ORDER, type PluginName } from "../types";
import { isPluginEnabled } from "../feature-flags";
import remarkFixBlockSpacing from "./remark-fix-block-spacing";
import remarkExtractInlineThematicBreaks from "./remark-extract-inline-thematic-breaks";
import remarkSplitInlineTable from "./remark-split-inline-table";
import remarkFixInlineFences from "./remark-fix-inline-fences";
import remarkMergeUnclosedInlineCode from "./remark-merge-unclosed-inline-code";
import remarkCloseUnbalancedEmphasis from "./remark-close-unbalanced-emphasis";
import remarkNormalizeMixedEmphasis from "./remark-normalize-mixed-emphasis";
import remarkNormalizeListIndentation from "./remark-normalize-list-indentation";
import remarkMergeOrphanedListFragments from "./remark-merge-orphaned-list-fragments";
import remarkRenumberOrderedLists from "./remark-renumber-ordered-lists";
import remarkTightenLists from "./remark-tighten-lists";
import remarkNormalizeBlockquoteNesting from "./remark-normalize-blockquote-nesting";

const REGISTRY: Record<PluginName, Pluggable | undefined> = {
  "fix-block-spacing": remarkFixBlockSpacing,
  "extract-inline-thematic-breaks": remarkExtractInlineThematicBreaks,
  "split-inline-table": remarkSplitInlineTable,
  "fix-inline-fences": remarkFixInlineFences,
  "merge-unclosed-inline-code": remarkMergeUnclosedInlineCode,
  "close-unbalanced-emphasis": remarkCloseUnbalancedEmphasis,
  "normalize-mixed-emphasis": remarkNormalizeMixedEmphasis,
  "normalize-list-indentation": remarkNormalizeListIndentation,
  "merge-orphaned-list-fragments": remarkMergeOrphanedListFragments,
  "renumber-ordered-lists": remarkRenumberOrderedLists,
  "tighten-lists": remarkTightenLists,
  "normalize-blockquote-nesting": remarkNormalizeBlockquoteNesting,
};

/**
 * Ordered list of remark AST normalization plugins applied to assistant markdown.
 * These are passed as `remarkPlugins` to Streamdown, which adds its own built-in
 * defaults (GFM, code-meta) separately. Each plugin is registered above in the
 * order it should run. The array filters out plugins disabled via the
 * NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS env var.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = PLUGIN_ORDER
  .filter((name) => isPluginEnabled(name) && REGISTRY[name] !== undefined)
  .map((name) => REGISTRY[name] as Pluggable);
