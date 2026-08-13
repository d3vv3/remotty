# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/broker/package.json apps/broker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/plugin/package.json packages/plugin/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
RUN pnpm --filter @remotty/broker build && pnpm --filter @remotty/web build

FROM nginxinc/nginx-unprivileged:alpine3.23 AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

FROM node:24-alpine AS broker
WORKDIR /app
COPY apps/broker/package.json ./package.json
RUN npm pkg delete 'dependencies.@remotty/protocol' devDependencies scripts \
  && npm install --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --chown=node:node --from=build /src/apps/broker/dist/server.js ./server.js
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
