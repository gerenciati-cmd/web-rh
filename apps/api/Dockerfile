# syntax=docker/dockerfile:1.7
# Construir SIEMPRE desde la raíz del monorepo:
#   docker build -f apps/api/Dockerfile -t rrhh-api .
#
# Targets:
#   runner   (default) → API HTTP:   docker run rrhh-api
#                         Worker:     docker run rrhh-api node dist/worker.js
#   migrator            → aplica migraciones (job previo a cada deploy)

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.6.0

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION} && apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo

# 1) Recorta el monorepo a solo lo que @rrhh/api necesita.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.4 prune @rrhh/api --docker

# 2) Instala dependencias (capa cacheable: solo cambia si cambian los package.json/lockfile).
FROM base AS installer
COPY --from=pruner /repo/out/json/ .
COPY --from=pruner /repo/.pnpmfile.cjs ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm --filter @rrhh/api db:generate && pnpm --filter @rrhh/api build

# 3) Paquete desplegable con SOLO dependencias de producción.
FROM installer AS deployer
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @rrhh/api deploy --prod /deploy \
 && cp -r apps/api/dist /deploy/dist

# Migraciones: usa el installer (tiene el CLI de Prisma).
FROM installer AS migrator
WORKDIR /repo/apps/api
CMD ["pnpm", "db:deploy"]

# 4) Imagen final mínima, sin root.
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deployer --chown=node:node /deploy .
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/http.js"]
