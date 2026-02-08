# Host Server Setup Guide

This guide covers the host-level configuration required for the PM Agent pipeline to spawn worker containers that can clone repos and run Claude Code.

## Prerequisites

- Linux server (Ubuntu 24.04 tested) with Docker installed
- PM Agent deployed and running (via Coolify or Docker Compose)
- GitHub repository access for the target repos
- Anthropic account with Claude Max subscription (for Claude Code OAuth)

---

## 1. SSH Keys for Worker Containers

Workers clone repositories via SSH. Since they run as a non-root `worker` user (UID 1001) inside the container, the host SSH directory must be readable by that UID.

### Generate a deploy key

```bash
ssh-keygen -t ed25519 -f /opt/worker-ssh/linear_worker_key -C "linear-worker" -N ""
```

### Add the public key to GitHub

1. Go to your GitHub repo → **Settings** → **Deploy keys** → **Add deploy key**
2. Paste the contents of `/opt/worker-ssh/linear_worker_key.pub`
3. Check **Allow write access** (workers need to push branches)

> **Note:** Deploy keys are scoped to a single repo. If workers need access to multiple repos, either add the key to each repo or use a [machine user](https://docs.github.com/en/developers/overview/managing-deploy-keys#machine-users) with a personal SSH key.

### Create the SSH config

```bash
sudo mkdir -p /opt/worker-ssh

sudo tee /opt/worker-ssh/config << 'EOF'
Host github.com
  IdentityFile /home/worker/.ssh/linear_worker_key
  StrictHostKeyChecking no
EOF
```

> **Important:** The `IdentityFile` path is `/home/worker/.ssh/...` (the path *inside* the container), not the host path.

### Add GitHub to known_hosts

```bash
ssh-keyscan github.com | sudo tee -a /opt/worker-ssh/known_hosts
```

### Set ownership and permissions

The worker user inside the container runs as UID 1001. The SSH directory must be owned by this UID:

```bash
sudo chown -R 1001:1001 /opt/worker-ssh
sudo chmod 700 /opt/worker-ssh
sudo chmod 600 /opt/worker-ssh/linear_worker_key
sudo chmod 644 /opt/worker-ssh/config /opt/worker-ssh/known_hosts
```

### Verify

```bash
docker run -it --rm \
  --entrypoint sh \
  -v /opt/worker-ssh:/home/worker/.ssh:ro \
  sbeardsley/linear-code-worker -c "ssh -T git@github.com 2>&1"
```

Expected output:
```
Hi <username>! You've successfully authenticated, but GitHub does not provide shell access.
```

---

## 2. Claude Code OAuth Authentication

Workers run Claude Code, which requires Anthropic OAuth credentials. The credentials are stored in a shared Docker volume (`claude-auth`) and must be created by authenticating **as the same non-root user** that workers run as (UID 1001, `worker`). Claude Code ties OAuth tokens to the user and home directory, so authenticating as root will not work for the worker containers.

> **Important:** Do NOT pass `ANTHROPIC_API_KEY` to the worker containers. If set, Claude Code will try to use it as an API key instead of falling back to OAuth credentials. The PM Agent uses `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) for its own LLM calls, but workers authenticate via OAuth only.

### Initial OAuth setup

1. Find the host path for the `claude-auth` Docker volume:
   ```bash
   docker volume inspect <project-prefix>_claude-auth --format '{{.Mountpoint}}'
   ```

2. Create required directories and files in the volume:
   ```bash
   CLAUDE_AUTH_PATH=$(docker volume inspect <project-prefix>_claude-auth --format '{{.Mountpoint}}')
   sudo mkdir -p "$CLAUDE_AUTH_PATH/debug"
   echo '{}' | sudo tee "$CLAUDE_AUTH_PATH/remote-settings.json"
   sudo chmod -R 777 "$CLAUDE_AUTH_PATH"
   ```

3. Run Claude Code interactively **using the worker image** (this runs as the `worker` user, UID 1001):
   ```bash
   docker run -it \
     -v <project-prefix>_claude-auth:/home/worker/.claude \
     --entrypoint sh \
     sbeardsley/linear-code-worker -c "claude --dangerously-skip-permissions"
   ```

4. Copy the URL displayed in the terminal, paste it into your browser, and complete the Anthropic login.

5. Once authenticated, verify it works:
   ```bash
   docker run -it --rm \
     --entrypoint sh \
     -v <project-prefix>_claude-auth:/home/worker/.claude \
     sbeardsley/linear-code-worker -c "claude -p 'say hello' --dangerously-skip-permissions"
   ```
   If Claude responds, authentication is working.

6. The token-refresh sidecar will keep credentials fresh automatically (refreshes every 5 minutes, 30 minutes before expiry).

### How workers access the credentials

The PM Agent spawns worker containers with a bind mount pointing to the Docker volume's host path:

```
HOST_CLAUDE_AUTH_PATH=/var/lib/docker/volumes/<project-prefix>_claude-auth/_data
```

To find your volume's host path:

```bash
docker volume inspect <project-prefix>_claude-auth --format '{{.Mountpoint}}'
```

Workers mount this **read-write** at `/home/worker/.claude` (not read-only — Claude Code needs to write debug logs and cache files).

### Volume permissions

The `claude-auth` volume must be writable by the worker user (UID 1001). Multiple workers can share the volume concurrently — Claude Code is designed to handle this.

```bash
CLAUDE_AUTH_PATH=$(docker volume inspect <project-prefix>_claude-auth --format '{{.Mountpoint}}')
sudo chmod -R 777 "$CLAUDE_AUTH_PATH"
```

### Verifying credentials are fresh

```bash
# Check the credentials file
sudo cat $(docker volume inspect <project-prefix>_claude-auth --format '{{.Mountpoint}}')/.credentials.json | jq .

# Check token-refresh sidecar logs
docker logs <token-refresh-container-name> --tail 20
```

### Re-authenticating

If credentials expire or become invalid (e.g., after a password change or subscription change), repeat step 3 of the initial OAuth setup — run `claude --dangerously-skip-permissions` interactively using the worker image and complete the browser flow again.

---

## 3. Environment Variables

### PM Agent Environment Variables

| Variable | Description | Example |
|---|---|---|
| `LINEAR_API_KEY` | Linear API key for reading/updating issues | `lin_api_...` |
| `LINEAR_WEBHOOK_SECRET` | HMAC secret for validating Linear webhooks | `whsec_...` |
| `ANTHROPIC_API_KEY` | Anthropic API key (for PM agent LLM calls, not workers) | `sk-ant-...` |
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope (for PR creation) | `ghp_...` |
| `AGENT_KEY` | Shared secret for worker callback authentication | Any strong random string |
| `PORT` | PM Agent server port | `3000` |
| `LOG_LEVEL` | Pino log level | `info` |
| `PM_AGENT_MODEL` | LLM model for the PM agent | `gpt-5-nano` |

### Worker Configuration

| Variable | Description | Default |
|---|---|---|
| `REPO_URL` | Default Git SSH URL for the target repository | `git@github.com:org/repo.git` |
| `WORKER_IMAGE` | Docker image for worker containers | `sbeardsley/linear-code-worker:latest` |
| `WORKER_NETWORK` | Docker network for worker ↔ PM Agent communication | `pm-agent-net` |
| `WORKER_TIMEOUT` | Max worker runtime in seconds | `1800` (30 min) |
| `WORKER_MAX_TURNS` | Max Claude Code conversation turns per worker | `50` |
| `CALLBACK_BASE_URL` | URL workers use to call back to PM Agent | `http://pm-agent:3000` |
| `BASE_BRANCH` | Git branch to branch from | `main` |

### Host Path Configuration

| Variable | Description | Example |
|---|---|---|
| `HOST_SSH_PATH` | Host path to SSH keys directory | `/opt/worker-ssh` |
| `HOST_CLAUDE_AUTH_PATH` | Host path to Claude auth credentials | `/var/lib/docker/volumes/<prefix>_claude-auth/_data` |

### Worker Container Environment (auto-injected)

These are set automatically by the PM Agent when spawning workers — you don't configure these manually:

| Variable | Description |
|---|---|
| `ISSUE_ID` | Linear issue UUID |
| `LINEAR_ISSUE_ID` | Linear issue UUID (alias) |
| `ISSUE_IDENTIFIER` | Linear issue identifier (e.g., `SQU-18`) |
| `ISSUE_TITLE` | Issue title |
| `TASK_DESCRIPTION` | Full task prompt for Claude Code |
| `BRANCH_NAME` | Git branch name (auto-generated) |
| `BASE_BRANCH` | Branch to branch from |
| `REPO_URL` | Repository SSH URL |
| `ANTHROPIC_API_KEY` | Passed through for Claude Code |
| `LINEAR_API_KEY` | Passed through for issue updates |
| `CALLBACK_URL` | Full callback endpoint URL |
| `AGENT_KEY` | Callback authentication key |
| `WORKER_TIMEOUT` | Timeout in seconds |
| `WORKER_MAX_TURNS` | Max Claude Code turns |

---

## Troubleshooting

### Worker fails immediately with no git error

The entrypoint captures clone errors but if SSH fails silently, you'll just see "Sending callback: failed". Debug by running manually:

```bash
docker run -it --rm \
  --entrypoint sh \
  -v /opt/worker-ssh:/home/worker/.ssh:ro \
  sbeardsley/linear-code-worker -c "git clone git@github.com:org/repo.git /tmp/test 2>&1"
```

### "Permission denied (publickey)" during clone

- Verify the deploy key is added to the correct GitHub repo with write access
- Check SSH key ownership: `ls -la /opt/worker-ssh/` (should be `1001:1001`)
- Test SSH: `docker run -it --rm --entrypoint sh -v /opt/worker-ssh:/home/worker/.ssh:ro sbeardsley/linear-code-worker -c "ssh -T git@github.com 2>&1"`

### "--dangerously-skip-permissions cannot be used with root/sudo"

The worker Dockerfile must include a non-root user and `USER worker` directive. Claude Code refuses to run as root with this flag.

### "Worker already running for issue"

The PM Agent tracks workers in memory. If a worker crashed without calling back, the PM Agent still thinks it's running. Restart the PM Agent to clear stale tracking:

```bash
docker restart <pm-agent-container-name>
```

### Worker image not found (404)

Ensure the image is built for the correct platform. If building on Apple Silicon (arm64) for a Linux amd64 server:

```bash
docker buildx build --platform linux/amd64 -t sbeardsley/linear-code-worker:latest --push .
```
