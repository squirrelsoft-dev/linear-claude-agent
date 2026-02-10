#!/bin/bash
set -euo pipefail

INPUT=$(cat)

[ -z "${ACTIVITY_COMMENT_ID:-}" ] || [ -z "${LINEAR_API_KEY:-}" ] && exit 0

API="https://api.linear.app/graphql"
TIMESTAMP=$(date +%H:%M:%S)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input')

# Build a human-readable summary based on tool type
case "$TOOL_NAME" in
  Write)
    FILE=$(echo "$TOOL_INPUT" | jq -r '.file_path' | sed "s|$(pwd)/||")
    SUMMARY="✏️ Created \`${FILE}\`"
    ;;
  Edit)
    FILE=$(echo "$TOOL_INPUT" | jq -r '.file_path' | sed "s|$(pwd)/||")
    SUMMARY="✏️ Edited \`${FILE}\`"
    ;;
  Bash)
    CMD=$(echo "$TOOL_INPUT" | jq -r '.command' | head -1 | cut -c1-80)
    SUMMARY="⚡ \`${CMD}\`"
    ;;
  *)
    SUMMARY="🔧 ${TOOL_NAME}"
    ;;
esac

LINE="\`[${TIMESTAMP}]\` ${SUMMARY}"

# Fetch existing comment body
EXISTING=$(curl -s -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" \
    '{query: "query($id: String!) { comment(id: $id) { body } }", variables: {id: $id}}')" \
  | jq -r '.data.comment.body')

# Append new line
NEW_BODY=$(printf '%s\n%s' "$EXISTING" "$LINE")

curl -s -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" --arg body "$NEW_BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" > /dev/null

exit 0
