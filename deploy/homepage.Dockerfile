FROM node:20-slim AS build
WORKDIR /app
COPY homepage/package*.json ./
RUN npm ci
COPY homepage/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
