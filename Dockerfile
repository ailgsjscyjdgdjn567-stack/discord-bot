FROM node:24-slim

RUN npm install -g pnpm@latest

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY scripts/ ./scripts/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
