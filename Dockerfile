FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY games/chess/remorse/package.json ./games/chess/remorse/package.json
COPY games/chess/overdrive/package.json ./games/chess/overdrive/package.json
COPY packages/engine-sdk/package.json ./packages/engine-sdk/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/platform/package.json ./apps/platform/package.json
COPY apps/portal/package.json ./apps/portal/package.json
COPY packages/session-kit/package.json ./packages/session-kit/package.json
COPY packages/telegram-transport/package.json ./packages/telegram-transport/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/decorum-guy/iva-games" org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0 DATABASE_PATH=/data/remorse.sqlite STATIC_DIR=/app/dist
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY apps/server/scripts/backup.mjs ./apps/server/scripts/backup.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "Promise.all(['/api/health','/api/overdrive/health'].map(p=>fetch('http://127.0.0.1:4173'+p,{signal:AbortSignal.timeout(3000)}))).then(rs=>{if(rs.some(r=>!r.ok))process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/main.js"]
