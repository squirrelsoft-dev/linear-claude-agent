FROM ubuntu:24.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies + Node.js 22 LTS in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    openssh-client \
    jq \
    ca-certificates \
    gnupg \
    sudo \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (Claude Code refuses root + --dangerously-skip-permissions)
RUN useradd -m -s /bin/bash worker \
    && mkdir -p /home/worker/.ssh && chmod 700 /home/worker/.ssh \
    && chown -R worker:worker /home/worker/.ssh

# Configure git identity for worker commits
RUN git config --global user.name "Claude Worker" \
    && git config --global user.email "claude-worker@noreply"

# Set working directory
RUN mkdir -p /workspace && chown worker:worker /workspace
WORKDIR /workspace

# Copy entrypoint script
COPY worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod 755 /usr/local/bin/worker-entrypoint.sh
RUN chmod +x /usr/local/bin/worker-entrypoint.sh

# Install Claude Code hooks for live activity feed (user-level settings)
COPY .claude/hooks /home/worker/.claude/hooks
COPY .claude/_settings.json /home/worker/.claude/settings.json
RUN sed -i 's|\$CLAUDE_PROJECT_DIR|/home/worker|g' /home/worker/.claude/settings.json \
    && chmod +x /home/worker/.claude/hooks/*.sh \
    && chown -R worker:worker /home/worker/.claude

USER worker

ENTRYPOINT ["worker-entrypoint.sh"]
