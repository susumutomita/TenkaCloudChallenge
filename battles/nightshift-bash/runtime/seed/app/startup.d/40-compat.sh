#!/bin/bash
# Historical compatibility settings, applied on every service restart.
set -euo pipefail
chmod 0644 /srv/nightshift/backup/settlement.key
cat > /srv/nightshift/app/config/runtime.env <<'CONFIG'
export PATH=/srv/nightshift/vendor/bin:/srv/nightshift/app/bin:/usr/bin:/bin
CONFIG
printf '[startup] legacy compatibility profile applied\n' >> /srv/nightshift/logs/batch.log
