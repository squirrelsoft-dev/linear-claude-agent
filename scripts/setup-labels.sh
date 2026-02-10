#!/usr/bin/env bash
set -euo pipefail

# ─── Linear AI Workflow Labels Setup ─────────────────────────────────────────
# Creates the 12 workspace-level labels (1 group + 11 labels) required by
# the AI workflow pipeline.  Idempotent — safe to re-run at any time.
# ─────────────────────────────────────────────────────────────────────────────

GRAPHQL_ENDPOINT="https://api.linear.app/graphql"

# ─── Colors / output helpers ─────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}CREATED${NC}  $1" >&2; }
skip() { echo -e "  ${YELLOW}SKIP${NC}     $1 (already exists)" >&2; }
fail() { echo -e "  ${RED}FAIL${NC}     $1" >&2; }
info() { echo -e "${CYAN}▸${NC} $1" >&2; }

CREATED_COUNT=0
SKIPPED_COUNT=0
FAILED_COUNT=0

# ─── Load LINEAR_API_KEY ─────────────────────────────────────────────────────
load_api_key() {
  if [ -n "${LINEAR_API_KEY:-}" ]; then
    return 0
  fi

  # Walk up from script dir to find .env
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [ -f "$dir/.env" ]; then
    # Source only LINEAR_API_KEY to avoid polluting the env
    LINEAR_API_KEY="$(grep -E '^LINEAR_API_KEY=' "$dir/.env" | head -1 | cut -d'=' -f2- | xargs)"
    export LINEAR_API_KEY
  fi

  if [ -z "${LINEAR_API_KEY:-}" ]; then
    echo -e "${RED}ERROR${NC}: LINEAR_API_KEY is not set and no .env file found." >&2
    echo "  Export it or add it to the repo root .env file." >&2
    exit 1
  fi
}

# ─── GraphQL helper ──────────────────────────────────────────────────────────
# Usage: gql '{ "query": "..." }'  → prints JSON response body
gql() {
  local body="$1"
  curl -s -X POST "$GRAPHQL_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$body"
}

# ─── Check if a label already exists by name ─────────────────────────────────
# Returns the label id if found, empty string otherwise.
find_label() {
  local name="$1"

  local query
  query=$(jq -n --arg name "$name" '{
    query: "query ($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id name } } }",
    variables: { name: $name }
  }')

  local response
  response=$(gql "$query")

  # Return id of first match, or empty
  echo "$response" | jq -r '.data.issueLabels.nodes[0].id // empty'
}

# ─── Create a label ─────────────────────────────────────────────────────────
# create_label NAME COLOR DESCRIPTION [TEAM_ID] [PARENT_ID]
# Prints status message. Echoes the label id (new or existing) on fd 3.
create_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  local team_id="${4:-}"
  local parent_id="${5:-}"

  # Check existence first (idempotent)
  local existing_id
  existing_id=$(find_label "$name")

  if [ -n "$existing_id" ]; then
    skip "$name"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    echo "$existing_id"
    return 0
  fi

  # Build mutation variables
  local vars
  vars=$(jq -n \
    --arg name "$name" \
    --arg color "$color" \
    --arg description "$description" \
    --arg teamId "$team_id" \
    --arg parentId "$parent_id" \
    '{
      name: $name,
      color: $color,
      description: $description
    }
    + (if $teamId != "" then { teamId: $teamId } else {} end)
    + (if $parentId != "" then { parentId: $parentId } else {} end)')

  local query
  query=$(jq -n --argjson vars "$vars" '{
    query: "mutation ($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name } } }",
    variables: { input: $vars }
  }')

  local response
  response=$(gql "$query")

  local success
  success=$(echo "$response" | jq -r '.data.issueLabelCreate.success // empty')

  if [ "$success" = "true" ]; then
    local new_id
    new_id=$(echo "$response" | jq -r '.data.issueLabelCreate.issueLabel.id')
    ok "$name"
    CREATED_COUNT=$((CREATED_COUNT + 1))
    echo "$new_id"
    return 0
  fi

  # Creation failed — extract error
  local errors
  errors=$(echo "$response" | jq -r '.errors // [] | .[].message // "unknown error"' 2>/dev/null || echo "unknown error")
  fail "$name — $errors"
  FAILED_COUNT=$((FAILED_COUNT + 1))
  echo ""
  return 1
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
  echo "" >&2
  echo "╔══════════════════════════════════════════════════╗" >&2
  echo "║     Linear AI Workflow Labels Setup              ║" >&2
  echo "╚══════════════════════════════════════════════════╝" >&2
  echo "" >&2

  load_api_key

  # ── 1. Top-level workflow labels ───────────────────────────────────────────
  info "Creating top-level workflow labels..."
  echo "" >&2

  create_label "ai-work"              "#4EA7FC" "Issue marked for AI agent processing"          "" "" > /dev/null
  create_label "ai-triaged"           "#BB87FC" "Issue analyzed by AI triage against codebase"   "" "" > /dev/null
  create_label "ai-implementing"      "#F2994A" "Worker actively coding this issue"              "" "" > /dev/null
  create_label "ai-review-pending"    "#F2C94C" "Implementation complete, awaiting AI code review" "" "" > /dev/null
  create_label "ai-revision"          "#F2994A" "Review found issues, sent back for fixes"       "" "" > /dev/null
  create_label "needs-human-review"   "#EB5757" "Max AI review cycles reached, human review required" "" "" > /dev/null

  echo "" >&2

  # ── 2. AI Review group label ───────────────────────────────────────────────
  info "Creating AI Review group label..."
  echo "" >&2

  local group_id
  group_id=$(create_label "AI Review" "#4EA7FC" "AI code review severity labels" "" "")

  if [ -z "$group_id" ]; then
    echo "" >&2
    echo -e "${RED}ERROR${NC}: Failed to create or find 'AI Review' group. Cannot create child labels." >&2
    exit 1
  fi

  echo "" >&2

  # ── 3. AI Review sub-labels (nested under group) ──────────────────────────
  info "Creating AI Review sub-labels (parentId=$group_id)..."
  echo "" >&2

  create_label "ai-review:clean"    "#4CB782" "Code review found no issues"                "" "$group_id" > /dev/null
  create_label "ai-review:low"      "#4CB782" "Code review highest severity: Low"          "" "$group_id" > /dev/null
  create_label "ai-review:medium"   "#F2C94C" "Code review highest severity: Medium"       "" "$group_id" > /dev/null
  create_label "ai-review:high"     "#F2994A" "Code review highest severity: High"         "" "$group_id" > /dev/null
  create_label "ai-review:critical" "#EB5757" "Code review highest severity: Critical"     "" "$group_id" > /dev/null

  echo "" >&2

  # ── Summary ────────────────────────────────────────────────────────────────
  echo "──────────────────────────────────────────────────" >&2
  echo -e "  ${GREEN}Created${NC}:  $CREATED_COUNT" >&2
  echo -e "  ${YELLOW}Skipped${NC}:  $SKIPPED_COUNT" >&2
  echo -e "  ${RED}Failed${NC}:   $FAILED_COUNT" >&2
  echo "──────────────────────────────────────────────────" >&2
  echo "" >&2

  if [ "$FAILED_COUNT" -gt 0 ]; then
    echo -e "${RED}Some labels failed to create. Check errors above.${NC}" >&2
    exit 1
  fi

  local total=$((CREATED_COUNT + SKIPPED_COUNT))
  echo -e "${GREEN}All $total labels are in place.${NC}" >&2
  echo "" >&2
}

main "$@"
