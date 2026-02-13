#!/bin/bash
set -euo pipefail

log() { echo "{\"event\":\"hook:session_start\",\"identifier\":\"${ISSUE_IDENTIFIER:-unknown}\",\"msg\":\"$1\",\"timestamp\":\"$(date -u +%FT%T.%3NZ)\"}" >&2; }

INPUT=$(cat)

# Normalize env vars (PM agent uses ISSUE_ID, worker uses LINEAR_ISSUE_ID)
ISSUE_ID="${ISSUE_ID:-${LINEAR_ISSUE_ID:-}}"
LINEAR_API_KEY="${LINEAR_API_KEY:-}"

if [ -z "$ISSUE_ID" ] || [ -z "$LINEAR_API_KEY" ]; then
  log "skipped: ISSUE_ID or LINEAR_API_KEY not set"
  exit 0
fi

ISSUE_IDENTIFIER="${ISSUE_IDENTIFIER:-unknown}"
TIMESTAMP=$(date +%H:%M:%S)
API="https://api.linear.app/graphql"

log "started (CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-unset})"

# If ACTIVITY_COMMENT_ID already exists (passed from PM agent to worker),
# append to the existing comment instead of creating a new one
if [ -n "${ACTIVITY_COMMENT_ID:-}" ]; then
  log "appending to existing comment ${ACTIVITY_COMMENT_ID}"
  LINE="\`[${TIMESTAMP}]\` Worker session started"

  EXISTING=$(curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" \
      '{query: "query($id: String!) { comment(id: $id) { body } }", variables: {id: $id}}')" \
    | jq -r '.data.comment.body // empty') || { log "curl failed fetching comment"; exit 0; }

  if [ -n "$EXISTING" ]; then
    NEW_BODY=$(printf '%s\n%s' "$EXISTING" "$LINE")
    curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
      -H "Authorization: $LINEAR_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" --arg body "$NEW_BODY" \
        '{query: "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" > /dev/null \
      || log "curl failed updating comment"
  fi

  # Re-export so subsequent hooks in this session can use it
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export ACTIVITY_COMMENT_ID=\"$ACTIVITY_COMMENT_ID\"" >> "$CLAUDE_ENV_FILE"
  fi

  log "done (appended)"
  exit 0
fi

# Create a new activity comment
log "creating new activity comment"
BODY=$(printf '**Agent Activity** -- %s\n\n`[%s]` Session started' "$ISSUE_IDENTIFIER" "$TIMESTAMP")

RESULT=$(curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ISSUE_ID" --arg body "$BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" \
  ) || { log "curl failed creating comment"; exit 0; }

COMMENT_ID=$(echo "$RESULT" | jq -r '.data.commentCreate.comment.id // empty')

if [ -n "$COMMENT_ID" ]; then
  log "created comment ${COMMENT_ID}"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export ACTIVITY_COMMENT_ID=\"$COMMENT_ID\"" >> "$CLAUDE_ENV_FILE"
  fi
else
  log "failed to create comment: $(echo "$RESULT" | jq -c '.errors // empty')"
fi

log "done"
exit 0
