# WrittenBoard broadcast worker image.
# Build from the repo root:  docker build -f workers/Dockerfile -t writtenboard-worker .
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Runtime deps only, plus tsx to run the TypeScript entrypoint.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm install --no-save --no-audit --no-fund tsx@4.19.2 \
  && npm cache clean --force

COPY tsconfig.json ./
COPY lib ./lib
COPY workers ./workers

ENV NODE_ENV=production \
    BROADCAST_WORK_DIR=/tmp/writtenboard-worker \
    BROADCAST_FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
    FFMPEG_PATH=ffmpeg \
    PORT=8080

USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "workers/broadcast-worker.ts"]
