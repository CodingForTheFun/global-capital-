FROM node:22-bookworm-slim
WORKDIR /app/apps/oblige-web

ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/oblige-web/package.json apps/oblige-web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY apps/oblige-web/ ./
COPY lib/ /app/lib/
RUN npm run build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm","run","start"]
