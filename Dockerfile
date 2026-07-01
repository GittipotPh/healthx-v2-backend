FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN DATABASE_URL="postgresql://postgres:postgres@localhost:5432/healthx_optionb_test?schema=public" pnpm exec prisma generate
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV APP_PORT=8080

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 8080
CMD ["node", "dist/main.js"]
