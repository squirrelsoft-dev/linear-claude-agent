# Implement Skill

You are implementing a Linear issue directly. The issue has been moved to "In Progress" and needs code written.

## Context

You are running inside an isolated skill container with worker-level settings. The entrypoint has configured SSH, git identity, and an EXIT trap that sends a failure callback if you don't send a success callback. You do the full workflow: clone, implement, commit, push, callback.

## Input

The state machine has routed you here because the issue's state changed to "In Progress". You have the webhook payload with:
- `data.id` — issue ID
- `data.identifier` — e.g. SQU-42
- `data.title` — issue title

## Steps

### 1. Read Guard Rules

Read `.claude/skills/references/guard-rules.md` and enforce all limits before proceeding.

### 2. Fetch Full Issue Details

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { identifier title description url priority labels { nodes { id name parentId } } team { id key name } } }"}'
```

### 3. Resolve Repository URL

Find the repo label (child of the "Repo" label group) and extract the SSH URL from its description.

```bash
# Get the Repo label group and children
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"Repo\" }, isGroup: { eq: true } }) { nodes { id children { nodes { id name description } } } } }"}'
```

Match the issue's labels against group children. The matching label's `description` is the SSH URL (e.g. `git@github.com:org/repo.git`).

If no repo label found, post a comment and move issue to Todo:
```
No repo label found — add a label from the **Repo** group and move back to In Progress.
```

### 4. Check WIP Limits

```bash
# Count running implement skill containers (self is included in the count)
docker ps --filter "name=skill-implement" --format "{{.Names}}" | wc -l
```

If count >= `MAX_WIP` (default 3), post a comment and STOP:
```
Worker queue full ({count}/{MAX_WIP}). Issue will be picked up when a slot opens.
```

### 5. Generate Branch Name

```
ai/{identifier}-{slug}
```

Where `slug` is the title lowercased, non-alphanumeric replaced with hyphens, trimmed, max 50 chars.

Example: `ai/squ-42-add-user-authentication`

### 6. Apply `ai-implementing` Label

Add the `ai-implementing` label to the issue (same pattern as triage — find label ID, get existing labels, append, update).

### 7. Write Marker Files

Write marker files so the entrypoint EXIT trap can include context in the failure callback:

```bash
echo "BRANCH_NAME" > /tmp/.branch_name
echo "REPO_URL" > /tmp/.repo_url
```

Replace BRANCH_NAME and REPO_URL with the actual values resolved above.

### 8. Clone Repository

```bash
git clone "$REPO_URL" /tmp/workspace/repo
cd /tmp/workspace/repo
```

### 9. Create or Checkout Branch

```bash
if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
  git checkout "$BRANCH_NAME"
else
  git checkout -b "$BRANCH_NAME"
fi
```

### 10. Implement the Changes

Read the codebase, understand the existing code, and make the changes described in the issue. This is the core implementation step — use your best judgment about what changes to make.

Focus on:
- Understanding the existing code before making changes
- Making minimal, focused changes that address the issue
- Following existing code style and patterns
- Writing clean, correct code

### 11. Stage, Commit, and Push

```bash
git add -A
git commit -m "feat: {identifier} — {concise description}

{issue title}
Issue: {issue_id}"
git push -u origin "$BRANCH_NAME"
```

If there are no changes to commit, this is a failure — the entrypoint callback trap will handle it.

### 12. Send Success Callback

```bash
curl -sf -X POST "$CALLBACK_URL" \
  -H "Content-Type: application/json" \
  -H "x-agent-key: ${AGENT_KEY:-}" \
  -d '{"status":"completed","branch":"BRANCH_NAME","error":"","issueId":"ISSUE_ID","issueIdentifier":"IDENTIFIER","issueTitle":"TITLE","repoUrl":"REPO_URL"}' \
  --max-time 10
touch /tmp/.callback_sent
```

The `touch /tmp/.callback_sent` tells the entrypoint EXIT trap NOT to send a failure callback.

### 13. Post Status Comment

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"🤖 Implementation complete.\\n\\n**Branch:** `BRANCH_NAME`\" }) { success } }"}'
```

## Error Handling

On failure at any step, simply exit (or let the error propagate). The entrypoint EXIT trap will automatically:
1. Detect that `/tmp/.callback_sent` doesn't exist
2. Read branch name and repo URL from marker files (if they were written)
3. Send a failure callback to the PM agent
4. The PM agent's completion pipeline will handle label cleanup and error comments
