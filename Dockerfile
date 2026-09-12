FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY apps/guest-dashboard/package.json ./apps/guest-dashboard/package.json
RUN npm --prefix apps/guest-dashboard install --include=dev --no-audit --no-fund
COPY . .
RUN node scripts/prepare-edge-deploy.mjs && npm --prefix apps/guest-dashboard run build
ENV NODE_ENV=production PORT=3000 HEADLESS=true
EXPOSE 3000
CMD ["node","frontdoor-clearsports.mjs"]
