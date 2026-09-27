FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash coreutils findutils grep sed gawk util-linux procps nano passwd \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1100 auditor \
    && groupadd --gid 1400 workload \
    && useradd --uid 1100 --gid 1100 --no-create-home --shell /bin/bash auditor \
    && useradd --uid 1200 --gid 1400 --no-create-home --shell /bin/bash operator \
    && useradd --uid 1300 --gid 1400 --no-create-home --shell /bin/bash batch \
    && install -d /srv/nightshift /opt/nightshift /run/nightshift \
    && printf 'nightshift-v1\n' > /etc/nightshift-image
# No host/, tests/, reference solution, or per-run secrets enter the image.
COPY runtime/ /opt/nightshift/
RUN chmod -R a+rX /opt/nightshift && chmod 0755 /opt/nightshift/*.sh
WORKDIR /srv/nightshift
# Root supervises UID changes. Both participant shells are non-root.
USER 0
ENTRYPOINT ["/bin/bash", "/opt/nightshift/entrypoint.sh"]
HEALTHCHECK --interval=5s --timeout=2s --start-period=15s --retries=3 \
    CMD ["/usr/bin/test", "-f", "/run/nightshift/ready"]
