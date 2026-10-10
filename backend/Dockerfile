FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
RUN pnpm install --frozen-lockfile --filter call-agent-backend...

COPY backend backend
RUN pnpm --filter call-agent-backend build

EXPOSE 3000

CMD ["pnpm", "--filter", "call-agent-backend", "start"]
