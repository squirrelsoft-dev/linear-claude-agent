# Respond Skill

You are responding to an @agent mention in a Linear issue comment. Someone has asked the AI agent a question or given it an instruction.

## Context

You are running inside the PM Agent container. You can query APIs but do not have git access. If the request requires code changes, you should spawn a worker instead.

## Input

The state machine routed you here because a comment containing "@agent" was detected.

The webhook payload is a **Comment** event. The structure differs from Issue events:
- `data.id` — the **comment** ID (not the issue ID)
- `data.body` — the comment text containing the @agent mention
- `data.user.name` — who mentioned the agent
- `data.issue.id` — the **parent issue** ID
- `data.issue.identifier` — the parent issue identifier (e.g. `SQU-42`)

Use `data.issue.id` as the issue ID for API calls. The `ISSUE_ID` and `ISSUE_IDENTIFIER` env vars are also set correctly as fallbacks.

## Steps

### 1. Extract Issue ID from Payload

Read the webhook payload file. For Comment events, the parent issue ID is at `data.issue.id`:

```
issueId = payload.data.issue.id   // preferred — direct from payload
         || $ISSUE_ID              // fallback — set by the webhook receiver
```

### 2. Fetch the Full Comment and Issue Context

Use the resolved issue ID (not `data.id`, which is the comment ID):

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issue(id: \"'$ISSUE_ID'\") { identifier title description state { name } labels { nodes { name } } comments(last: 20) { nodes { body createdAt user { name } } } } }"}'
```

### 3. Parse the Request

Extract the user's request from the @agent mention. Common patterns:
- **Question about status**: "What's the status of this?"
- **Clarification**: "Can you explain your approach?"
- **Instruction**: "Also handle the edge case where X"
- **Code request**: "Please also add tests for Y"

### 4. Handle Based on Request Type

**Status inquiry:**
- Check current state, labels, recent comments
- Summarize what has happened and what's pending

**Clarification:**
- Review triage analysis and implementation comments
- Provide a clear explanation

**Instruction that requires code changes:**
- If a worker is currently running (check `ai-implementing` label), respond that changes will be included in the next revision
- If no worker is running, update the issue description or add context, then suggest moving to In Progress

**General question:**
- Answer based on available context from the issue and comments

### 5. Post Response

Read `.claude/skills/references/comment-formats.md` for the response template.

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"'$ISSUE_ID'\", body: \"RESPONSE\" }) { success } }"}'
```

## Guidelines

- Keep responses concise and actionable
- Always acknowledge what was asked
- If you can't help, say so clearly and suggest alternatives
- Never pretend to have done something you haven't
- Reference specific files, PRs, or comments when relevant
