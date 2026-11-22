FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js storage.js network.js qr.js ./
COPY public/ ./public/
COPY vendor/ ./vendor/
USER node
CMD ["node", "server.js"]
