#!/bin/bash
set -e

# Align container's docker group GID with the host's docker socket GID
# so the agent user can spawn worker containers.
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  if [ "$SOCK_GID" != "0" ]; then
    groupmod -g "$SOCK_GID" docker 2>/dev/null || true
  else
    # Socket owned by root:root — add agent to root group
    usermod -aG 0 agent 2>/dev/null || true
  fi
fi

exec gosu agent node dist/index.js
