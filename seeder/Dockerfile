FROM node:20-alpine

WORKDIR /app

# Non-root user
RUN addgroup -S seeder && adduser -S seeder -G seeder

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# Copy source
COPY src/ src/

# Content volume
RUN mkdir -p /data/content && chown -R seeder:seeder /data/content
VOLUME /data/content

USER seeder

ENV NODE_ENV=production
ENV CONTENT_DIR=/data/content
ENV HEALTH_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "src/index.js"]
