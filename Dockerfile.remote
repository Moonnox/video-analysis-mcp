# Multi-stage build for production-ready remote MCP server
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:18-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create required directories with proper permissions
RUN mkdir -p /tmp/video-analysis-mcp-logs && \
    mkdir -p /tmp/video-analysis-uploads && \
    chown -R nodejs:nodejs /tmp/video-analysis-mcp-logs && \
    chown -R nodejs:nodejs /tmp/video-analysis-uploads

# Switch to non-root user
USER nodejs

# Expose port (configurable via PORT env variable)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Set production environment
ENV NODE_ENV=production

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the remote server
CMD ["node", "remote-server.js"]
