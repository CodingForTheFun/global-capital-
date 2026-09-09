FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production PORT=3000 HEADLESS=true
EXPOSE 3000
CMD ["node","frontdoor-prod.mjs"]
