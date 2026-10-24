# syntax=docker/dockerfile:1
FROM wordpress:cli-php8.3@sha256:661db880e953da051abcac6c0a769767b995a82cd52101c003ca7438dd427d7d
# Keep the signed WP-CLI PHAR and its user; use the patched system CA explicitly.
COPY --chmod=644 system-ca.ini /usr/local/etc/php/conf.d/zz-tenkacloud-ca.ini
