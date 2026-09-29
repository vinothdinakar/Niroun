FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Next bakes rewrites in at build time, so the API's URL is a build argument, not a runtime variable.
ARG BOND_API_URL
ENV BOND_API_URL=$BOND_API_URL
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
COPY admin-app/package.json admin-app/
COPY packages/console-core/package.json packages/console-core/
RUN npm ci --include=dev
COPY packages/console-core packages/console-core
COPY dashboard dashboard
RUN npm --prefix dashboard run build
USER node
WORKDIR /app/dashboard
CMD ["sh", "-c", "exec npx next start -p ${PORT:-8080}"]
