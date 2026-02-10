#!/bin/bash
# Reads JSON from stdin
INPUT=$(cat)

# Need ISSUE_ID and LINEAR_API_KEY from environment
[ -z "$ISSUE_ID" ] || [ -z "$LINEAR_API_KEY" ] && exit 0

ISSUE_IDENTIFIER="${ISSUE_IDENTIFIER:-unknown}"
TIMESTAMP=$(date +%H:%M:%S)
API="https://api.linear.app/graphql"

# Create the activity comment
BODY="🤖 **Agent Activity** — ${ISSUE_IDENTIFIER}\n\n\`[${TIMESTAMP}]\` 🚀 Session started"

RESULT=$(curl -s -X POST "$API" \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$ISSUE_ID" --arg body "$BODY" \
    '{query: "mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { comment { id } } }", variables: {id: $id, body: $body}}')")

COMMENT_ID=$(echo "$RESULT" | jq -r '.data.commentCreate.comment.id // empty')

if [ -n "$COMMENT_ID" ] && [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export ACTIVITY_COMMENT_ID=\"$COMMENT_ID\"" >> "$CLAUDE_ENV_FILE"
fi

exit 0
