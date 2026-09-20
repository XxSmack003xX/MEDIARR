FROM node:22-bookworm-slim

ARG MEDIARR_VERSION=1.6.1
ARG MEDIARR_REPOSITORY=XxSmack003xX/MEDIARR

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7575 \
    DATA_DIR=/data \
    DOCKER_SOCKET=/var/run/docker.sock \
    MEDIARR_VERSION=${MEDIARR_VERSION} \
    MEDIARR_UPDATE_REPO=${MEDIARR_REPOSITORY}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates gosu passwd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js update-helper.js README.md Caddyfile.example ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/mediarr-entrypoint

# /data holds every persistent MEDIARR JSON file and backup. /app/public stays
# writable so Bootstrap/hls.js can be cached locally on first use.
RUN mkdir -p /data \
    && chown -R node:node /data /app/public \
    && chmod 0755 /usr/local/bin/mediarr-entrypoint

EXPOSE 7575
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7575)+'/api/setup-needed').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/mediarr-entrypoint"]
CMD ["node", "server.js"]
