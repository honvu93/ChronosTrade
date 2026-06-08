FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN cd packages/shared && pnpm build
RUN cd packages/web && pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/packages/web/next.config.js ./
COPY --from=builder /app/packages/web/public ./public
COPY --from=builder /app/packages/web/.next ./.next
COPY --from=builder /app/packages/web/node_modules ./node_modules
COPY --from=builder /app/packages/web/package.json ./package.json

EXPOSE 3000
CMD ["npm", "start"]
