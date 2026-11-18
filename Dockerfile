# تنظيم — صورة الإنتاج للتنصيب الداخلي (On-Prem). عملية واحدة، قاعدة SQLite في مجلد /data.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production NODE_NO_WARNINGS=1 HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
RUN addgroup -S tanzeem && adduser -S tanzeem -G tanzeem && mkdir -p /data && chown tanzeem:tanzeem /data
COPY --from=build --chown=tanzeem:tanzeem /src/node_modules ./node_modules
COPY --from=build --chown=tanzeem:tanzeem /src/dist ./dist
COPY --chown=tanzeem:tanzeem package.json ./
COPY --chown=tanzeem:tanzeem server ./server
COPY --chown=tanzeem:tanzeem shared ./shared
COPY --chown=tanzeem:tanzeem tools ./tools
USER tanzeem
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "--max-old-space-size=512", "server/index.js"]
