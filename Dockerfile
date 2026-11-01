# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Update npm to latest version to fix CVEs
RUN npm install -g npm@latest

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variable for production build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js application
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Used only when the optional HTTPS launcher generates its first certificate.
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts/https-server.cjs ./scripts/https-server.cjs
COPY --from=builder /app/scripts/kiosk-server.cjs ./scripts/kiosk-server.cjs
COPY --from=builder /app/scripts/lib/kiosk-gateway.cjs ./scripts/lib/kiosk-gateway.cjs
COPY --from=builder /app/lib/labs/public-paths.cjs ./lib/labs/public-paths.cjs
COPY --from=builder /app/lib/server/tls-runtime.cjs ./lib/server/tls-runtime.cjs

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
EXPOSE 3443
EXPOSE 3102

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
