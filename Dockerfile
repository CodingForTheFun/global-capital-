# The customer-facing Oblige Props service is HTTP/API driven. It does not run
# the retired PickFinder browser scanner, so shipping a ~1 GB Playwright browser
# image in production only slows builds, pulls and cold starts.
FROM node:22-bookworm-slim AS validate
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
# Validate the unmutated source-contract fixtures before preparing the runtime.
RUN npm run check
# Build the production runtime only after validation passes.
RUN node scripts/prepare-edge-deploy.mjs
# Build the current Next.js customer frontend inside the already-gated backend
# image. The frontdoor serves this copy first and retains the standalone
# Railway frontend as a fallback, so a frontend-builder outage cannot pin
# customers to an older UI release.
RUN npm ci --prefix apps/oblige-web --no-audit --no-fund
RUN NEXT_TELEMETRY_DISABLED=1 npm run build --prefix apps/oblige-web
RUN npm prune --omit=dev --prefix apps/oblige-web --no-audit --no-fund
# Defense in depth: retired frontend source must never survive into runtime.
RUN rm -rf /app/apps/g*dashboard /app/apps/ticket-dashboard

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_ENV=production PORT=3000 HEADLESS=true
COPY --from=validate /app /app
# Keep the retired frontend excluded even if validation-context rules change later.
RUN rm -rf /app/apps/g*dashboard /app/apps/ticket-dashboard
EXPOSE 3000
CMD ["node","frontdoor-clearsports.mjs"]
