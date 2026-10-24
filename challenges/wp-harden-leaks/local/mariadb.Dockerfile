FROM mariadb:11@sha256:f16d7a344413e519dff518f27bdb221388f84b0d274c97c4fb5f2cb0dc1b34fa
# Refresh the system trust store without changing the database runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade ca-certificates \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge 20260816ubuntu0.24.04.1 \
    && test ! -e /etc/ssl/certs/Comodo_AAA_Services_root.pem \
    && rm -rf /var/lib/apt/lists/*
