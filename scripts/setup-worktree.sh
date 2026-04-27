#!/bin/bash
set -euo pipefail

WORKTREE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(git -C "$WORKTREE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$WORKTREE_DIR")"

find_main_worktree() {
    local wt_dir="$1"
    local my_path="$2"

    git -C "$wt_dir" worktree list --porcelain 2>/dev/null | while read -r line; do
        if [[ "$line" == worktree* ]]; then
            current_wt="${line#worktree }"
        elif [[ "$line" == "branch refs/heads/main"* ]]; then
            if [[ "$current_wt" != "$my_path" ]]; then
                echo "$current_wt"
                return
            fi
        fi
    done
}

MAIN_WT="$(find_main_worktree "$WORKTREE_DIR" "$REPO_ROOT")"

if [ -z "$MAIN_WT" ]; then
    echo "warning: could not find main worktree, falling back to REPO_ROOT=$REPO_ROOT"
    MAIN_WT="$REPO_ROOT"
fi

copy_file_replace() {
    local src="$1"
    local dest="$2"

    if [ ! -e "$src" ]; then
        echo "warning: $src does not exist, skipping"
        return 1
    fi

    cp "$src" "$dest"
    echo "copied: $dest <- $src"
}

copy_data_dir() {
    local src_dir="$1"
    local dest_dir="$2"

    if [ ! -e "$src_dir" ]; then
        echo "warning: $src_dir does not exist, skipping"
        return 1
    fi

    rm -rf "$dest_dir"
    cp -R "$src_dir" "$dest_dir"
    echo "copied: $dest_dir <- $src_dir"
}

echo "Setting up worktree from main: $MAIN_WT"

copy_file_replace "$MAIN_WT/.env" "$WORKTREE_DIR/.env"
copy_data_dir "$MAIN_WT/.data" "$WORKTREE_DIR/.data"

if [ ! -e "$WORKTREE_DIR/node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install --prefix "$WORKTREE_DIR"
fi

echo "Worktree setup complete."
