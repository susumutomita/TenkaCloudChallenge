# syntax=docker/dockerfile:1
#
# php-attachment-viewer-lab -- two images from one file.
#   surface  : the participant-facing PHP portal (official php:8 CLI image, pinned
#              by digest). PHP's built-in web server routes every request through
#              public/index.php. Runs as www-data; the root filesystem is read-only
#              and the two writable paths are tmpfs (see docker-compose.yml).
#   verifier : the loopback /verify scorer (Node, pinned by digest). It shares
#              only FLAG_SEED with the surface and reaches it over the compose
#              network -- no file, volume or process is shared.
# Neither image contains the flag: it is derived from FLAG_SEED at start-up.

FROM php:8.4.27-cli-alpine@sha256:b58f9a66fe9734250fc42818edc77d679a071a83cefdcda87b21b668a91094b1 AS surface
WORKDIR /app
COPY app/lib.php ./lib.php
COPY app/bin/ ./bin/
COPY app/public/ ./public/
COPY app/attachments/ ./attachments/
USER www-data
EXPOSE 8080
CMD ["sh", "-c", "php /app/bin/bootstrap.php && exec php -S 0.0.0.0:8080 /app/public/index.php"]

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS verifier
WORKDIR /lab
COPY verify/ ./verify/
USER node
EXPOSE 8081
ENV BIND=0.0.0.0
CMD ["node", "verify/server.mjs"]
