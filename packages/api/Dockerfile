FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN cd packages/shared && pnpm build
RUN cd packages/api && pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/package.json ./packages/api/package.json

EXPOSE 3001
CMD ["node", "packages/api/dist/main.js"]
