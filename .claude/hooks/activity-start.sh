#!/bin/bash
set -euo pipefail

INPUT=$(cat)

# Normalize env vars (PM agent uses ISSUE_ID, worker uses LINEAR_ISSUE_ID)
ISSUE_ID="${ISSUE_ID:-${LINEAR_ISSUE_ID:-}}"
LINEAR_API_KEY="${LINEAR_API_KEY:-}"

[ -z "$ISSUE_ID" ] || [ -z "$LINEAR_API_KEY" ] && exit 0

ISSUE_IDENTIFIER="${ISSUE_IDENTIFIER:-unknown}"
TIMESTAMP=$(date +%H:%M:%S)
API="https://api.linear.app/graphql"

# If ACTIVITY_COMMENT_ID already exists (passed from PM agent to worker),
# append to the existing comment instead of creating a new one
if [ -n "${ACTIVITY_COMMENT_ID:-}" ]; then
  LINE="\`[${TIMESTAMP}]\` 🚀 Worker session started"

  EXISTING=$(curl -s -X POST "$API" \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" \
      '{query: "query($id: String!) { comment(id: $id) { body } }", variables: {id: $id}}')" \
    | jq -r '.data.comment.body // empty')

  if [ -n "$EXISTING" ]; then
    NEW_BODY=$(printf '%s\n%s' "$EXISTING" "$LINE")
    curl -s -X POST "$API" \
      -H "Authorization: $LINEAR_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" --arg body "$NEW_BODY" \
        '{query: "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" > /dev/null
  fi

  # Re-export so subsequent hooks in this session can use it
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export ACTIVITY_COMMENT_ID=\"$ACTIVITY_COMMENT_ID\"" >> "$CLAUDE_ENV_FILE"
  fi

  exit 0
fi

# Create a new activity comment
BODY=$(printf '🤖 **Agent Activity** — %s\n\n`[%s]` 🚀 Session started' "$ISSUE_IDENTIFIER" "$TIMESTAMP")

RESULT=$(curl -s -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ISSUE_ID" --arg body "$BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')")

COMMENT_ID=$(echo "$RESULT" | jq -r '.data.commentCreate.comment.id // empty')

if [ -n "$COMMENT_ID" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export ACTIVITY_COMMENT_ID=\"$COMMENT_ID\"" >> "$CLAUDE_ENV_FILE"
fi

exit 0
