# The customer-facing Oblige Props service is HTTP/API driven. It does not run
# the retired PickFinder browser scanner, so shipping a ~1 GB Playwright browser
# image in production only slows builds, pulls and cold starts. Keep the
# Playwright JS dependency installable for shared source compatibility, but do
# not ship Chromium/WebKit/Firefox binaries in this live image.
FROM node:22-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
# Run the real source-level gate before prepare-edge-deploy mutates generated
# runtime assets. Railway's pre-deploy phase runs inside the already-mutated
# image, which made source-anchor tests fail even when the source was healthy.
RUN npm run check
RUN node scripts/prepare-edge-deploy.mjs
ENV NODE_ENV=production PORT=3000 HEADLESS=true
EXPOSE 3000
CMD ["node","frontdoor-clearsports.mjs"]
