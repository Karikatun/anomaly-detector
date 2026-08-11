FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS build

WORKDIR /app

# Copy the repository instead of enumerating workspace manifests. The master branch
# intentionally has no mobile package, while the mobile branch does; this build must
# remain valid for both repository shapes.
COPY . .

RUN bun install --frozen-lockfile --filter @anomaly-detector/backend

WORKDIR /app/backend

RUN DATABASE_URL="postgresql://superuser:superpassword@localhost:5432/anomaly_detector?schema=public" bun run prisma:generate

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS production-dependencies

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --production --filter @anomaly-detector/backend

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime

WORKDIR /app

RUN apk upgrade --no-cache

COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/packages/contracts ./packages/contracts
COPY --from=build --chown=bun:bun /app/backend ./backend

WORKDIR /app/backend

ENV NODE_ENV=production

USER bun

CMD ["bun", "src/index.ts"]
