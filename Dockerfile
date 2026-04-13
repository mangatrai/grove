# syntax=docker/dockerfile:1
#
# Household Finance App — production image (API + static SPA, no Postgres).
#
# Runtime expects the monorepo layout under /app so paths in backend/dist match
# repoRoot, frontend/dist, and backend/db/migrations.
#
# Required env (set in Koyeb / your orchestrator — do not bake secrets into the image):
#   MODE=PROD
#   JWT_SECRET=<min 16 chars>
#   DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME
#   DATABASE_SSL=1   (typical for managed Postgres; use 0 only for local/no-TLS)
# Optional: PORT (default 4000), OPENAI_* , LOG_LEVEL, TRANSFER_* , etc.
# See docs/ENVIRONMENT_VARIABLES.md
#
# Koyeb: set the same variables in the service "Environment". If Koyeb injects PORT,
# it must match the port the process listens on (this image defaults PORT=4000).
#
# Build for cloud AMD64 from an ARM machine:
#   docker buildx build --platform linux/amd64 -t your-registry/household-finance:latest --push .

# ---- install dependencies + build -------------------------------------------
FROM node:20-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci

COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
RUN npm run build && npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
# Default; SPA static serving + API — override in Koyeb if the platform assigns PORT.
ENV PORT=4000
ENV MODE=PROD

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p \
    data/imports \
    data/imports-restore-upload \
    data/imports-restore \
    .runtime/logs \
  && chown -R node:node /app

COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/backend/package.json ./backend/
COPY --from=builder --chown=node:node /app/backend/dist ./backend/dist
COPY --from=builder --chown=node:node /app/backend/db ./backend/db
COPY --from=builder --chown=node:node /app/frontend/dist ./frontend/dist

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const p=process.env.PORT||'4000';fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/server.js"]
