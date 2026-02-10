#!/bin/bash
set -euo pipefail

INPUT=$(cat)

[ -z "${ACTIVITY_COMMENT_ID:-}" ] || [ -z "${LINEAR_API_KEY:-}" ] && exit 0

API="https://api.linear.app/graphql"
TIMESTAMP=$(date +%H:%M:%S)

LINE="\`[${TIMESTAMP}]\` ✅ Session complete"

EXISTING=$(curl -s -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" \
    '{query: "query($id: String!) { comment(id: $id) { body } }", variables: {id: $id}}')" \
  | jq -r '.data.comment.body')

NEW_BODY=$(printf '%s\n%s' "$EXISTING" "$LINE")

curl -s -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ACTIVITY_COMMENT_ID" --arg body "$NEW_BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')" > /dev/null

exit 0
