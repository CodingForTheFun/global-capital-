# The customer-facing Oblige Props service is HTTP/API driven. It does not run
# the retired PickFinder browser scanner, so shipping a ~1 GB Playwright browser
# image in production only slows builds, pulls and cold starts.
FROM node:22-bookworm-slim AS validate
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
# Validate unmutated source. The build context includes only the one retired UI
# source file required by source-contract tests.
RUN npm run check
# Build the production runtime only after validation passes.
RUN node scripts/prepare-edge-deploy.mjs
# Defense in depth: retired frontends must never survive into the runtime copy.
RUN rm -rf /app/apps/guest-dashboard /app/apps/ticket-dashboard

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_ENV=production PORT=3000 HEADLESS=true
COPY --from=validate /app /app
# Keep this explicit in the final stage so future validation-context changes
# cannot accidentally ship retired frontend source.
RUN rm -rf /app/apps/guest-dashboard /app/apps/ticket-dashboard
EXPOSE 3000
CMD ["node","frontdoor-clearsports.mjs"]
