#!/bin/bash
set -euo pipefail

log() { echo "{\"event\":\"hook:tool_failure\",\"identifier\":\"${ISSUE_IDENTIFIER:-unknown}\",\"msg\":\"$1\",\"timestamp\":\"$(date -u +%FT%T.%3NZ)\"}" >&2; }

INPUT=$(cat)

if [ -z "${ACTIVITY_COMMENT_ID:-}" ] || [ -z "${LINEAR_API_KEY:-}" ]; then
  log "skipped: ACTIVITY_COMMENT_ID or LINEAR_API_KEY not set"
  exit 0
fi

API="https://api.linear.app/graphql"
TIMESTAMP=$(date +%H:%M:%S)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
ERROR=$(echo "$INPUT" | jq -r '.error // empty' | head -1 | cut -c1-100)

log "${TOOL_NAME} failed: ${ERROR}"

LINE="\`[${TIMESTAMP}]\` ${TOOL_NAME} failed: \`${ERROR}\`"

# Fetch + append
EXISTING=$(curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" \
    '{query: "query($id: String!) { comment(id: $id) { body } }", variables: {id: $id}}')" \
  | jq -r '.data.comment.body') || { log "curl failed fetching comment"; exit 0; }

NEW_BODY=$(printf '%s\n%s' "$EXISTING" "$LINE")

curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" --arg body "$NEW_BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" > /dev/null \
  || log "curl failed updating comment"

log "done"
exit 0
