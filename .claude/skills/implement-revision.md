# Implement Revision Skill

You are fixing issues found during AI code review. The issue has the `ai-revision` label, meaning a previous review found problems that need to be addressed.

## Context

You are running inside an isolated skill container with worker-level settings. The entrypoint has configured SSH, git identity, and an EXIT trap that sends a failure callback if you don't send a success callback. You do the full workflow: clone, fix, commit, push, callback.

## Input

The state machine routed you here because the issue has the `ai-revision` label. You have:
- `data.id` — issue ID
- `data.identifier` — e.g. SQU-42
- `data.title` — issue title

## Steps

### 1. Read Guard Rules

Read `.claude/skills/references/guard-rules.md`. Pay special attention to `MAX_REVIEW_CYCLES`.

### 2. Fetch Issue and Review Comments

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { identifier title description labels { nodes { id name parentId } } team { id key name } comments(last: 10) { nodes { body createdAt } } } }"}'
```

### 3. Count Review Cycles

Count how many comments contain "AI Review" or "Review Findings". If this count >= `MAX_REVIEW_CYCLES` (default 3):
1. Remove `ai-revision` label
2. Add `needs-human-review` label
3. Post comment: `Maximum AI review cycles (${MAX_REVIEW_CYCLES}) reached. Escalating to human review.`
4. STOP

### 4. Extract Review Feedback

Find the most recent review comment (contains "Review Findings" or "AI Review"). Extract the specific issues that need fixing.

### 5. Resolve Repository and Branch

Same as `implement.md` — resolve repo URL from labels.

For the branch: look for the existing branch in recent comments (e.g. "**Branch:** `ai/squ-42-...`"). You will check out this existing branch, not create a new one.

### 6. Check WIP Limits

```bash
# Count running implement skill containers (self is included in the count)
docker ps --filter "name=skill-implement" --format "{{.Names}}" | wc -l
```

If count >= `MAX_WIP` (default 3), post a comment and STOP.

### 7. Update Labels

Remove `ai-revision` label, add `ai-implementing` label.

### 8. Write Marker Files

```bash
echo "BRANCH_NAME" > /tmp/.branch_name
echo "REPO_URL" > /tmp/.repo_url
```

Replace BRANCH_NAME and REPO_URL with the actual values resolved above.

### 9. Clone Repository and Checkout Existing Branch

```bash
git clone "$REPO_URL" /tmp/workspace/repo
cd /tmp/workspace/repo
git checkout "$BRANCH_NAME"
```

The branch MUST already exist from the prior implementation. If it doesn't, fail with an error.

### 10. Fix Review Issues

Read the codebase, understand the existing changes on this branch, and fix ONLY the issues raised in the review. Do not make unrelated changes.

Focus on:
- Addressing each review finding specifically
- Keeping fixes minimal and focused
- Not introducing new issues

### 11. Stage, Commit, and Push

```bash
git add -A
git commit -m "fix: {identifier} — address review feedback

Fixes issues from AI review cycle {N}.
Issue: {issue_id}"
git push origin "$BRANCH_NAME"
```

### 12. Send Success Callback

```bash
curl -sf -X POST "$CALLBACK_URL" \
  -H "Content-Type: application/json" \
  -H "x-agent-key: ${AGENT_KEY:-}" \
  -d '{"status":"completed","branch":"BRANCH_NAME","error":"","issueId":"ISSUE_ID","issueIdentifier":"IDENTIFIER","issueTitle":"TITLE","repoUrl":"REPO_URL"}' \
  --max-time 10
touch /tmp/.callback_sent
```

### 13. Post Status Comment

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"🤖 Revision complete — review feedback addressed.\\n\\n**Branch:** `BRANCH_NAME`\\n**Review cycle:** {N}/{MAX_REVIEW_CYCLES}\" }) { success } }"}'
```

## Error Handling

On failure at any step, simply exit. The entrypoint EXIT trap will automatically send a failure callback (same as `implement.md`).
