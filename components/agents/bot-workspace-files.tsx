"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import {
  AttachmentPreviewModal,
  AttachmentUrlProvider,
  useAttachmentPreviewController,
  type AttachmentUrlBuilder
} from "@/components/attachment-preview-modal";
import type { BotWorkspaceNode, BotWorkspaceScope } from "@/lib/bot-sandbox";

function WorkspaceTreeNode({
  node,
  label,
  scope,
  emptyLabel,
  openPaths,
  onToggle,
  onOpenFile,
  depth
}: {
  node: BotWorkspaceNode;
  label?: string;
  scope: BotWorkspaceScope;
  emptyLabel: string;
  openPaths: string[];
  onToggle: (key: string) => void;
  onOpenFile: (scope: BotWorkspaceScope, node: BotWorkspaceNode) => void;
  depth: number;
}) {
  const key = `${scope}:${node.path}`;
  const isOpen = openPaths.includes(key);
  if (node.isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(key)}
          aria-expanded={isOpen}
          className={`flex w-full items-center gap-1 rounded-md py-[3px] pr-2 text-left text-[11px] transition-colors hover:text-[#f4f4f5] ${
            depth === 0 ? "text-[#f4f4f5]" : "text-white/60"
          }`}
          style={{ paddingLeft: depth * 10 + 4, fontSize: 11 }}
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-[#71717a] transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          {isOpen ? (
            <FolderOpen className="h-3 w-3 shrink-0 text-[#a1a1aa]" aria-hidden="true" />
          ) : (
            <Folder className="h-3 w-3 shrink-0 text-[#a1a1aa]" aria-hidden="true" />
          )}
          <span className="truncate" title={label ?? node.name}>{label ?? node.name}</span>
        </button>
        {isOpen ? (
          <div>
            {node.children.length === 0 && depth === 0 ? (
              <p className="py-[3px] pr-2 text-[11px] text-[var(--muted)]" style={{ paddingLeft: 10 + 4 + 18, fontSize: 11 }}>
                {emptyLabel}
              </p>
            ) : (
              node.children.map((child) => (
                <WorkspaceTreeNode
                  key={child.path}
                  node={child}
                  scope={scope}
                  emptyLabel={emptyLabel}
                  openPaths={openPaths}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                  depth={depth + 1}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenFile(scope, node)}
      aria-label={`Open ${node.name}`}
      className="group flex w-full items-center gap-1 rounded-md py-[3px] pr-2 text-left text-[11px] text-white/60 transition-colors hover:text-[#f4f4f5]"
      style={{ paddingLeft: depth * 10 + 4, fontSize: 11 }}
    >
      <span className="w-3 shrink-0" aria-hidden="true" />
      <FileText className="h-3 w-3 shrink-0 text-[#71717a] transition-colors group-hover:text-[#a1a1aa]" aria-hidden="true" />
      <span className="truncate" title={node.name}>{node.name}</span>
    </button>
  );
}

function WorkspaceFileBrowser({
  botId,
  botName,
  tree,
  sharedTree,
  version
}: {
  botId: string;
  botName: string;
  tree: BotWorkspaceNode;
  sharedTree: BotWorkspaceNode;
  version: number;
}) {
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const { previewAttachment, previewState, openAttachmentPreview, closeAttachmentPreview } =
    useAttachmentPreviewController();

  const toggle = useCallback((key: string) => {
    setOpenPaths((prev) => (prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]));
  }, []);

  const openFile = useCallback(
    (scope: BotWorkspaceScope, node: BotWorkspaceNode) => {
      const params = new URLSearchParams({ scope, path: node.path, v: String(version) });
      void openAttachmentPreview({
        id: `/api/bots/${encodeURIComponent(botId)}/workspace/file?${params.toString()}`,
        filename: node.name,
        mimeType: node.mimeType ?? "application/octet-stream",
        kind: node.kind ?? "file",
        byteSize: node.byteSize,
        createdAt: ""
      });
    },
    [botId, openAttachmentPreview, version]
  );

  return (
    <>
      <div className="space-y-1 rounded-xl border border-white/6 bg-white/[0.02] p-2">
        <WorkspaceTreeNode
          node={tree}
          label={botName}
          scope="bot"
          emptyLabel="No workspace files yet."
          openPaths={openPaths}
          onToggle={toggle}
          onOpenFile={openFile}
          depth={0}
        />
        <WorkspaceTreeNode
          node={sharedTree}
          scope="shared"
          emptyLabel="No shared files yet."
          openPaths={openPaths}
          onToggle={toggle}
          onOpenFile={openFile}
          depth={0}
        />
      </div>
      {previewAttachment
        ? createPortal(
            <div>
              <AttachmentPreviewModal
                attachment={previewAttachment}
                state={previewState}
                onClose={closeAttachmentPreview}
                onRetry={() => void openAttachmentPreview(previewAttachment)}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

const buildWorkspaceFileUrl: AttachmentUrlBuilder = (file, options) =>
  `${file.id}${options?.format ? `&format=${options.format}` : ""}${options?.download ? "&download=1" : ""}`;

export function BotWorkspaceFiles(props: {
  botId: string;
  botName: string;
  tree: BotWorkspaceNode;
  sharedTree: BotWorkspaceNode;
  version: number;
}) {
  return (
    <AttachmentUrlProvider value={buildWorkspaceFileUrl}>
      <WorkspaceFileBrowser {...props} />
    </AttachmentUrlProvider>
  );
}
