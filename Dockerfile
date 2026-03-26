FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HERMES_DATA_DIR=/app/data
RUN groupadd --system hermes && useradd --system --gid hermes hermes
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN mkdir -p /app/data && chown -R hermes:hermes /app
USER hermes
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
