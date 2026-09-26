FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS builder
ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npx esbuild lib/ws-handler.ts --bundle --platform=node --format=cjs --packages=external --outfile=ws-handler-compiled.cjs
RUN npx esbuild scripts/seed-native-test.ts --bundle --platform=node --format=cjs --packages=external --outfile=seed-native-test.cjs

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV EIDON_DATA_DIR=/app/data
ENV HOME=/app/data/home
ENV TMPDIR=/app/data/tmp
ENV XDG_RUNTIME_DIR=/app/data/runtime
ENV AGENT_BROWSER_SOCKET_DIR=/app/data/runtime/agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

# Install uv for uvx (Python-based MCP servers)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

RUN apt-get update && apt-get install -y --no-install-recommends chromium python3 \
    && ln -s /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g agent-browser@0.38.1 \
    && find "$(npm root -g)/agent-browser/bin" -name 'agent-browser-*' ! -name "agent-browser-linux-$(node -p process.arch)" -delete \
    && npm cache clean --force

RUN groupadd --system eidon && useradd --system --gid eidon eidon
COPY --from=builder --chown=eidon:eidon /app/.next/standalone ./
COPY --from=builder --chown=eidon:eidon /app/.next/static ./.next/static
COPY --from=builder --chown=eidon:eidon /app/public ./public
COPY --from=builder --chown=eidon:eidon /app/server.cjs ./server.cjs
COPY --from=builder --chown=eidon:eidon /app/ws-handler-compiled.cjs ./ws-handler-compiled.cjs
COPY --from=builder --chown=eidon:eidon /app/seed-native-test.cjs ./seed-native-test.cjs
COPY --from=prod-deps --chown=eidon:eidon /app/node_modules ./node_modules
RUN rm -rf ./node_modules/onnxruntime-web/dist \
    && install -d -m 700 -o eidon -g eidon /app/data /app/data/home /app/data/tmp /app/data/runtime /app/data/runtime/agent-browser
USER eidon
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.cjs"]
