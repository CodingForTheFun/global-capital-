FROM node:22-bookworm-slim
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm","run","start"]
