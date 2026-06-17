FROM node:22-bookworm-slim AS builder

WORKDIR /app

ARG VITE_POCKET_ID_CLIENT_SECRET
ENV VITE_POCKET_ID_CLIENT_SECRET=${VITE_POCKET_ID_CLIENT_SECRET}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Same-origin /api on app host (Traefik + Authelia); default base in app code is /api
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
