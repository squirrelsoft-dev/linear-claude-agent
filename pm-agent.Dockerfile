FROM node:22-slim

# Install Docker CLI (for spawning workers), Claude Code CLI, gh CLI, and jq
ARG GH_VERSION=2.67.0
RUN apt-get update && \
    apt-get install -y --no-install-recommends docker.io curl jq && \
    ARCH="$(dpkg --print-architecture)" && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1 && \
    npm install -g @anthropic-ai/claude-code && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --production

# Copy skills directory into the container
COPY .claude .claude

EXPOSE 3000

CMD ["node", "dist/index.js"]
