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
