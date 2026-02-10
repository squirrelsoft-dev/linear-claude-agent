FROM node:22-slim

# Install Docker CLI (for spawning workers), Claude Code CLI, gh CLI, and jq
RUN apt-get update && \
    apt-get install -y --no-install-recommends docker.io curl jq ca-certificates git openssh-client && \
    ARCH="$(dpkg --print-architecture)" && \
    GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | jq -r .tag_name | sed 's/^v//')" && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1 && \
    npm install -g @anthropic-ai/claude-code && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user (Claude Code refuses root + --dangerously-skip-permissions)
RUN useradd -m -s /bin/bash agent \
    && mkdir -p /home/agent/.ssh && chmod 700 /home/agent/.ssh \
    && chown -R agent:agent /home/agent

# Add agent user to docker group so it can spawn worker containers
RUN usermod -aG docker agent

# Configure git identity
RUN git config --global user.name "PM Agent" \
    && git config --global user.email "pm-agent@noreply"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --production

# Copy skills directory into the container
COPY .claude .claude

# Ensure agent user owns the app directory
RUN chown -R agent:agent /app

EXPOSE 3000

USER agent

CMD ["node", "dist/index.js"]
