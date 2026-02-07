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
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Set up SSH directory (keys mounted at runtime)
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

# Configure git identity for worker commits
RUN git config --global user.name "Claude Worker" \
    && git config --global user.email "claude-worker@noreply"

# Set working directory
WORKDIR /workspace

# Copy entrypoint script
COPY worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod +x /usr/local/bin/worker-entrypoint.sh

ENTRYPOINT ["worker-entrypoint.sh"]
