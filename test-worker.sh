#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="claude-worker:latest"

# Overridable test config
TEST_REPO_URL="${TEST_REPO_URL:-}"
TEST_BRANCH_NAME="${TEST_BRANCH_NAME:-ai/test-$(date +%s)}"
TEST_PROMPT="${TEST_PROMPT:-Create a file called hello.txt with the content 'Hello from Claude Worker'}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }
info() { echo -e "${YELLOW}INFO${NC}: $1"; }

# ─── Build ───────────────────────────────────────────────────────────────────
cmd_build() {
    info "Building Docker image: $IMAGE_NAME"
    docker build -t "$IMAGE_NAME" . || fail "Docker build failed"
    pass "Image built successfully"
}

# ─── Auth Test ───────────────────────────────────────────────────────────────
cmd_auth() {
    info "Testing Claude Max auth inside container..."

    # Check that ANTHROPIC_API_KEY is available
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
        fail "ANTHROPIC_API_KEY not set in environment"
    fi

    local output
    output=$(docker run --rm \
        -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
        --entrypoint "" \
        "$IMAGE_NAME" \
        claude -p "Reply with exactly: AUTH_OK" --max-turns 1 --dangerously-skip-permissions 2>&1) || true

    if echo "$output" | grep -q "AUTH_OK"; then
        pass "Claude auth works inside container"
    else
        echo "$output"
        fail "Claude auth test failed — expected AUTH_OK in output"
    fi
}

# ─── SSH Test ────────────────────────────────────────────────────────────────
cmd_ssh() {
    info "Testing SSH git clone inside container..."

    if [ -z "$TEST_REPO_URL" ]; then
        fail "TEST_REPO_URL is required for ssh test"
    fi

    if [ ! -d "$HOME/.ssh" ]; then
        fail "No ~/.ssh directory found for SSH key mount"
    fi

    local output
    output=$(docker run --rm \
        -v "$HOME/.ssh:/root/.ssh:ro" \
        --entrypoint "" \
        "$IMAGE_NAME" \
        bash -c "
            export GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR'
            git clone $TEST_REPO_URL /tmp/test-repo && echo 'CLONE_OK'
        " 2>&1) || true

    if echo "$output" | grep -q "CLONE_OK"; then
        pass "SSH git clone works inside container"
    else
        echo "$output"
        fail "SSH clone test failed"
    fi
}

# ─── Full E2E Test ───────────────────────────────────────────────────────────
cmd_full() {
    info "Running full E2E test..."

    if [ -z "$TEST_REPO_URL" ]; then
        fail "TEST_REPO_URL is required for full test"
    fi

    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
        fail "ANTHROPIC_API_KEY not set in environment"
    fi

    if [ ! -d "$HOME/.ssh" ]; then
        fail "No ~/.ssh directory found for SSH key mount"
    fi

    info "Branch: $TEST_BRANCH_NAME"
    info "Prompt: $TEST_PROMPT"

    local exit_code=0
    docker run --rm \
        -e REPO_URL="$TEST_REPO_URL" \
        -e BRANCH_NAME="$TEST_BRANCH_NAME" \
        -e TASK_PROMPT="$TEST_PROMPT" \
        -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
        -e TIMEOUT=300 \
        -e MAX_TURNS=10 \
        -v "$HOME/.ssh:/root/.ssh:ro" \
        "$IMAGE_NAME" || exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "E2E test completed — branch $TEST_BRANCH_NAME pushed"
    else
        fail "E2E test failed with exit code $exit_code"
    fi

    # Verify branch exists on remote
    info "Verifying branch on remote..."
    local verify_output
    verify_output=$(docker run --rm \
        -v "$HOME/.ssh:/root/.ssh:ro" \
        --entrypoint "" \
        "$IMAGE_NAME" \
        bash -c "
            export GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR'
            git ls-remote --heads $TEST_REPO_URL $TEST_BRANCH_NAME
        " 2>&1) || true

    if echo "$verify_output" | grep -q "$TEST_BRANCH_NAME"; then
        pass "Branch $TEST_BRANCH_NAME verified on remote"
    else
        echo "$verify_output"
        fail "Branch $TEST_BRANCH_NAME not found on remote"
    fi
}

# ─── Usage ───────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Usage: $0 <command>

Commands:
  build   Build the Docker image
  auth    Test Claude auth inside container (requires ANTHROPIC_API_KEY)
  ssh     Test SSH git clone (requires TEST_REPO_URL, ~/.ssh keys)
  full    Full E2E test (requires TEST_REPO_URL, ANTHROPIC_API_KEY, ~/.ssh keys)

Environment variables:
  TEST_REPO_URL     Git SSH URL for test repo
  TEST_BRANCH_NAME  Branch name (default: ai/test-<timestamp>)
  TEST_PROMPT       Claude prompt (default: create hello.txt)
  ANTHROPIC_API_KEY API key for Claude auth
EOF
    exit 1
}

# ─── Main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
    build) cmd_build ;;
    auth)  cmd_build; cmd_auth ;;
    ssh)   cmd_build; cmd_ssh ;;
    full)  cmd_build; cmd_full ;;
    *)     usage ;;
esac
