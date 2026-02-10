# Review Skill

You are performing an AI code review of a pull request. The issue has the `ai-review-pending` label, meaning implementation is complete and the PR needs review.

## Context

You are running inside the PM Agent container. You do NOT have git access, but you can read PR diffs via the GitHub API.

## Input

The state machine routed you here because the issue has the `ai-review-pending` label. You have:
- `data.id` — issue ID
- `data.identifier` — e.g. SQU-42
- `data.title` — issue title

## Steps

### 1. Fetch Issue Details and Find PR

```bash
# Get issue with comments to find the PR URL
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { identifier title description labels { nodes { id name } } team { id key name } comments(last: 20) { nodes { body createdAt } } } }"}'
```

Find the PR URL from comments (look for "**PR:**" in worker completion comments).

### 2. Fetch PR Diff

```bash
# Extract owner/repo and PR number from URL
# e.g. https://github.com/owner/repo/pull/42

gh pr diff PR_NUMBER --repo OWNER/REPO
```

Or via API:
```bash
gh api repos/OWNER/REPO/pulls/PR_NUMBER --jq '.title, .body, .changed_files, .additions, .deletions'
gh api repos/OWNER/REPO/pulls/PR_NUMBER/files --jq '.[] | {filename: .filename, status: .status, changes: .changes, patch: .patch}'
```

### 3. Analyze the Diff

Review the code changes against these criteria:

**Correctness**
- Does the code do what the issue asks for?
- Are there logic errors or off-by-one mistakes?
- Are edge cases handled?

**Security**
- No hardcoded secrets or credentials
- Input validation at system boundaries
- No injection vulnerabilities (SQL, command, XSS)

**Quality**
- Follows existing codebase conventions
- No unnecessary complexity
- Tests included where appropriate
- No leftover debug code

**Performance**
- No obvious N+1 queries or unbounded loops
- Resources properly cleaned up

### 4. Determine Severity

Based on findings, assign an overall severity:
- **clean** — No issues found, ready to merge
- **low** — Minor suggestions, non-blocking
- **medium** — Issues that should be fixed but aren't critical
- **high** — Significant problems that must be fixed
- **critical** — Security vulnerabilities or data loss risks

### 5. Post Review Comment

Read `.claude/skills/references/comment-formats.md` for the review comment template.

Post the review as a comment on the Linear issue.

### 6. Apply Review Label

Remove `ai-review-pending` and add the appropriate `ai-review:*` label:

```bash
# Find label IDs
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"ai-review:SEVERITY\" } }) { nodes { id } } }"}'
```

### 7. Route Based on Severity

**If clean or low:**
1. Move issue to "In Review" state (for human final check)
2. Post comment: `AI review complete — no blocking issues. Ready for human review.`

**If medium, high, or critical:**
1. Add `ai-revision` label (this triggers the implement-revision skill)
2. Post comment: `AI review found {severity} issues. Sending back for revision.`

## Error Handling

If the PR diff can't be fetched or review fails:
1. Post error comment on the issue
2. Remove `ai-review-pending` label
3. Add `needs-human-review` label with comment explaining the failure
