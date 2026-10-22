# Bump together with the `convex` npm package and `pnpm dev`'s
# --local-backend-version, and run `convex export` first: upgrades migrate the
# data in place and can't be rolled back (ADR 0001).
ARG CONVEX_BACKEND=ghcr.io/convex/convex-backend:72ce13c379fe6dbdfc305bc8ad699c5663c68c2a

FROM ${CONVEX_BACKEND} AS base
WORKDIR /app
RUN npm install --global pnpm@12.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# `convex deploy` bundles the functions at boot, so it needs their dependencies.
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ${CONVEX_BACKEND}
# Convex stays on loopback; browsers reach it through Start's /convex proxy.
# The isolate limits default to 64 MiB, too tight for Attachments.
ENV CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210 \
    CONVEX_SITE_ORIGIN=http://127.0.0.1:3210/http \
    DISABLE_BEACON=1 \
    REDACT_LOGS_TO_CLIENT=1 \
    ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE=268435456 \
    ISOLATE_MAX_USER_HEAP_SIZE=268435456
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/.output .output
COPY package.json ./
COPY convex convex
COPY scripts/entrypoint.sh ./
EXPOSE 3000
# The app starts only after Convex is deployed and seeded.
HEALTHCHECK --interval=30s --start-period=3m --start-interval=2s \
  CMD curl -fs http://127.0.0.1:3000/login >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
