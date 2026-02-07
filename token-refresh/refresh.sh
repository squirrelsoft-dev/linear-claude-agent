#!/usr/bin/env bash
set -euo pipefail

CREDENTIALS_FILE="/root/.claude/.credentials.json"
LOCK_FILE="/root/.claude/.credentials.lock"
REFRESH_URL="https://console.anthropic.com/v1/oauth/token"
CHECK_INTERVAL=300  # 5 minutes
EXPIRY_BUFFER=1800  # 30 minutes

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
}

refresh_token() {
  local refresh_token="$1"
  local client_id="$2"
  local attempt=0
  local max_retries=3
  local backoff=2

  while [ "$attempt" -lt "$max_retries" ]; do
    local http_code
    local response

    response=$(curl -s -w "\n%{http_code}" -X POST "$REFRESH_URL" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "grant_type=refresh_token" \
      -d "refresh_token=${refresh_token}" \
      -d "client_id=${client_id}" \
      2>/dev/null) || true

    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
      echo "$body"
      return 0
    fi

    if [ "$http_code" = "400" ] || [ "$http_code" = "401" ]; then
      log "ERROR: Refresh token rejected (HTTP $http_code). Manual re-authentication required."
      log "ERROR: Run 'claude' interactively to re-authenticate, then restart the sidecar."
      exit 1
    fi

    attempt=$((attempt + 1))
    if [ "$attempt" -lt "$max_retries" ]; then
      log "WARN: Token refresh failed (HTTP $http_code), retrying in ${backoff}s (attempt $attempt/$max_retries)"
      sleep "$backoff"
      backoff=$((backoff * 2))
    fi
  done

  log "ERROR: Token refresh failed after $max_retries attempts"
  return 1
}

write_credentials() {
  local new_data="$1"

  (
    flock -x 200

    # Backup current credentials
    if [ -f "$CREDENTIALS_FILE" ]; then
      cp "$CREDENTIALS_FILE" "${CREDENTIALS_FILE}.backup"
    fi

    # Atomic write: write to tmp then move
    echo "$new_data" > "${CREDENTIALS_FILE}.tmp"
    mv "${CREDENTIALS_FILE}.tmp" "$CREDENTIALS_FILE"

    log "INFO: Credentials written successfully"
  ) 200>"$LOCK_FILE"
}

check_and_refresh() {
  if [ ! -f "$CREDENTIALS_FILE" ]; then
    log "WARN: Credentials file not found at $CREDENTIALS_FILE, skipping cycle"
    return 0
  fi

  local creds
  creds=$(cat "$CREDENTIALS_FILE" 2>/dev/null) || {
    log "WARN: Failed to read credentials file, skipping cycle"
    return 0
  }

  # Validate JSON
  if ! echo "$creds" | jq empty 2>/dev/null; then
    log "WARN: Credentials file is malformed JSON, skipping cycle"
    return 0
  fi

  local expires_at
  expires_at=$(echo "$creds" | jq -r '.expiresAt // empty') || true

  if [ -z "$expires_at" ]; then
    log "WARN: No expiresAt field in credentials, skipping cycle"
    return 0
  fi

  local now
  now=$(date +%s)

  # expiresAt may be in ISO format or epoch ms — handle both
  local expires_epoch
  if echo "$expires_at" | grep -qE '^[0-9]+$'; then
    # Epoch milliseconds
    expires_epoch=$((expires_at / 1000))
  else
    # ISO 8601 string
    expires_epoch=$(date -d "$expires_at" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%S" "$expires_at" +%s 2>/dev/null || echo 0)
  fi

  local remaining=$((expires_epoch - now))

  if [ "$remaining" -gt "$EXPIRY_BUFFER" ]; then
    log "INFO: Token still valid (expires in $((remaining / 60))m), no refresh needed"
    return 0
  fi

  log "INFO: Token expires in $((remaining / 60))m (< ${EXPIRY_BUFFER}s buffer), refreshing..."

  local current_refresh_token
  current_refresh_token=$(echo "$creds" | jq -r '.refreshToken // empty')

  if [ -z "$current_refresh_token" ]; then
    log "WARN: No refreshToken in credentials, skipping cycle"
    return 0
  fi

  local client_id
  client_id=$(echo "$creds" | jq -r '.clientId // empty')

  if [ -z "$client_id" ]; then
    log "WARN: No clientId in credentials, skipping cycle"
    return 0
  fi

  local new_tokens
  new_tokens=$(refresh_token "$current_refresh_token" "$client_id") || {
    log "ERROR: Token refresh failed, will retry next cycle"
    return 0
  }

  # Merge new tokens into existing credentials
  local updated
  updated=$(echo "$creds" | jq \
    --argjson new "$new_tokens" \
    '. * {
      accessToken: ($new.access_token // .accessToken),
      refreshToken: ($new.refresh_token // .refreshToken),
      expiresAt: ($new.expires_at // ($new.expires_in * 1000 + (now * 1000)) // .expiresAt)
    }')

  write_credentials "$updated"
  log "INFO: Token refreshed successfully"
}

# --- Main loop ---

log "INFO: Token refresh sidecar starting"
log "INFO: Watching $CREDENTIALS_FILE every ${CHECK_INTERVAL}s (refresh when < ${EXPIRY_BUFFER}s remaining)"

while true; do
  check_and_refresh || log "WARN: Check cycle failed, continuing..."
  sleep "$CHECK_INTERVAL"
done
