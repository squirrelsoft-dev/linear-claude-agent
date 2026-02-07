# Linear Claude Worker

Linear (task board) ←→ GitHub (two-way sync)
       │
       │ webhook (issue moved to "In Progress")
       ▼
┌─────────────────────┐
│   Mastra PM Agent    │  (long-running on Linux server)
│                      │
│  - Receives webhooks │
│  - Decomposes tasks  │
│  - Spawns workers    │
│  - Monitors progress │
│  - Updates Linear    │
└─────────┬───────────┘
          │ spawns
          ▼
┌─────────────────────┐
│  Docker Container    │  (ephemeral, per-task)
│                      │
│  - Claude Code CLI   │
│  - Claude Max auth   │
│  - Repo mounted      │
│  - Branch isolated   │
│  - Exits on complete │
└─────────────────────┘

Ephemeral Docker container that runs Claude Code against a git repository. Clones a repo, creates a branch, executes a task prompt via `claude -p`, commits the result, and pushes.

## Quick Start

```bash
# Build the image
./test-worker.sh build

# Run a task
docker run --rm \
  -e REPO_URL="git@github.com:org/repo.git" \
  -e BRANCH_NAME="ai/SQU-42-fix-login-bug" \
  -e TASK_PROMPT="Fix the login bug described in issue SQU-42" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$HOME/.ssh:/root/.ssh:ro" \
  claude-worker:latest
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `REPO_URL` | Yes | — | Git SSH URL to clone |
| `BRANCH_NAME` | Yes | — | Branch to create |
| `TASK_PROMPT` | Yes | — | Prompt for `claude -p` (also accepts `TASK_DESCRIPTION`) |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `CALLBACK_URL` | No | — | URL to POST completion status |
| `TIMEOUT` | No | 1800 | Timeout in seconds |
| `MAX_TURNS` | No | 50 | Max Claude turns |
| `LINEAR_ISSUE_ID` | No | — | Included in callback payload for correlation |

## Callback Payload

When `CALLBACK_URL` is set, the worker POSTs a JSON payload on completion (retries 3x):

```json
{
  "status": "success | failure | timeout",
  "branch": "ai/SQU-42-fix-login-bug",
  "error": "",
  "issueId": "SQU-42"
}
```

## Testing

```bash
# Build only
./test-worker.sh build

# Verify Claude auth works in container
ANTHROPIC_API_KEY=sk-... ./test-worker.sh auth

# Verify SSH git clone works
TEST_REPO_URL=git@github.com:org/repo.git ./test-worker.sh ssh

# Full E2E: clone, run Claude, push branch
TEST_REPO_URL=git@github.com:org/repo.git \
ANTHROPIC_API_KEY=sk-... \
./test-worker.sh full
```

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Ubuntu 24.04 + Node.js 22 + Claude Code CLI |
| `worker-entrypoint.sh` | Clone, branch, run Claude, commit, push, callback |
| `.dockerignore` | Minimal build context |
| `test-worker.sh` | Build + test harness (`build`, `auth`, `ssh`, `full`) |
