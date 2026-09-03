#!/usr/bin/env bash
set -euo pipefail

# Captures the README image set from a disposable seeded workspace.
#
# Every shot asserts that the page actually rendered its content before the
# screenshot is taken, so a stale or empty capture fails the run instead of
# silently landing in .github/readme.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="$PROJECT_DIR/.github/readme"
DEV_SERVER_FILE="$PROJECT_DIR/.dev-server"
EIDON_DATA_DIR="$PROJECT_DIR/.context/readme-demo-data"
# Pinned so the screenshots never inherit a real admin identity from .env.
DEMO_ADMIN_USERNAME="admin"
DEV_SERVER_PID=""
AB="agent-browser"

DESKTOP_WIDTH=1280
DESKTOP_HEIGHT=1040
MOBILE_WIDTH=390
MOBILE_HEIGHT=844

FAILURES=()

for cmd in jq curl agent-browser; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd is required but not found in PATH" >&2; exit 1; }
done

mkdir -p "$SCREENSHOT_DIR"

cleanup() {
    echo "==> Cleaning up..."
    "$AB" close --all 2>/dev/null || true
    if [ -n "$DEV_SERVER_PID" ] && kill -0 "$DEV_SERVER_PID" 2>/dev/null; then
        kill "$DEV_SERVER_PID" 2>/dev/null || true
        wait "$DEV_SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$DEV_SERVER_FILE"
}
trap cleanup EXIT

echo "==> Seeding README demo data..."
SEED_RAW=$(EIDON_DATA_DIR="$EIDON_DATA_DIR" EIDON_ADMIN_USERNAME="$DEMO_ADMIN_USERNAME" \
    npm run seed:readme-demo --prefix "$PROJECT_DIR" --silent)
# Migrations log to stdout on a fresh data dir, so keep only the trailing JSON object.
SEED_OUTPUT=$(echo "$SEED_RAW" | sed -n '/^{$/,$p')
if ! echo "$SEED_OUTPUT" | jq -e . > /dev/null 2>&1; then
    echo "ERROR: seed:readme-demo did not return valid JSON:" >&2
    echo "$SEED_RAW" >&2
    exit 1
fi

seeded() { echo "$SEED_OUTPUT" | jq -r ".seeded.$1"; }

PRIMARY_CONV_ID=$(seeded primaryConversationId)
RESEARCH_CONV_ID=$(seeded researchConversationId)
RESEARCH_DRAFT_CONV_ID=$(seeded researchDraftConversationId)
RESEARCH_DRAFT_QUESTION=$(echo "$SEED_OUTPUT" | jq -r '.fixtures.researchDraftQuestion')
VISUALS_MERMAID_CONV_ID=$(seeded visualsMermaidConversationId)
VISUALS_CODE_CONV_ID=$(seeded visualsCodeConversationId)
AUTOMATION_ID=$(seeded automationId)
AUTOMATION_RUN_ID=$(seeded automationRunId)
CHIEF_BOT_ID=$(seeded chiefBotId)
CHIEF_CONV_ID=$(seeded chiefConversationId)
INBOX_TRIAGE_BOT_ID=$(seeded inboxTriageBotId)

echo "  primary conversation:  $PRIMARY_CONV_ID"
echo "  research conversation: $RESEARCH_CONV_ID"
echo "  automation:            $AUTOMATION_ID (run $AUTOMATION_RUN_ID)"
echo "  chief bot:             $CHIEF_BOT_ID"
echo "  inbox triage bot:      $INBOX_TRIAGE_BOT_ID"

echo "==> Starting dev server..."
rm -f "$DEV_SERVER_FILE"
EIDON_DATA_DIR="$EIDON_DATA_DIR" EIDON_ADMIN_USERNAME="$DEMO_ADMIN_USERNAME" \
    npm run dev --prefix "$PROJECT_DIR" > /tmp/eidon-screenshot-dev.log 2>&1 &
DEV_SERVER_PID=$!

MAX_WAIT=90
ELAPSED=0
BASE_URL=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if [ -f "$DEV_SERVER_FILE" ]; then
        BASE_URL=$(head -1 "$DEV_SERVER_FILE")
        if [ -n "$BASE_URL" ] && curl -sf -o /dev/null "$BASE_URL" 2>/dev/null; then
            echo "  ready at $BASE_URL"
            break
        fi
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ -z "$BASE_URL" ] || [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "ERROR: Dev server did not start within ${MAX_WAIT}s. Tail of log:" >&2
    tail -30 /tmp/eidon-screenshot-dev.log >&2 || true
    exit 1
fi

# Deterministic rendering: dark theme, no in-flight animations.
"$AB" set media dark reduced-motion >/dev/null

set_viewport() {
    "$AB" set viewport "$1" "$2" >/dev/null
}

# The desktop sidebar is #app-sidebar, translated off-canvas when collapsed.
# Assert it is actually at x=0 rather than hoping a toggle click landed.
sidebar_left() {
    "$AB" eval "Math.round(document.querySelector('#app-sidebar')?.getBoundingClientRect().left ?? -999)" 2>/dev/null | tr -dc '0-9-'
}

ensure_sidebar_open() {
    "$AB" eval "sessionStorage.removeItem('eidon:sidebar:user-closed')" >/dev/null 2>&1 || true

    for _ in 1 2 3; do
        if [ "$(sidebar_left)" = "0" ]; then
            return 0
        fi
        "$AB" click '[aria-label="Expand sidebar"]' >/dev/null 2>&1 || true
        "$AB" wait 800 >/dev/null
    done

    echo "  WARNING: sidebar is not open (left=$(sidebar_left))" >&2
    return 1
}

# Waits until the page body contains the expected text, so no shot can capture
# a skeleton, an error state, or an empty list.
wait_for_text() {
    local needle="$1"
    for _ in $(seq 1 15); do
        if "$AB" get text "body" 2>/dev/null | grep -qF "$needle"; then
            return 0
        fi
        "$AB" wait 1000 >/dev/null
    done
    return 1
}

scroll_transcript_to_top() {
    "$AB" eval "document.querySelector('.conversation-scroller')?.scrollTo({ top: 0 })" >/dev/null 2>&1 || true
    "$AB" wait 600 >/dev/null
}

# Settings list items are buttons whose accessible name holds the full text, so a
# prefix match is enough even when the label is visually truncated.
select_list_item() {
    "$AB" find text "$1" click >/dev/null 2>&1 || {
        echo "  WARNING: could not select list item \"$1\"" >&2
        return 1
    }
    "$AB" wait 1200 >/dev/null
}

run_prep() {
    case "$1" in
        "") return 0 ;;
        top) scroll_transcript_to_top ;;
        pick:*) select_list_item "${1#pick:}" || true ;;
        *) echo "  WARNING: unknown prep step \"$1\"" >&2 ;;
    esac
}

# shot <file> <route> <expected-text> [sidebar|nosidebar] [top|pick:<text>]
shot() {
    local file="$1"
    local route="$2"
    local needle="$3"
    local sidebar="${4:-sidebar}"
    local prep="${5:-}"

    printf '  %-28s' "$file"
    "$AB" open "$BASE_URL$route" >/dev/null
    "$AB" wait --load networkidle >/dev/null
    "$AB" wait 1500 >/dev/null

    if [ "$sidebar" = "sidebar" ]; then
        ensure_sidebar_open || true
    fi

    if ! wait_for_text "$needle"; then
        echo "FAILED (never rendered \"$needle\")"
        FAILURES+=("$file")
        return 0
    fi

    run_prep "$prep"

    "$AB" wait 700 >/dev/null
    "$AB" screenshot "$SCREENSHOT_DIR/$file" >/dev/null
    echo "ok"
}

echo "==> Desktop shots (${DESKTOP_WIDTH}x${DESKTOP_HEIGHT})..."
set_viewport "$DESKTOP_WIDTH" "$DESKTOP_HEIGHT"
shot "desktop-chat.png"           "/chat/$PRIMARY_CONV_ID"                            "April launch"          sidebar top
shot "desktop-agents.png"         "/agents"                                            "Chief of Staff"
shot "desktop-agent-proposal.png" "/agents/$INBOX_TRIAGE_BOT_ID"                       "Schedule automation"   
shot "desktop-delegation.png"     "/agents/$CHIEF_BOT_ID"                              "Splitting this in two" sidebar top
shot "desktop-research.png"       "/chat/$RESEARCH_CONV_ID"                            "Research plan"        sidebar top
shot "desktop-automations.png"    "/automations/$AUTOMATION_ID"                        "Run history"
shot "desktop-automation-run.png" "/automations/$AUTOMATION_ID/runs/$AUTOMATION_RUN_ID" "Nightly sweep complete"
shot "desktop-mermaid.png"        "/chat/$VISUALS_MERMAID_CONV_ID"                     "request lifecycle"     sidebar top
shot "desktop-code.png"           "/chat/$VISUALS_CODE_CONV_ID"                        "token-bucket limiter"  sidebar top
shot "desktop-providers.png"      "/settings/providers"                                "OpenRouter"
shot "desktop-mcp.png"            "/settings/mcp-servers"                              "Linear Cloud"          sidebar "pick:Linear Cloud"
shot "desktop-memories.png"       "/settings/memories"                                 "Toronto mornings"      sidebar "pick:Primary overlap is Toronto"

echo "==> Deep research pre-flight (driven through the composer)..."
capture_research_plan() {
    printf '  %-28s' "desktop-research-plan.png"

    "$AB" open "$BASE_URL/chat/$RESEARCH_DRAFT_CONV_ID" >/dev/null
    "$AB" wait --load networkidle >/dev/null
    "$AB" wait 1500 >/dev/null
    ensure_sidebar_open || true

    # The plan request needs a real provider. With the demo's placeholder keys it
    # fails and the card renders its error state, so stub just that one response.
    # The question itself is already seeded into the transcript.
    "$AB" eval "
const orig = window.fetch;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.includes('/research')) {
    return Promise.resolve(new Response(JSON.stringify({ plan: [
      'Define the competitive set and comparison scope, covering the major hosted and self-hosted AI assistants',
      'For each product, collect pricing, model access, and data-residency terms from official documentation',
      'Identify what each one does well: model breadth, tool support, mobile clients, and administration',
      'Identify the gaps: lock-in, per-seat cost at team size, and what happens to conversation data',
      'Compare deployment effort honestly, including the upgrade and backup burden of self-hosting',
      'Cross-check every pricing and capability claim against primary sources and note disagreements',
      'Compile a cited report with an executive summary, a comparison table, and open questions'
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return orig.call(this, input, init);
};
" >/dev/null 2>&1 || true

    if ! "$AB" find text "Deep research" click >/dev/null 2>&1; then
        echo "FAILED (no Deep research toggle)"
        FAILURES+=("desktop-research-plan.png")
        return 0
    fi
    "$AB" wait 600 >/dev/null

    "$AB" fill "textarea" "$RESEARCH_DRAFT_QUESTION" >/dev/null 2>&1 || true
    "$AB" wait 400 >/dev/null
    "$AB" press Enter >/dev/null 2>&1 || true

    if ! wait_for_text "Start research"; then
        echo "FAILED (plan card never appeared)"
        FAILURES+=("desktop-research-plan.png")
        return 0
    fi

    # Never ship the card's error state.
    if "$AB" get text "body" 2>/dev/null | grep -qF "could not be generated"; then
        echo "FAILED (plan card in error state)"
        FAILURES+=("desktop-research-plan.png")
        return 0
    fi

    "$AB" wait 700 >/dev/null
    "$AB" screenshot "$SCREENSHOT_DIR/desktop-research-plan.png" >/dev/null
    echo "ok"
}

set_viewport "$DESKTOP_WIDTH" "$DESKTOP_HEIGHT"
capture_research_plan

echo "==> Mobile shots (${MOBILE_WIDTH}x${MOBILE_HEIGHT})..."
set_viewport "$MOBILE_WIDTH" "$MOBILE_HEIGHT"
shot "mobile-chat.png"     "/chat/$PRIMARY_CONV_ID" "April launch"   nosidebar
shot "mobile-agents.png"   "/agents"                "Chief of Staff" nosidebar
shot "mobile-settings.png" "/settings/providers"    "OpenRouter"     nosidebar

echo "==> Post-processing..."
npx tsx "$PROJECT_DIR/scripts/process-readme-images.ts"

if [ ${#FAILURES[@]} -gt 0 ]; then
    echo ""
    echo "ERROR: ${#FAILURES[@]} shot(s) failed to render: ${FAILURES[*]}" >&2
    exit 1
fi

echo ""
echo "==> Screenshot capture complete."
