#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="$PROJECT_DIR/.github/readme"
DEV_SERVER_FILE="$PROJECT_DIR/.dev-server"
EIDON_DATA_DIR="$PROJECT_DIR/.context/readme-demo-data"
DEV_SERVER_PID=""
AB="agent-browser"

for cmd in jq curl agent-browser; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd is required but not found in PATH" >&2; exit 1; }
done

mkdir -p "$SCREENSHOT_DIR"

cleanup() {
    echo "Cleaning up..."
    "$AB" close --all 2>/dev/null || true
    if [ -n "$DEV_SERVER_PID" ] && kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
        kill "$DEV_SERVER_PID" 2>/dev/null || true
        wait "$DEV_SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$DEV_SERVER_FILE"
    echo "Cleanup complete."
}
trap cleanup EXIT

echo "==> Seeding README demo data..."
SEED_OUTPUT=$(npm run seed:readme-demo --prefix "$PROJECT_DIR" --silent)
if ! echo "$SEED_OUTPUT" | jq -e . > /dev/null 2>&1; then
    echo "ERROR: seed:readme-demo did not return valid JSON:" >&2
    echo "$SEED_OUTPUT" >&2
    exit 1
fi

PRIMARY_CONV_ID=$(echo "$SEED_OUTPUT" | jq -r '.seeded.primaryConversationId')
AUTOMATION_ID=$(echo "$SEED_OUTPUT" | jq -r '.seeded.automationId')
AUTOMATION_RUN_ID=$(echo "$SEED_OUTPUT" | jq -r '.seeded.automationRunId')
AUTOMATION_CONV_ID=$(echo "$SEED_OUTPUT" | jq -r '.seeded.automationConversationId')

echo "  primaryConversationId:   $PRIMARY_CONV_ID"
echo "  automationId:            $AUTOMATION_ID"
echo "  automationRunId:         $AUTOMATION_RUN_ID"
echo "  automationConversationId: $AUTOMATION_CONV_ID"

echo "==> Starting dev server..."
rm -f "$DEV_SERVER_FILE"
EIDON_DATA_DIR="$EIDON_DATA_DIR" npm run dev --prefix "$PROJECT_DIR" &
DEV_SERVER_PID=$!

echo "  Waiting for dev server (PID $DEV_SERVER_PID)..."

MAX_WAIT=60
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if [ -f "$DEV_SERVER_FILE" ]; then
        BASE_URL=$(head -1 "$DEV_SERVER_FILE")
        if [ -n "$BASE_URL" ]; then
            if curl -sf -o /dev/null "$BASE_URL" 2>/dev/null; then
                echo "  Dev server ready at $BASE_URL"
                break
            fi
        fi
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "ERROR: Dev server did not start within ${MAX_WAIT}s" >&2
    exit 1
fi

click_openrouter_and_wait() {
    local ref
    ref=$("$AB" snapshot -i | grep -i "openrouter\|claude" | head -1 | grep -o '@e[0-9]*' || true)
    if [ -z "$ref" ]; then
        echo "  WARNING: Could not find OpenRouter element ref, trying full snapshot" >&2
        ref=$("$AB" snapshot | grep -i "openrouter\|claude" | head -1 | grep -o '@e[0-9]*' || true)
    fi
    if [ -z "$ref" ]; then
        echo "  WARNING: Could not find OpenRouter element ref in snapshot" >&2
        return
    fi
    "$AB" click "$ref"
    "$AB" wait --load networkidle
    "$AB" wait 1000
}

ensure_desktop_sidebar_open() {
    "$AB" eval "sessionStorage.removeItem('eidon:sidebar:user-closed')" 2>/dev/null || true
    "$AB" wait 500
    local toggle_ref
    toggle_ref=$("$AB" snapshot -i 2>/dev/null | grep -i "show sidebar\|expand sidebar\|panel" | head -1 | grep -o '@e[0-9]*' || true)
    if [ -n "$toggle_ref" ]; then
        "$AB" click "$toggle_ref" 2>/dev/null || true
        "$AB" wait 1000
    fi
    "$AB" eval "document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove())" 2>/dev/null || true
}

echo "==> Setting desktop viewport (1920x1080)..."
"$AB" set viewport 1920 1080

echo "==> Capturing desktop-chat.png..."
"$AB" open "$BASE_URL/chat/$PRIMARY_CONV_ID"
"$AB" wait --load networkidle
"$AB" wait 3000
ensure_desktop_sidebar_open
CHAT_TEXT=$("$AB" get text "main" 2>/dev/null || echo "")
if echo "$CHAT_TEXT" | grep -q "April launch" 2>/dev/null; then
    echo "  Chat content loaded"
else
    echo "  Waiting for chat content to render..."
    for i in $(seq 1 6); do
        "$AB" wait 2000
        CHAT_TEXT=$("$AB" get text "main" 2>/dev/null || echo "")
        echo "$CHAT_TEXT" | grep -q "April launch" 2>/dev/null && break
    done
fi
"$AB" screenshot "$SCREENSHOT_DIR/desktop-chat.png"
echo "  Saved desktop-chat.png"

echo "==> Capturing desktop-providers.png..."
"$AB" open "$BASE_URL/settings/providers"
"$AB" wait --load networkidle
"$AB" wait 2000
click_openrouter_and_wait
"$AB" screenshot "$SCREENSHOT_DIR/desktop-providers.png"
echo "  Saved desktop-providers.png"

echo "==> Capturing desktop-automations.png..."
"$AB" open "$BASE_URL/automations/$AUTOMATION_ID"
"$AB" wait --load networkidle
"$AB" wait 2000
"$AB" screenshot "$SCREENSHOT_DIR/desktop-automations.png"
echo "  Saved desktop-automations.png"

echo "==> Setting mobile viewport (390x844)..."
"$AB" set viewport 390 844

echo "==> Capturing mobile-chat.png..."
"$AB" open "$BASE_URL/chat/$PRIMARY_CONV_ID"
"$AB" wait --load networkidle
"$AB" wait 3000
"$AB" screenshot "$SCREENSHOT_DIR/mobile-chat.png"
echo "  Saved mobile-chat.png"

echo "==> Capturing mobile-providers.png..."
"$AB" open "$BASE_URL/settings/providers"
"$AB" wait --load networkidle
"$AB" wait 2000
PROVIDERS_REF=$("$AB" snapshot -i | grep -i "providers" | head -1 | grep -o '@e[0-9]*' || true)
if [ -n "$PROVIDERS_REF" ]; then
    "$AB" click "$PROVIDERS_REF"
    "$AB" wait --load networkidle
    "$AB" wait 2000
fi
click_openrouter_and_wait
"$AB" wait 2000
"$AB" screenshot "$SCREENSHOT_DIR/mobile-providers.png"
echo "  Saved mobile-providers.png"

echo ""
echo "==> Screenshot capture complete!"
echo ""
echo "Files:"
ls -lh "$SCREENSHOT_DIR"/*.png 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}' || echo "  (no screenshots found)"
