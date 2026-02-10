# Implement Skill

You are spawning a worker container to implement a Linear issue. The issue has been moved to "In Progress" and needs code written.

## Context

You are running inside the PM Agent container. You have access to Docker (via socket) to spawn worker containers. You do NOT write code yourself — you spawn a worker that does.

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
# Count running worker containers
docker ps --filter "name=worker-" --format "{{.Names}}" | wc -l
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

### 7. Spawn Worker Container

```bash
docker run -d \
  --name "worker-${IDENTIFIER,,}-$(date +%s)" \
  --network "${WORKER_NETWORK:-pm-agent-net}" \
  -e "REPO_URL=${REPO_URL}" \
  -e "BRANCH_NAME=${BRANCH_NAME}" \
  -e "TASK_PROMPT=${TASK_DESCRIPTION}" \
  -e "LINEAR_ISSUE_ID=${ISSUE_ID}" \
  -e "ISSUE_ID=${ISSUE_ID}" \
  -e "ISSUE_IDENTIFIER=${IDENTIFIER}" \
  -e "ISSUE_TITLE=${TITLE}" \
  -e "LINEAR_API_KEY=${LINEAR_API_KEY}" \
  -e "ACTIVITY_COMMENT_ID=${ACTIVITY_COMMENT_ID}" \
  -e "CALLBACK_URL=http://pm-agent:3000/api/worker/complete" \
  -e "AGENT_KEY=${AGENT_KEY}" \
  -e "TIMEOUT=${WORKER_TIMEOUT:-1800}" \
  -e "MAX_TURNS=${WORKER_MAX_TURNS:-50}" \
  -v "${HOST_SSH_PATH:-/root/.ssh}:/home/worker/.ssh:ro" \
  -v "${HOST_CLAUDE_AUTH_PATH:-claude-auth}:/home/worker/.claude" \
  "${WORKER_IMAGE:-claude-worker:latest}"
```

The `TASK_DESCRIPTION` should be a clear, actionable prompt constructed from the issue title, description, and any triage analysis.

### 8. Post Status Comment

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"🤖 Worker spawned.\\n\\n**Branch:** `BRANCH_NAME`\\n**Container:** `CONTAINER_ID`\" }) { success } }"}'
```

## Error Handling

If Docker spawn fails:
1. Post an error comment on the issue
2. Remove `ai-implementing` label
3. Apply `agent-failed` label (create it if it doesn't exist)
4. Move issue back to Todo
