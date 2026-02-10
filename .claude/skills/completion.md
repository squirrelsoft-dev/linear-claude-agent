# Completion Skill

You are handling a worker callback after a worker container has finished implementing a Linear issue. The callback payload tells you whether the worker succeeded or failed.

## Input

You receive a file path to a JSON file containing the worker callback payload.
First, read the file using the Read tool, then parse it to extract:
- `status` — `"completed"` or `"failed"`
- `branch` — git branch name (e.g. `ai/squ-42-add-auth`)
- `issueId` — Linear issue ID
- `issueIdentifier` — e.g. `SQU-42`
- `issueTitle` — issue title
- `repoUrl` — SSH git URL (e.g. `git@github.com:org/repo.git`)
- `error` — error message (present when `status` is `"failed"`)

## Environment

- `LINEAR_API_KEY` — for Linear API calls
- `GITHUB_TOKEN` — for GitHub API calls (used by `gh` CLI)
- `BASE_BRANCH` — default base branch (default: `main`)

## Steps — Completed

If `status` is `"completed"`:

### 1. Parse Repository URL

Extract `OWNER/REPO` from `repoUrl`:
- `git@github.com:org/repo.git` → `org/repo`
- `git@github.com:org/repo` → `org/repo`

### 2. Check for Existing PR

```bash
gh pr list --head BRANCH --repo OWNER/REPO --json url --jq '.[0].url'
```

### 3. Create PR if None Exists

```bash
gh pr create --repo OWNER/REPO --head BRANCH --base ${BASE_BRANCH:-main} \
  --title "ISSUE_IDENTIFIER: ISSUE_TITLE" \
  --body "Resolves [ISSUE_IDENTIFIER](https://linear.app/issue/ISSUE_IDENTIFIER)"
```

Capture the PR URL from the output.

### 4. Post Completion Comment on Linear

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"🤖 Worker completed successfully.\\n\\n**Branch:** `BRANCH`\\n**PR:** PR_URL\" }) { success } }"}'
```

### 5. Swap Labels: Remove `ai-implementing`, Add `ai-review-pending`

Follow the label mutation pattern from `.claude/skills/references/label-scheme.md`:

1. Fetch `ai-review-pending` label ID:
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"ai-review-pending\" } }) { nodes { id } } }"}'
```

2. Fetch the issue's current labels:
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { labels { nodes { id name } } } }"}'
```

3. Build the new label ID array:
   - Remove the `ai-implementing` label ID
   - Add the `ai-review-pending` label ID

4. Update the issue:
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"ISSUE_ID\", input: { labelIds: [\"id1\", \"id2\"] }) { success } }"}'
```

Adding `ai-review-pending` triggers a Linear webhook → state machine → review skill.

---

## Steps — Failed

If `status` is `"failed"`:

### 1. Post Failure Comment on Linear

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"🤖 Worker failed.\\n\\n**Branch:** `BRANCH`\\n**Error:** ERROR_MSG\" }) { success } }"}'
```

### 2. Swap Labels: Remove `ai-implementing`, Add `agent-failed`

1. Fetch `agent-failed` label ID (create it if it doesn't exist):
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"agent-failed\" } }) { nodes { id } } }"}'
```

If no label found, create it:
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueLabelCreate(input: { name: \"agent-failed\", color: \"#e74c3c\" }) { success issueLabel { id } } }"}'
```

2. Fetch the issue's current labels, remove `ai-implementing`, add `agent-failed`
3. Update the issue with the new label IDs

### 3. Move Issue to Todo

```bash
# Fetch issue's team
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { team { id states { nodes { id name } } } } }"}'

# Find the "Todo" state ID, then update issue
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"ISSUE_ID\", input: { stateId: \"TODO_STATE_ID\" }) { success } }"}'
```

## Error Handling

If any step fails (API call returns errors, `gh` command fails):
1. Log the error with structured JSON
2. Post an error comment on the Linear issue:
   ```
   🤖 Completion handler error: DESCRIPTION
   ```
3. Do NOT silently swallow errors — always leave a trace on the issue
