FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
# Copy all workspaces before installation so a new registered game needs no Dockerfile list edit.
COPY . .
RUN npm ci
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/decorum-guy/iva-games" org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0 DATABASE_PATH=/data/remorse.sqlite STATIC_DIR=/app/dist
COPY --from=build /app/package.json /app/package-lock.json ./
COPY packages/game-registry/games.json ./game-registry.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY apps/server/scripts/backup.mjs ./apps/server/scripts/backup.mjs
COPY scripts/chess-health.mjs ./chess-health.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "/app/chess-health.mjs"]
CMD ["node", "dist-server/main.js"]
