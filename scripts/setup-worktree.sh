#!/bin/bash
set -euo pipefail

WORKTREE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_WT="$(git -C "$WORKTREE_DIR" worktree list | head -1 | awk '{print $1}')"

link_file() {
    local src="$1"
    local dest="$2"
    if [ ! -e "$src" ]; then
        echo "warning: $src does not exist, skipping"
        return 1
    fi
    if [ -L "$dest" ] || [ -e "$dest" ]; then
        echo "already exists: $dest"
        return 0
    fi
    ln -s "$src" "$dest"
    echo "linked: $dest -> $src"
}

echo "Setting up worktree from main: $MAIN_WT"

link_file "$MAIN_WT/.env" "$WORKTREE_DIR/.env"
link_file "$MAIN_WT/.data" "$WORKTREE_DIR/.data"
