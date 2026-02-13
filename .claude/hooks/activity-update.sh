#!/bin/bash
set -euo pipefail

log() { echo "{\"event\":\"hook:tool_update\",\"identifier\":\"${ISSUE_IDENTIFIER:-unknown}\",\"msg\":\"$1\",\"timestamp\":\"$(date -u +%FT%T.%3NZ)\"}" >&2; }

INPUT=$(cat)

if [ -z "${ACTIVITY_COMMENT_ID:-}" ] || [ -z "${LINEAR_API_KEY:-}" ]; then
  log "skipped: ACTIVITY_COMMENT_ID or LINEAR_API_KEY not set"
  exit 0
fi

API="https://api.linear.app/graphql"
TIMESTAMP=$(date +%H:%M:%S)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input')

# Build a human-readable summary based on tool type
case "$TOOL_NAME" in
  Write)
    FILE=$(echo "$TOOL_INPUT" | jq -r '.file_path' | sed "s|$(pwd)/||")
    SUMMARY="Created \`${FILE}\`"
    ;;
  Edit)
    FILE=$(echo "$TOOL_INPUT" | jq -r '.file_path' | sed "s|$(pwd)/||")
    SUMMARY="Edited \`${FILE}\`"
    ;;
  Bash)
    CMD=$(echo "$TOOL_INPUT" | jq -r '.command' | head -1 | cut -c1-80)
    SUMMARY="\`${CMD}\`"
    ;;
  *)
    SUMMARY="${TOOL_NAME}"
    ;;
esac

log "${TOOL_NAME}: ${SUMMARY}"

LINE="\`[${TIMESTAMP}]\` ${SUMMARY}"

# Fetch existing comment body
EXISTING=$(curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" \
    '{query: "query($id: String!) { comment(id: $id) { body } }", variables: {id: $id}}')" \
  | jq -r '.data.comment.body') || { log "curl failed fetching comment"; exit 0; }

# Append new line
NEW_BODY=$(printf '%s\n%s' "$EXISTING" "$LINE")

curl -s --connect-timeout 5 --max-time 10 -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" --arg body "$NEW_BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" > /dev/null \
  || log "curl failed updating comment"

log "done"
exit 0
