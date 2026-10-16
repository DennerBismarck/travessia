FROM node:22.20.0-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG PUBLIC_BASE_URL=http://localhost:3000
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL
RUN pnpm --filter @travessia/web build

FROM node:22.20.0-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/assets ./apps/web/assets
EXPOSE 3000
# O volume /data chega como root: ajusta o dono e roda o servidor como o usuário node.
CMD ["sh", "-c", "mkdir -p /data && chown node:node /data && exec setpriv --reuid=node --regid=node --init-groups node apps/web/server.js"]
