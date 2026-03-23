FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

# PID 1 = node (via exec no entrypoint). Evita npm como PID 1 + shell com && (SIGTERM / lifecycle).
CMD ["/app/docker-entrypoint.sh"]
