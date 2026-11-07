# syntax=docker/dockerfile:1

# ---- build stage: build the static React bundle ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public backend URL (not a secret). Empty = same origin: nginx below proxies /api to the backend.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---- runtime stage: nginx serves the files and proxies /api ----
FROM nginx:1.27-alpine AS runtime
# Where nginx forwards /api requests (the backend service name inside compose).
ENV BACKEND_URL=http://backend:4000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
