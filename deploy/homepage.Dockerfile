FROM node:20-slim AS build
WORKDIR /app
# The API's address, shown in the docs (and /openapi.json). Empty: the docs say local development.
ARG VITE_BOND_API_URL
ENV VITE_BOND_API_URL=$VITE_BOND_API_URL
COPY homepage/package*.json ./
RUN npm ci
COPY homepage/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
