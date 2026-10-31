FROM node:22-slim AS base
# pnpm pinned: pnpm 11 turns onlyBuiltDependencies violations into hard install failures.
RUN corepack enable && corepack prepare pnpm@10.26.0 --activate
WORKDIR /app

# canvas and better-sqlite3 compile native modules
FROM base AS build-env
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY frontend/package.json ./frontend/

FROM build-env AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM build-env AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
COPY frontend/ ./frontend/
RUN pnpm run build:all

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libpixman-1-0 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package.json ./

RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production
ENV PORT=3000
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/index.js"]
