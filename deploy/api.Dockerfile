FROM node:20-slim AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
USER node
CMD ["node", "dist/main.js"]
