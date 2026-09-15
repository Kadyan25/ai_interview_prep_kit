# The API only: the web app deploys to Vercel from its own build.
#
# The shared package ships TypeScript source and the API runs it through tsx, so
# there is no build step — the image is the source plus production dependencies.
FROM node:22-alpine AS deps

WORKDIR /app
# Only the manifests, so this layer is cached until a dependency changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
# Only the API's own workspaces. A plain `npm ci` here installs every workspace in
# the lockfile — Next and React included — and the image came out at 1.07 GB.
RUN npm ci --omit=dev --ignore-scripts \
  --workspace apps/api --workspace packages/shared --include-workspace-root

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Render sets PORT; the app falls back to 4000 when it is not set.
EXPOSE 4000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src

# Never runs as root, and the app writes nothing to the filesystem.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "apps/api"]
