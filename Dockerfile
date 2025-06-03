FROM node:20-alpine
WORKDIR /app

COPY server/package.json ./server/
WORKDIR /app/server
RUN npm install --omit=dev

COPY server/. .
COPY public ../public
COPY config ../config

EXPOSE 3000
CMD ["node", "index.js"]
