#!/usr/bin/env bash
set -euo pipefail

# spawn-skill.sh <skill-name> <payload-file>
#
# Called by the state machine (inside the PM agent) to spawn an isolated
# container for a specific skill.  The container gets its own filesystem,
# Claude session, and full env — so skills can clone repos, run gh CLI,
# or spawn sub-workers without affecting the PM agent.

SKILL="${1:?Usage: spawn-skill.sh <skill> <payload-file>}"
PAYLOAD_FILE="${2:?Usage: spawn-skill.sh <skill> <payload-file>}"

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "ERROR: Payload file not found: $PAYLOAD_FILE" >&2
  exit 1
fi

# Base64 encode the payload for safe transport via env var
WEBHOOK_PAYLOAD_B64=$(base64 -w 0 < "$PAYLOAD_FILE")

CONTAINER_NAME="skill-${SKILL}-${ISSUE_IDENTIFIER:-unknown}-$(date +%s)"

echo "Spawning skill container: ${CONTAINER_NAME} (skill=${SKILL})"

docker run -d --rm \
  --name "$CONTAINER_NAME" \
  --network "${WORKER_NETWORK:-pm-agent-net}" \
  --group-add "${DOCKER_GID:-999}" \
  -e "WEBHOOK_PAYLOAD_B64=${WEBHOOK_PAYLOAD_B64}" \
  -e "SKILL=${SKILL}" \
  -e "LINEAR_API_KEY=${LINEAR_API_KEY:-}" \
  -e "GITHUB_TOKEN=${GITHUB_TOKEN:-}" \
  -e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}" \
  -e "ISSUE_ID=${ISSUE_ID:-}" \
  -e "ISSUE_IDENTIFIER=${ISSUE_IDENTIFIER:-}" \
  -e "AGENT_KEY=${AGENT_KEY:-}" \
  -e "ACTIVITY_COMMENT_ID=${ACTIVITY_COMMENT_ID:-}" \
  -e "CALLBACK_URL=http://pm-agent:3000/api/worker/complete" \
  -e "LINEAR_ISSUE_ID=${LINEAR_ISSUE_ID:-${ISSUE_ID:-}}" \
  -e "ISSUE_TITLE=${ISSUE_TITLE:-}" \
  -e "MAX_TURNS=${MAX_TURNS:-50}" \
  -e "WORKER_NETWORK=${WORKER_NETWORK:-pm-agent-net}" \
  -e "HOST_SSH_PATH=${HOST_SSH_PATH:-/root/.ssh}" \
  -e "HOST_CLAUDE_AUTH_PATH=${HOST_CLAUDE_AUTH_PATH:-claude-auth}" \
  -e "MAX_WIP=${MAX_WIP:-3}" \
  -e "MAX_REVIEW_CYCLES=${MAX_REVIEW_CYCLES:-3}" \
  -e "BASE_BRANCH=${BASE_BRANCH:-main}" \
  -e "WORKER_TIMEOUT=${WORKER_TIMEOUT:-1800}" \
  -e "WORKER_MAX_TURNS=${WORKER_MAX_TURNS:-50}" \
  -e "DOCKER_GID=${DOCKER_GID:-999}" \
  -v "/var/run/docker.sock:/var/run/docker.sock" \
  -v "${HOST_CLAUDE_AUTH_PATH:-claude-auth}:/home/agent/.claude" \
  -v "${HOST_SSH_PATH:-/root/.ssh}:/home/agent/.ssh:ro" \
  --entrypoint "sm-entrypoint.sh" \
  "${SM_IMAGE:-pm-agent:latest}"

echo "Container ${CONTAINER_NAME} spawned successfully"
