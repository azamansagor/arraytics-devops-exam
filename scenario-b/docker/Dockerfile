# syntax=docker/dockerfile:1
#
# Multi-stage build for the Notes API.
#
# Build context is scenario-b/app, so paths below are relative to the app folder:
#   docker build -f scenario-b/docker/Dockerfile -t notes-api-zaman:multi scenario-b/app
#
# Two stages. The first resolves dependencies with npm and keeps npm's cache and
# metadata; the second starts from a clean base and receives only the resolved
# node_modules tree and the source. Nothing npm wrote while working is carried
# forward, and no package manager work happens in the image that ships.

# ---------------------------------------------------------------------------
# Stage 1 - dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Only the manifests, before the source. This layer is keyed on package.json and
# package-lock.json alone, so editing server.js leaves it cached and the install
# does not run again - which is the caching behaviour Task 23 measures.
COPY package.json package-lock.json ./

# ci, not install: it installs exactly what the lockfile pins and fails if the two
# disagree, rather than quietly resolving something newer. --omit=dev keeps
# devDependencies out of the tree that gets copied forward.
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 2 - runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# node:*-alpine already ships an unprivileged 'node' user (uid 1000). Files are
# chowned to it as they are copied, so the app never needs to write as root and
# never needs a chown layer of its own.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node db.js server.js migrate.js seed.js schema.sql ./

USER node

EXPOSE 3000

# /healthz deliberately does not touch the database, so this reports on the
# process only. A healthcheck that queried Postgres would mark the container
# unhealthy during a database blip and have Docker or ECS restart something that
# was working. wget comes from busybox in the alpine base - no curl to install.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/healthz" || exit 1

# Exec form, so node is PID 1 and receives SIGTERM directly. In shell form a
# /bin/sh would be PID 1, the signal would stop there, and the graceful shutdown
# in server.js would never run - which is what breaks zero-downtime deploys.
CMD ["node", "server.js"]
