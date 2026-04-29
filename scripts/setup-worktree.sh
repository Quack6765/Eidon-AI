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

if [ -n "${EIDON_SETUP_SOURCE_DIR:-}" ]; then
    SOURCE_WT="$(cd "$EIDON_SETUP_SOURCE_DIR" && pwd)"
    SOURCE_LABEL="EIDON_SETUP_SOURCE_DIR"
else
    SOURCE_WT="$MAIN_WT"
    SOURCE_LABEL="main"
fi

copy_file_replace() {
    local src="$1"
    local dest="$2"

    if [ ! -e "$src" ]; then
        echo "warning: $src does not exist, skipping"
        return 1
    fi

    if [ -e "$dest" ]; then
        local canonical_src
        local canonical_dest
        canonical_src="$(canonical_existing_file "$src")"
        canonical_dest="$(canonical_existing_file "$dest")"

        if [ "$canonical_src" = "$canonical_dest" ]; then
            echo "source and destination env files are the same; skipping env copy: $src"
            return 0
        fi
    fi

    cp "$src" "$dest"
    echo "copied: $dest <- $src"
}

canonical_existing_path() {
    local path_to_resolve="$1"

    cd "$path_to_resolve" && pwd -P
}

canonical_existing_file() {
    local path_to_resolve="$1"
    local dir
    dir="$(cd "$(dirname "$path_to_resolve")" && pwd -P)"

    echo "$dir/$(basename "$path_to_resolve")"
}

copy_data_dir() {
    local src_dir="$1"
    local dest_dir="$2"

    if [ ! -e "$src_dir" ]; then
        echo "error: source data directory $src_dir does not exist; refusing to launch with seeded default providers only" >&2
        return 1
    fi

    if [ -e "$dest_dir" ]; then
        local canonical_src
        local canonical_dest
        canonical_src="$(canonical_existing_path "$src_dir")"
        canonical_dest="$(canonical_existing_path "$dest_dir")"

        if [ "$canonical_src" = "$canonical_dest" ]; then
            echo "source and destination data directories are the same; skipping data copy: $src_dir"
            return 0
        fi
    fi

    rm -rf "$dest_dir"
    cp -R "$src_dir" "$dest_dir"
    echo "copied: $dest_dir <- $src_dir"
}

SOURCE_DATA_DIR="$SOURCE_WT/.data"
DEST_DATA_DIR="$WORKTREE_DIR/.data"

echo "Setting up worktree from $SOURCE_LABEL: $SOURCE_WT"

copy_file_replace "$SOURCE_WT/.env" "$WORKTREE_DIR/.env"
copy_data_dir "$SOURCE_DATA_DIR" "$DEST_DATA_DIR"

if [ ! -e "$WORKTREE_DIR/node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install --prefix "$WORKTREE_DIR"
fi

echo "Worktree setup complete."
