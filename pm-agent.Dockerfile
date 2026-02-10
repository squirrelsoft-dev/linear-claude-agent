FROM node:22-slim

# Install Docker CLI (for spawning workers) and Claude Code CLI
RUN apt-get update && \
    apt-get install -y --no-install-recommends docker.io curl && \
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
