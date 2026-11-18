# Production web image: builds the React app, then Caddy serves it and proxies /api to Django.
# Build context is the repository root (docker-compose.prod.yml).
FROM node:22 AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2
COPY --from=build /app/dist /srv
COPY ops/caddy/Caddyfile /etc/caddy/Caddyfile
