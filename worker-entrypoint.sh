#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
TIMEOUT="${TIMEOUT:-1800}"
MAX_TURNS="${MAX_TURNS:-50}"
TASK_PROMPT="${TASK_PROMPT:-${TASK_DESCRIPTION:-}}"
SSH_DIR="/home/worker/.ssh"

# ─── State ───────────────────────────────────────────────────────────────────
CALLBACK_SENT=0
CLAUDE_PID=""
WATCHDOG_PID=""
STATUS="failed"
ERROR_MSG=""

# ─── Validate required env vars ──────────────────────────────────────────────
fail() { echo "FATAL: $1" >&2; exit 1; }

[ -z "${REPO_URL:-}" ]    && fail "REPO_URL is required"
[ -z "${BRANCH_NAME:-}" ] && fail "BRANCH_NAME is required"
[ -z "${TASK_PROMPT:-}" ] && fail "TASK_PROMPT (or TASK_DESCRIPTION) is required"

echo "=== Claude Worker ==="
echo "Repo:    $REPO_URL"
echo "Branch:  $BRANCH_NAME"
echo "Timeout: ${TIMEOUT}s"
echo "Turns:   $MAX_TURNS"

# ─── Callback helper ────────────────────────────────────────────────────────
send_callback() {
    if [ "$CALLBACK_SENT" -eq 1 ]; then
        return
    fi

    local cb_status="${1:-$STATUS}"
    local cb_error="${2:-$ERROR_MSG}"

    if [ -z "${CALLBACK_URL:-}" ]; then
        echo "No CALLBACK_URL set, skipping callback."
        CALLBACK_SENT=1
        return
    fi

    local payload
    payload=$(jq -n \
        --arg status "$cb_status" \
        --arg branch "$BRANCH_NAME" \
        --arg error "$cb_error" \
        --arg issueId "${LINEAR_ISSUE_ID:-}" \
        --arg issueIdentifier "${ISSUE_IDENTIFIER:-}" \
        --arg issueTitle "${ISSUE_TITLE:-}" \
        --arg repoUrl "${REPO_URL:-}" \
        '{status: $status, branch: $branch, error: $error, issueId: $issueId, issueIdentifier: $issueIdentifier, issueTitle: $issueTitle, repoUrl: $repoUrl}')

    echo "Sending callback: $cb_status"
    local attempt
    for attempt in 1 2 3; do
        if curl -sf -X POST "$CALLBACK_URL" \
            -H "Content-Type: application/json" \
            -H "x-agent-key: ${AGENT_KEY:-}" \
            -d "$payload" \
            --max-time 10; then
            echo "Callback sent successfully."
            CALLBACK_SENT=1
            return
        fi
        echo "Callback attempt $attempt failed, retrying..."
        sleep 2
    done
    echo "WARNING: All callback attempts failed."
    CALLBACK_SENT=1
}

# ─── Cleanup / signal handling ───────────────────────────────────────────────
cleanup() {
    local exit_code="${1:-$?}"

    # Kill watchdog if running
    if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        kill "$WATCHDOG_PID" 2>/dev/null || true
    fi

    # Kill claude if running
    if [ -n "$CLAUDE_PID" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
        kill "$CLAUDE_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$CLAUDE_PID" 2>/dev/null || true
    fi

    # Detect timeout from signal-based exit codes
    if [ "$exit_code" -eq 143 ] || [ "$exit_code" -eq 137 ]; then
        STATUS="failed"
        ERROR_MSG="Task timed out after ${TIMEOUT}s"
    fi

    send_callback "$STATUS" "$ERROR_MSG"
}

trap 'cleanup $?' EXIT
trap 'STATUS="failed"; ERROR_MSG="Received SIGTERM"; exit 143' TERM
trap 'STATUS="failed"; ERROR_MSG="Received SIGINT"; exit 130' INT

# ─── SSH setup ───────────────────────────────────────────────────────────────
# Use GIT_SSH_COMMAND to handle read-only .ssh mounts cleanly
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

if [ -f "$SSH_DIR/linear_worker_key" ]; then
    export GIT_SSH_COMMAND="$GIT_SSH_COMMAND -i $SSH_DIR/linear_worker_key"
elif [ -f "$SSH_DIR/id_ed25519" ]; then
    export GIT_SSH_COMMAND="$GIT_SSH_COMMAND -i $SSH_DIR/id_ed25519"
elif [ -f "$SSH_DIR/id_rsa" ]; then
    export GIT_SSH_COMMAND="$GIT_SSH_COMMAND -i $SSH_DIR/id_rsa"
fi

# ─── Git config ──────────────────────────────────────────────────────────────
git config --global user.name "Claude Worker"
git config --global user.email "claude-worker@noreply"

# ─── Clone repo ─────────────────────────────────────────────────────────────
echo "Cloning $REPO_URL ..."
if ! clone_output=$(git clone "$REPO_URL" /workspace/repo 2>&1); then
    ERROR_MSG="Failed to clone repository: ${clone_output}"
    exit 1
fi
cd /workspace/repo

# ─── Create or checkout branch ───────────────────────────────────────────────
echo "Setting up branch: $BRANCH_NAME"
if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
    echo "Branch exists remotely, checking out..."
    git checkout "$BRANCH_NAME"
else
    echo "Creating new branch: $BRANCH_NAME"
    git checkout -b "$BRANCH_NAME"
fi

# ─── Timeout watchdog ───────────────────────────────────────────────────────
(
    sleep "$TIMEOUT"
    echo "TIMEOUT: ${TIMEOUT}s elapsed, killing worker (PID $$)..."
    kill -TERM $$ 2>/dev/null || true
    sleep 10
    kill -KILL $$ 2>/dev/null || true
) &
WATCHDOG_PID=$!

# ─── Run Claude Code ────────────────────────────────────────────────────────
echo "Running Claude Code..."
claude -p "$TASK_PROMPT" \
    --allowedTools "Edit,Write,Bash,Read" \
    --max-turns "$MAX_TURNS" \
    --dangerously-skip-permissions &
CLAUDE_PID=$!

if ! wait "$CLAUDE_PID"; then
    CLAUDE_EXIT=$?
    # Check if this was a timeout-induced kill
    if [ "$CLAUDE_EXIT" -eq 143 ] || [ "$CLAUDE_EXIT" -eq 137 ]; then
        STATUS="failed"
        ERROR_MSG="Claude process timed out after ${TIMEOUT}s"
        exit "$CLAUDE_EXIT"
    fi
    ERROR_MSG="Claude exited with code $CLAUDE_EXIT"
    exit 1
fi
CLAUDE_PID=""

# ─── Stage and commit any remaining changes ─────────────────────────────────
echo "Checking for changes..."
git add -A

if git diff --cached --quiet; then
    ERROR_MSG="No changes produced by Claude"
    echo "FAILURE: $ERROR_MSG"
    exit 1
fi

echo "Committing changes..."
git commit -m "feat: apply changes from Claude worker

Task: ${TASK_PROMPT:0:200}
Issue: ${LINEAR_ISSUE_ID:-none}"

# ─── Push branch ────────────────────────────────────────────────────────────
echo "Pushing branch $BRANCH_NAME ..."
if ! push_output=$(git push -u origin "$BRANCH_NAME" 2>&1); then
    ERROR_MSG="Failed to push branch: ${push_output}"
    exit 1
fi

# ─── Success ─────────────────────────────────────────────────────────────────
STATUS="completed"
ERROR_MSG=""
echo "=== Worker completed successfully ==="
