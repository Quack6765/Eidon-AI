FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npx esbuild lib/ws-handler.ts --bundle --platform=node --format=cjs --packages=external --outfile=ws-handler-compiled.cjs

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV EIDON_DATA_DIR=/app/data
ENV EIDON_PASSWORD_LOGIN_ENABLED=true
ENV HOME=/app/data/home
ENV TMPDIR=/app/data/tmp
ENV XDG_RUNTIME_DIR=/app/data/runtime
ENV AGENT_BROWSER_SOCKET_DIR=/app/data/runtime/agent-browser

# Install uv for uvx (Python-based MCP servers)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Install chromium and agent-browser
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g agent-browser \
    && mv /usr/local/bin/agent-browser /usr/local/bin/agent-browser-core \
    && printf '#!/bin/sh\nexec agent-browser-core --executable-path /usr/bin/chromium "$@"\n' > /usr/local/bin/agent-browser \
    && chmod +x /usr/local/bin/agent-browser

RUN groupadd --system eidon && useradd --system --gid eidon eidon
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.cjs ./server.cjs
COPY --from=builder /app/ws-handler-compiled.cjs ./ws-handler-compiled.cjs
COPY --from=prod-deps /app/node_modules ./node_modules
RUN install -d -m 700 /app/data /app/data/home /app/data/tmp /app/data/runtime /app/data/runtime/agent-browser \
    && chown -R eidon:eidon /app
USER eidon
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.cjs"]
