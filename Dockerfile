FROM node:22-slim AS build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY frontend/ ./
RUN npm test && npm run build
FROM node:22-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist
COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 3000
CMD ["node","server.mjs"]
