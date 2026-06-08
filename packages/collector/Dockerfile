FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY packages/collector ./packages/collector
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN cd packages/shared && pnpm build
RUN cd packages/collector && pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/collector/dist ./packages/collector/dist
COPY --from=builder /app/packages/collector/package.json ./packages/collector/package.json

CMD ["node", "packages/collector/dist/main.js"]
