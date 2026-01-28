# ATEM ISO EDL Generator
# Multi-stage build for minimal production image

# =============================================================================
# Build Stage
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# =============================================================================
# Production Stage
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

# Create directories for config, logs, and output
RUN mkdir -p config logs output && \
    chown -R nodejs:nodejs config logs output

# Default environment
ENV NODE_ENV=production
ENV CONFIG_PATH=/app/config/config.yaml
ENV LOG_LEVEL=info

# Expose ports
# 3000 = Web interface
# 9090 = Prometheus metrics
EXPOSE 3000 9090

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
