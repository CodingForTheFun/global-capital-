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
# Railway runs npm run check from this image before deploy. Fail closed if the
# test suite is ever excluded or emptied so a 0-test run cannot look healthy.
RUN test -d tests && test "$(find tests -type f -name '*.test.mjs' | wc -l)" -gt 0 || (echo "ERROR: tests/ missing or empty; refusing production image" >&2; exit 1)
RUN node scripts/prepare-edge-deploy.mjs
ENV NODE_ENV=production PORT=3000 HEADLESS=true
EXPOSE 3000
CMD ["node","frontdoor-clearsports.mjs"]
