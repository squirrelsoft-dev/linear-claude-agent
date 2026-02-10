# Triage Skill

You are triaging a Linear issue against the target codebase. Your job is to analyze the issue, assess feasibility, estimate complexity, and post a structured triage comment.

## Context

You are running inside the PM Agent container. You do NOT have git access, but you can query Linear and GitHub APIs.

## Input

The state machine has routed you here because an issue has the `ai-work` label but not `ai-triaged`. You have the webhook payload with:
- `data.id` — issue ID
- `data.identifier` — e.g. SQU-42
- `data.title` — issue title

## Steps

### 1. Fetch Full Issue Details

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"ISSUE_ID\") { identifier title description url priority labels { nodes { id name } } team { id key name } } }"}'
```

### 2. Resolve Repository

Find the repo label from the issue's labels. The repo is identified by a label in the "Repo" label group (configurable via `REPO_LABEL_GROUP` env var, default: "Repo").

```bash
# Get the Repo label group ID
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"Repo\" }, isGroup: { eq: true } }) { nodes { id name children { nodes { id name description } } } } }"}'
```

Match the issue's labels against the children of the Repo group. The matching label's `description` field contains the SSH git URL.

If no repo label is found, post a comment asking for one and move the issue to "Todo":
```
No repo label found — add a label from the **Repo** group so I know which codebase to analyze.
```

### 3. Analyze the Codebase (via GitHub API)

Use the GitHub API to search the repository for relevant files:

```bash
# Search code in the repo
gh api "search/code?q=SEARCH_TERM+repo:OWNER/REPO" --jq '.items[] | {path: .path, score: .score}'

# Get directory tree
gh api "repos/OWNER/REPO/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.type == "blob") | .path' | head -100
```

Look for:
- Files related to the issue description
- Existing patterns, conventions, and architecture
- Potential conflict areas
- Test file locations

### 4. Assess Complexity

Based on your analysis, determine:
- **Size**: Small (1-2 files), Medium (3-5 files), Large (6+ files)
- **Risk**: Low (isolated change), Medium (touches shared code), High (architectural change)
- **Confidence**: High (clear path), Medium (some ambiguity), Low (needs clarification)

### 5. Post Triage Comment

Read `.claude/skills/references/comment-formats.md` for the exact comment template.

Post the triage comment on the issue:
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"COMMENT_BODY\" }) { success } }"}'
```

### 6. Apply `ai-triaged` Label

Find the `ai-triaged` label ID and add it to the issue:
```bash
# Find label ID
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"ai-triaged\" } }) { nodes { id } } }"}'

# Get existing label IDs on the issue, add ai-triaged, update
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"ISSUE_ID\", input: { labelIds: [EXISTING_IDS, \"AI_TRIAGED_ID\"] }) { success } }"}'
```

### 7. Move to Todo

If the issue is in Backlog, move it to Todo so it's ready for implementation:
```bash
# Find the Todo state for the team
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ team(id: \"TEAM_ID\") { states { nodes { id name } } } }"}'

# Update issue state
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"ISSUE_ID\", input: { stateId: \"TODO_STATE_ID\" }) { success } }"}'
```

## Error Handling

If any step fails, post an error comment on the issue with the failure details and stop.
