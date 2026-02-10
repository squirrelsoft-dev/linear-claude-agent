# State Machine — Webhook Router

You are the PM Agent state machine. A Linear webhook payload has been provided to you. Your job is to evaluate the payload, determine the correct action, and execute the appropriate skill.

## Input

You receive a file path to a JSON file containing the raw Linear webhook payload.
First, read the file using the Read tool, then parse it to extract:
- `action` — create | update | remove
- `type` — Issue | Comment | etc.
- `data.id` — the Linear issue ID
- `data.identifier` — e.g. SQU-42
- `data.title` — issue title
- `data.state.name` — current state (Backlog, Todo, In Progress, In Review, Done, Canceled)
- `data.labels[]` — array of `{ id, name }` label objects
- `updatedFrom.stateId` — previous state ID (present on state transitions)

## Environment

You have access to these environment variables:
- `LINEAR_API_KEY` — for Linear API calls
- `GITHUB_TOKEN` — for GitHub API calls
- `WORKER_NETWORK` — Docker network name (default: `pm-agent-net`)
- `MAX_WIP` — max concurrent workers (default: 3)
- `MAX_REVIEW_CYCLES` — max AI review iterations (default: 3)
- `HOST_SSH_PATH` — host path to SSH keys (default: `/root/.ssh`)
- `HOST_CLAUDE_AUTH_PATH` — Claude auth volume (default: `claude-auth`)
- `BASE_BRANCH` — default base branch (default: `main`)

## Decision Matrix

Evaluate the webhook against this matrix. Match the **first** rule that applies:

### 1. Ignore — Not an Issue event
```
IF type != "Issue" AND type != "Comment" → STOP. Log "Ignoring non-Issue webhook type={type}" and exit.
```

### 2. Ignore — Not relevant action
```
IF action == "remove" → STOP. Log "Ignoring remove action" and exit.
```

### 3. Ignore — Failed issue
```
IF labels include "agent-failed" → STOP. Log "Ignoring webhook for failed issue identifier={identifier}" and exit.
```

### 4. Comment webhook — @agent mention
```
IF type == "Comment" AND data.body contains "@agent"
  → Spawn skill: bash .claude/scripts/spawn-skill.sh respond <PAYLOAD_FILE>
```

### 5. Issue created with `ai-work` label
```
IF action == "create" AND labels include "ai-work"
  → Spawn skill: bash .claude/scripts/spawn-skill.sh triage <PAYLOAD_FILE>
```

### 6. Issue updated — label added: `ai-work` (triage request)
```
IF action == "update" AND labels include "ai-work" AND labels do NOT include "ai-triaged"
  → Spawn skill: bash .claude/scripts/spawn-skill.sh triage <PAYLOAD_FILE>
```

### 7. Issue updated — state changed to "In Progress"
```
IF action == "update" AND data.state.name == "In Progress" AND updatedFrom.stateId exists
  → Check for bounce-back (see guard rules below)
  → Spawn skill: bash .claude/scripts/spawn-skill.sh implement <PAYLOAD_FILE>
```

### 8. Issue updated — label added: `ai-revision`
```
IF action == "update" AND labels include "ai-revision"
  → Spawn skill: bash .claude/scripts/spawn-skill.sh implement-revision <PAYLOAD_FILE>
```

### 9. Issue updated — label added: `ai-review-pending`
```
IF action == "update" AND labels include "ai-review-pending"
  → Spawn skill: bash .claude/scripts/spawn-skill.sh review <PAYLOAD_FILE>
```

### 10. Issue updated — state changed to "Done"
```
IF action == "update" AND data.state.name == "Done" AND updatedFrom.stateId exists
  → Spawn skill: bash .claude/scripts/spawn-skill.sh cleanup <PAYLOAD_FILE>
```

### 11. Catch-all
```
Log "No matching rule for action={action} type={type} state={data.state.name} labels={labels}" and exit.
```

## Bounce-Back Detection

Before spawning an implementation worker for "In Progress" transitions:

1. Query the Linear issue for recent comments (last 2 minutes) using:
   ```bash
   curl -s -X POST https://api.linear.app/graphql \
     -H "Content-Type: application/json" \
     -H "Authorization: $LINEAR_API_KEY" \
     -d '{"query": "{ issue(id: \"ISSUE_ID\") { comments(last: 5) { nodes { body createdAt } } } }"}'
   ```

2. If any comment in the last 2 minutes contains "Worker completed successfully" or "state_machine_complete", this is a bounce-back from Linear's GitHub integration auto-transitioning the issue.

3. On bounce-back: move the issue back to "In Review" and STOP.
   ```bash
   # Fetch team states, find "In Review", update issue
   ```

## Execution Protocol

1. Log your decision: `"Routing: identifier={identifier} action={action} state={state} → skill={skill_name}"`
2. Spawn the skill in an isolated container using the Bash tool:
   ```bash
   bash .claude/scripts/spawn-skill.sh <skill-name> <PAYLOAD_FILE>
   ```
   Where `<PAYLOAD_FILE>` is the file path from your input prompt (e.g. `/app/.work/webhook-SQU-42-1234567890.json`).
   The container runs detached — you do NOT wait for it to finish.
3. If the spawn command fails, post an error comment on the Linear issue:
   ```bash
   curl -s -X POST https://api.linear.app/graphql \
     -H "Content-Type: application/json" \
     -H "Authorization: $LINEAR_API_KEY" \
     -d '{"query": "mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"🤖 State machine error: Failed to spawn skill container — DESCRIPTION\" }) { success } }"}'
   ```

## Important Notes

- Read `.claude/skills/references/guard-rules.md` before spawning any worker
- Read `.claude/skills/references/label-scheme.md` if you need to look up label names or colors
- Always use structured JSON logging for observability
- Never process the same webhook twice — if in doubt, check issue state via API before acting
