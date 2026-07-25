# Local-play container for ac26-bridge-experiment.
#
# Pinned by digest so a rebuild months from now produces the same image. The
# challenge is pure Python with no third-party dependency, so nothing is
# installed at build time and there is no package index to reach at runtime.
FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY app/ /app/

# The author-side suites run at build time: a broken fixture or a surviving
# mutation fails the build rather than shipping a checkpoint with no answer.
RUN FLAG_SEED=image-build-check python3 selftest.py \
    && FLAG_SEED=image-build-check python3 mutations.py

# Unprivileged, and matching the uid the compose tmpfs mounts are owned by.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin player
USER 10001

EXPOSE 8080 8081
CMD ["python3", "verifier.py"]
