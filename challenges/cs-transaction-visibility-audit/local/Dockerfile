# A pinned stdlib-only runtime keeps seeded evidence stable across rebuilds.
FROM python:3.13-slim@sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91 AS participant

RUN useradd --create-home --uid 10001 lab

WORKDIR /problem

COPY --chown=lab:lab fixtures/ ./fixtures/
COPY --chown=lab:lab tests/ ./tests/
COPY --chown=lab:lab verifier/ ./verifier/
COPY --chown=lab:lab starter/ ./starter/
COPY --chown=lab:lab show.py ./show.py

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

USER lab

CMD ["python", "verifier/server.py"]

# The default participant stage omits worked answers and the mutation catalog.  Local
# mode is still honor-system verification: hidden properties must exist in the running
# verifier, and anyone who owns Docker can inspect an image they run.  See TEMPLATE.md "Assurance scope"
# for the claim boundary.
FROM participant AS author

COPY --chown=lab:lab reference/ ./reference/
COPY --chown=lab:lab mutation.py ./mutation.py
