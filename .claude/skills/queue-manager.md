# Queue Manager Skill

You manage the Todo queue, pulling the next eligible issue when a WIP slot opens up.

## Context

You are running inside the PM Agent container. This skill is called after a worker completes (from cleanup.md) or can be triggered manually.

## Steps

### 1. Check Available WIP Slots

```bash
# Count currently running workers
ACTIVE=$(docker ps --filter "name=worker-" --format "{{.Names}}" | wc -l)
MAX_WIP="${MAX_WIP:-3}"

if [ "$ACTIVE" -ge "$MAX_WIP" ]; then
  echo "No available WIP slots ($ACTIVE/$MAX_WIP)"
  exit 0
fi
```

### 2. Find Next Queued Issue

Query Linear for issues that are:
- In "Todo" state
- Have the `ai-triaged` label (have been analyzed)
- Have a repo label (from the Repo group)
- Sorted by priority (highest first)

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issues(filter: { state: { name: { eq: \"Todo\" } }, labels: { name: { eq: \"ai-triaged\" } } }, orderBy: priorityLabel, first: 5) { nodes { id identifier title priority labels { nodes { id name description parentId } } } } }"}'
```

### 3. Filter for Ready Issues

From the results, select the first issue that:
- Has a repo label (matches Repo group children)
- Does NOT have `ai-implementing` label (not already being worked on)
- Does NOT have `needs-human-review` label

### 4. Transition the Issue

If a ready issue is found:
1. Move it to "In Progress" state — this will trigger the webhook and the implement skill naturally

```bash
# Find In Progress state ID
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ workflowStates(filter: { name: { eq: \"In Progress\" }, team: { key: { eq: \"TEAM_KEY\" } } }) { nodes { id } } }"}'

# Move issue
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"ISSUE_ID\", input: { stateId: \"IN_PROGRESS_ID\" }) { success } }"}'
```

This state change fires a webhook, which the state machine routes to `implement.md`.

### 5. Log the Decision

```
Queue check: {ACTIVE}/{MAX_WIP} slots used. Next issue: {IDENTIFIER} (priority {PRIORITY}).
```

Or if no issues found:
```
Queue check: {ACTIVE}/{MAX_WIP} slots used. No eligible issues in Todo queue.
```

## Important

- Only pull ONE issue per invocation
- Respect the WIP limit strictly
- Only pull issues that have been triaged (`ai-triaged` label)
- Never pull issues that need human attention (`needs-human-review`)
