#!/usr/bin/env bash
set -euo pipefail

# Skill container entrypoint — decodes payload and runs Claude with the specified skill.
# Called by Docker; not invoked directly.
#
# For implement/implement-revision skills: configures SSH, git identity, timeout,
# restricted tools, and an EXIT trap that sends a failure callback if Claude exits
# without sending a success callback.
#
# For all other skills (triage, review, completion, cleanup, respond): runs Claude
# directly with exec.

PAYLOAD_FILE="/tmp/payload.json"
echo "${WEBHOOK_PAYLOAD_B64}" | base64 -d > "$PAYLOAD_FILE"

SKILL="${SKILL:-state-machine}"
SKILL_FILE=".claude/skills/${SKILL}.md"

# ─── Implement / implement-revision: worker-level settings ──────────────────
if [[ "$SKILL" == "implement" || "$SKILL" == "implement-revision" ]]; then

  # SSH key detection
  SSH_DIR="/home/agent/.ssh"
  export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
  for key in linear_worker_key id_ed25519 id_rsa; do
    if [ -f "$SSH_DIR/$key" ]; then
      export GIT_SSH_COMMAND="$GIT_SSH_COMMAND -i $SSH_DIR/$key"
      break
    fi
  done

  # Git config for worker commits
  git config --global user.name "Claude Worker"
  git config --global user.email "claude-worker@noreply"

  # EXIT trap — sends failure callback if Claude exits without sending one
  send_failure_callback() {
    [ -f /tmp/.callback_sent ] && return 0

    local branch="" repo_url=""
    [ -f /tmp/.branch_name ] && branch=$(cat /tmp/.branch_name)
    [ -f /tmp/.repo_url ] && repo_url=$(cat /tmp/.repo_url)

    local error_msg="Claude exited with code ${CLAUDE_EXIT:-1}"
    [ "${CLAUDE_EXIT:-1}" -eq 124 ] && error_msg="Task timed out after ${WORKER_TIMEOUT:-1800}s"

    [ -z "${CALLBACK_URL:-}" ] && return 0

    local payload
    payload=$(jq -n \
      --arg status "failed" \
      --arg branch "$branch" \
      --arg error "$error_msg" \
      --arg issueId "${LINEAR_ISSUE_ID:-${ISSUE_ID:-}}" \
      --arg issueIdentifier "${ISSUE_IDENTIFIER:-}" \
      --arg issueTitle "${ISSUE_TITLE:-}" \
      --arg repoUrl "$repo_url" \
      '{status: $status, branch: $branch, error: $error, issueId: $issueId, issueIdentifier: $issueIdentifier, issueTitle: $issueTitle, repoUrl: $repoUrl}')

    curl -sf -X POST "$CALLBACK_URL" \
      -H "Content-Type: application/json" \
      -H "x-agent-key: ${AGENT_KEY:-}" \
      -d "$payload" --max-time 10 2>/dev/null || true
  }
  trap send_failure_callback EXIT

  # No exec — shell stays alive for the trap
  CLAUDE_EXIT=0
  timeout "${WORKER_TIMEOUT:-1800}" claude \
    -p "Read the payload from ${PAYLOAD_FILE} and follow ${SKILL_FILE}" \
    --dangerously-skip-permissions \
    --max-turns "${WORKER_MAX_TURNS:-50}" \
    --allowedTools "Edit,Write,Bash,Read,Glob,Grep" \
    || CLAUDE_EXIT=$?

  exit "$CLAUDE_EXIT"

# ─── All other skills: unchanged ────────────────────────────────────────────
else
  exec claude -p "Read the payload from ${PAYLOAD_FILE} and follow ${SKILL_FILE}" \
    --dangerously-skip-permissions \
    --max-turns "${MAX_TURNS:-50}"
fi
