# Implement Revision Skill

You are spawning a worker container to fix issues found during AI code review. The issue has the `ai-revision` label, meaning a previous review found problems that need to be addressed.

## Context

You are running inside the PM Agent container with Docker access. This is similar to `implement.md` but the worker receives additional context about what needs to be fixed.

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
# Fetch issue with recent comments
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

For the branch: look for the existing branch in recent comments (e.g. "**Branch:** `ai/squ-42-...`"). The worker should check out the existing branch, not create a new one.

### 6. Check WIP Limits

Same as `implement.md`.

### 7. Construct Revision Prompt

Build a task prompt that includes:
- Original issue description
- The specific review feedback to address
- Instruction to fix ONLY the issues raised in the review

### 8. Spawn Worker Container

Same Docker command as `implement.md`, but with the revision-specific task prompt. The `BRANCH_NAME` should be the existing branch from the previous implementation.

### 9. Remove `ai-revision` Label, Add `ai-implementing`

Update the issue labels: remove `ai-revision`, add `ai-implementing`.

### 10. Post Status Comment

```
🤖 Revision worker spawned to address review feedback.

**Branch:** `{BRANCH_NAME}`
**Review cycle:** {N}/{MAX_REVIEW_CYCLES}
```

## Error Handling

Same as `implement.md` — post error comment, apply `agent-failed` label, clean up labels.
