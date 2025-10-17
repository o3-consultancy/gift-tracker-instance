FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY server/package.json ./server/
WORKDIR /app/server
RUN npm install --omit=dev

# Copy application files
COPY server/. .
COPY public ../public
COPY config ../config

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set working directory back to /app/server for execution
WORKDIR /app/server

# Environment variables (can be overridden at runtime)
ENV PORT=3000
ENV NODE_ENV=production
ENV DEBUG_MODE=false
ENV BACKEND_API_URL=https://o3-ttgifts.com/api/instances

EXPOSE 3000

# Use entrypoint to generate .env and start app
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "index.js"]
