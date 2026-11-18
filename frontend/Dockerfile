FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Same-origin /api on app host (Traefik); default base in app code is /api
ARG VITE_POCKET_ID_ISSUER
ARG VITE_DEMO
ARG VITE_DEMO_ROOMS
RUN npm run build && \
    if [ "$VITE_DEMO" = "1" ]; then cp src/assets/fonts/archivo-latin.woff2 dist/demo-archivo.woff2; fi

FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
