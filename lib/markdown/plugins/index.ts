import type { Pluggable, PluggableList } from "unified";
import { defaultRemarkPlugins } from "streamdown";
import { PLUGIN_ORDER, type PluginName } from "../types";
import { isPluginEnabled, isMarkdownRepairEnabled } from "../feature-flags";
import remarkFixBlockSpacing from "./remark-fix-block-spacing";
import remarkExtractInlineThematicBreaks from "./remark-extract-inline-thematic-breaks";
import remarkSplitInlineTable from "./remark-split-inline-table";
import remarkFixInlineFences from "./remark-fix-inline-fences";
import remarkMergeUnclosedInlineCode from "./remark-merge-unclosed-inline-code";
import remarkCloseUnbalancedEmphasis from "./remark-close-unbalanced-emphasis";
import remarkNormalizeMixedEmphasis from "./remark-normalize-mixed-emphasis";
import remarkSplitInlineListMarkers from "./remark-split-inline-list-markers";
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
  "split-inline-list-markers": remarkSplitInlineListMarkers,
  "normalize-list-indentation": remarkNormalizeListIndentation,
  "merge-orphaned-list-fragments": remarkMergeOrphanedListFragments,
  "renumber-ordered-lists": remarkRenumberOrderedLists,
  "tighten-lists": remarkTightenLists,
  "normalize-blockquote-nesting": remarkNormalizeBlockquoteNesting,
};

/**
 * The 12 AST normalization plugins, in pipeline order, with disabled ones
 * filtered out via the NEXT_PUBLIC_MARKDOWN_DISABLED_PLUGINS env var. Use this
 * export in unit tests and any pipeline that explicitly adds remark-gfm.
 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = PLUGIN_ORDER
  .filter((name) => isPluginEnabled(name) && REGISTRY[name] !== undefined)
  .map((name) => REGISTRY[name] as Pluggable);

/**
 * The runtime plugin list passed to Streamdown's `remarkPlugins` prop.
 * Streamdown REPLACES its internal default plugins (GFM, code-meta) when this
 * prop is provided, so we must explicitly prepend its defaults to retain
 * GFM-only features (tables, strikethrough, task-list checkboxes, autolinks).
 */
export const STREAMDOWN_REMARK_PLUGINS: PluggableList = [
  ...(Object.values(defaultRemarkPlugins) as PluggableList),
  ...(isMarkdownRepairEnabled() ? MARKDOWN_REMARK_PLUGINS : []),
];
