# Cleanup Skill

You are performing post-merge cleanup for a completed Linear issue. The issue has been moved to "Done" state.

## Context

You are running inside the PM Agent container. You have access to Linear and GitHub APIs.

## Input

The state machine routed you here because the issue state changed to "Done". You have:
- `data.id` — issue ID
- `data.identifier` — e.g. SQU-42
- `data.title` — issue title

## Steps

### 1. Fetch Issue Details

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { identifier title labels { nodes { id name } } comments(last: 20) { nodes { body } } } }"}'
```

### 2. Find the Branch and PR

Search recent comments for the branch name (pattern: `ai/{identifier}-*`) and PR URL.

### 3. Clean Up Labels

Remove all AI workflow labels from the issue:
- `ai-work`
- `ai-triaged`
- `ai-implementing`
- `ai-review-pending`
- `ai-revision`
- `needs-human-review`
- `ai-review:*` (any review severity label)

```bash
# Get current label IDs, filter out AI labels, update issue
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"ISSUE_ID\", input: { labelIds: [REMAINING_LABEL_IDS] }) { success } }"}'
```

### 4. Delete Remote Branch (Optional)

If the PR has been merged, delete the remote branch:
```bash
gh api -X DELETE repos/OWNER/REPO/git/refs/heads/BRANCH_NAME
```

Only do this if:
- The PR is in "merged" state
- The branch name starts with `ai/`

### 5. Check for Queued Work

Read `.claude/skills/queue-manager.md` to check if there are issues waiting in the Todo queue that can now be started (since a WIP slot has freed up).

## Error Handling

Cleanup errors are non-critical. Log them but don't fail the overall operation. Post a comment only if a significant step fails (e.g., unable to remove labels).
