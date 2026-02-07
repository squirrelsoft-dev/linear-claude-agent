# PM Agent Pipeline

An AI-powered development pipeline that turns Linear issues into GitHub pull requests — automatically. A Mastra PM agent receives Linear webhooks, spawns ephemeral Docker containers running Claude Code, and manages the full lifecycle from task assignment through code review.

![Architecture](./docs/architecture.png)

> [View interactive architecture diagram →](https://pipeline.squirrel.dev)

## How It Works

1. You create or move an issue to "In Progress" in Linear
2. Linear fires a webhook to the PM agent
3. The PM agent spawns an ephemeral Docker container with Claude Code
4. The worker clones the repo, creates a branch, writes code, commits, and pushes
5. On success, the PM agent creates a GitHub PR and links it back to Linear
6. The Linear issue moves to "In Review" — you just review and merge

## Stack

- **[Mastra](https://mastra.ai)** — AI agent framework (PM agent orchestration)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic's CLI for agentic coding
- **[Linear](https://linear.app)** — Issue tracking with webhook events
- **[Docker](https://docker.com)** — Ephemeral worker containers via socket mount

## Architecture

### Components

| Component                 | Description                                                  |
| ------------------------- | ------------------------------------------------------------ |
| **PM Agent**              | Long-running Mastra agent. Receives webhooks, decides actions, spawns workers, processes callbacks, creates PRs. |
| **Webhook Receiver**      | Express server with HMAC-SHA256 signature verification and replay protection. |
| **Worker Spawner**        | Dockerode-based module that creates ephemeral containers on a shared Docker network. |
| **Coding Worker**         | Ubuntu 24.04 container with Claude Code CLI. Clones, branches, codes, commits, pushes, callbacks. |
| **Completion Handler**    | Processes worker callbacks. Creates GitHub PRs via Octokit, updates Linear issues. |
| **Token Refresh Sidecar** | Alpine container that monitors OAuth credentials and refreshes tokens before expiry. |

### Networking

All containers run on a shared `pm-agent-net` Docker network. Workers reach the PM agent at `http://pm-agent:3000` via internal hostname. External traffic routes through Traefik with HTTPS termination.

Worker callbacks are authenticated with a shared `AGENT_KEY` passed via the `x-agent-key` header.

### Authentication

Claude Code OAuth tokens expire every 1–4 hours, and the built-in refresh mechanism is broken in headless/container environments. The token refresh sidecar solves this by:

- Monitoring `~/.claude/.credentials.json` on a shared Docker volume (`claude-auth`)
- Refreshing tokens 30 minutes before expiry via the Anthropic OAuth endpoint
- Writing credentials atomically (temp file + rename) with `flock` for concurrency safety
- Retrying 3x with exponential backoff on network failures

Initial authentication requires running `claude` interactively once to complete the OAuth flow.

## Project Structure

```
├── src/
│   ├── config.ts              # Zod-validated environment config
│   ├── index.ts               # Express server entry point
│   ├── agents/
│   │   └── pm-agent.ts        # Mastra PM agent definition
│   ├── services/
│   │   └── docker.service.ts  # Worker spawner (Dockerode)
│   └── tools/
│       ├── fetch-issue.ts     # Linear issue fetcher
│       └── spawn-worker.ts    # Worker spawn tool
├── token-refresh/
│   ├── Dockerfile             # Alpine + curl + jq + coreutils
│   └── refresh.sh             # Token monitoring and refresh logic
├── Dockerfile                 # Worker image (Ubuntu 24.04 + Claude Code)
├── worker-entrypoint.sh       # Worker lifecycle script
├── pm-agent.Dockerfile        # PM agent image (Node 22 + Docker CLI)
├── docker-compose.yml         # PM agent + token refresh sidecar
├── test-worker.sh             # Worker build/auth/SSH/e2e test harness
└── docs/
    └── architecture.png       # Architecture diagram
```

## Setup

### Prerequisites

- Docker with Docker Compose
- A Linux server (for deployment) or local Docker for development
- Linear workspace with API key
- GitHub PAT with `repo` scope
- Anthropic account with Claude Max subscription (for Claude Code)

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Linear
LINEAR_API_KEY=lin_api_...
LINEAR_WEBHOOK_SECRET=...

# Anthropic (for PM agent, not workers)
ANTHROPIC_API_KEY=sk-ant-...

# GitHub (for PR creation)
GITHUB_TOKEN=ghp_...

# Security
AGENT_KEY=<generate-a-strong-secret>

# Worker Config
REPO_URL=git@github.com:your-org/your-repo.git
WORKER_IMAGE=claude-worker:latest
WORKER_NETWORK=pm-agent-net
WORKER_TIMEOUT=1800
WORKER_MAX_TURNS=50
CALLBACK_BASE_URL=http://pm-agent:3000
HOST_SSH_PATH=/home/user/.ssh
HOST_CLAUDE_AUTH_PATH=claude-auth

# Server
PORT=3000
LOG_LEVEL=info
PM_AGENT_MODEL=claude-sonnet-4-20250514
```

### Initial OAuth Setup

1. Build the worker image: `docker build -t claude-worker .`

2. Run an interactive container with the auth volume mounted:

   ```bash
   docker run -it -v claude-auth:/root/.claude claude-worker claude
   ```

3. Copy the OAuth URL to your browser, authenticate with Anthropic

4. Tokens are saved to the `claude-auth` volume

5. The token refresh sidecar keeps them fresh from here

### Running

```bash
# Build and start PM agent + token refresh sidecar
docker compose up -d --build

# Build the worker image
docker build -t claude-worker .

# Check logs
docker compose logs -f pm-agent
docker compose logs -f token-refresh
```

### Testing the Worker

```bash
# Build test
./test-worker.sh build

# Test Claude auth
./test-worker.sh auth

# Test SSH git clone
./test-worker.sh ssh

# Full end-to-end test
./test-worker.sh e2e
```

## API Endpoints

| Endpoint               | Method | Auth          | Description                |
| ---------------------- | ------ | ------------- | -------------------------- |
| `/health`              | GET    | None          | Health check               |
| `/api/linear/webhook`  | POST   | HMAC-SHA256   | Linear webhook receiver    |
| `/api/worker/complete` | POST   | `x-agent-key` | Worker completion callback |

## Roadmap

- [x] Webhook receiver with HMAC verification (SQU-8)
- [x] Docker worker image with Claude Code (SQU-7)
- [x] Worker spawner module (SQU-9)
- [x] OAuth token refresh sidecar (SQU-15)
- [x] Completion handler with GitHub PR creation (SQU-10)
- [ ] Task decomposition agent (SQU-11)
- [ ] End-to-end pipeline testing (SQU-12)
- [ ] Production deployment (SQU-13)
- [ ] CLAUDE.md files for target repos (SQU-14)
- [ ] Triage worker for automatic issue analysis (SQU-16)

## How Workers Execute Tasks

The worker entrypoint script (`worker-entrypoint.sh`) handles the full lifecycle:

1. **Clone** the repository via SSH
2. **Branch** from the base branch (e.g. `ai/SQU-42-fix-login-bug`)
3. **Run** `claude -p` with the task prompt, allowed tools (Edit, Write, Bash, Read), and `--dangerously-skip-permissions`
4. **Commit** all changes with a descriptive message
5. **Push** the branch to the remote
6. **Callback** to the PM agent with status, branch name, and any errors

Workers have a configurable timeout (default 30 minutes) with a watchdog process. On SIGTERM/SIGINT, they clean up gracefully and report back.

## Security

- **Webhook verification**: Linear webhooks validated with HMAC-SHA256 signatures and 60-second replay protection
- **Network isolation**: Workers communicate with the PM agent over an internal Docker network only
- **Callback authentication**: All worker callbacks require a valid `x-agent-key` header
- **Read-only credentials**: Workers mount the `claude-auth` volume as read-only
- **SSH key isolation**: SSH keys are host bind-mounted read-only into coding workers only
- **Docker socket**: Mounted on the PM agent container (required for spawning workers)

## License

Private — SquirrelSoft LLC
