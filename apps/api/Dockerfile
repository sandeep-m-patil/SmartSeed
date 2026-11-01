FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# Only the API and shared workspaces are needed here.
RUN npm ci -w @smartseed/api -w @smartseed/shared --include-workspace-root
RUN npm run build -w @smartseed/api

# One-shot migration image (needs MIGRATE_DATABASE_URL): `docker compose run --rm migrate`.
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["npx", "node-pg-migrate", "-m", "migrations", "--migration-file-language", "sql", "-d", "MIGRATE_DATABASE_URL", "up"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev -w @smartseed/api -w @smartseed/shared --include-workspace-root && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
