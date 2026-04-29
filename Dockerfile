FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch --frozen-lockfile

COPY . .

RUN pnpm install --frozen-lockfile --offline

ARG PUBLIC_DEFAULT_API_URL=http://localhost:1300
ENV PUBLIC_DEFAULT_API_URL=${PUBLIC_DEFAULT_API_URL}

RUN pnpm run build:docker

FROM base AS prod-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch --prod --frozen-lockfile
RUN pnpm install --prod --frozen-lockfile --offline --ignore-scripts

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

ENV NODE_ENV=production
ENV PORT=1400
EXPOSE 1400

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/index.js"]
