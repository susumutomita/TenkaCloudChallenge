# syntax=docker/dockerfile:1
#
# Real, current WordPress for TenkaCloud local play (remediation edition). This is NOT a
# vulnerable old build — it is the official current image. The wrapper entrypoint plants
# the previous operator's four leftovers (and a mu-plugin that regenerates debug.log)
# into the docroot, then hands off to the stock WordPress entrypoint, so the site starts
# already-leaky and the player closes each hole. The compose file binds it to 127.0.0.1.
#
# `AS participant`: this problem has no author-only material to exclude (no reference/
# solution baked into the image, unlike the ac26-* course problems) — the stage name
# exists only so `docker-adapter.ts`'s terminal-attach check (`target: participant`,
# TenkaCloud#2846/#2850) accepts this service. The remediation itself happens by shelling
# in (issue #418: this problem already requires `docker compose exec wordpress bash`),
# so the portal-embedded terminal is not a new capability, just a browser-only path to
# the same access the problem's own instructions already demand.
FROM wordpress:php8.3-apache AS participant

# Revalidate opcache every request so an edit to wp-config.php (e.g. the player turning
# WP_DEBUG off to close the debug-log checkpoint) takes effect immediately instead of
# after the default 2s window — otherwise a re-scan right after the fix confusingly still
# reports the hole open.
RUN printf 'opcache.revalidate_freq=0\n' > /usr/local/etc/php/conf.d/zz-revalidate.ini

COPY seed-and-start.sh /usr/local/bin/seed-and-start.sh
RUN chmod +x /usr/local/bin/seed-and-start.sh

ENTRYPOINT ["seed-and-start.sh"]
CMD ["apache2-foreground"]
