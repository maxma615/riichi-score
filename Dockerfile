ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /data && chown node:node /data
COPY src ./src
COPY public ./public
USER node
ENV HOST=0.0.0.0 PORT=3200 DATA_DIR=/data
EXPOSE 3200
CMD ["node", "src/server.js"]
