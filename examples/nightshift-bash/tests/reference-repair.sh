#!/bin/bash
# OPERATOR REFERENCE ONLY. Run inside the target as operator, not root.
set -euo pipefail
chmod 0640 /srv/nightshift/backup/settlement.key
cat > /srv/nightshift/app/config/runtime.env <<'CONFIG'
export PATH=/srv/nightshift/app/bin:/usr/bin:/bin
CONFIG
chmod 0755 /srv/nightshift/vendor/bin
rm -f /srv/nightshift/vendor/bin/render-receipt
if [[ -f /srv/nightshift/app/startup.d/40-compat.sh ]]; then
    mv /srv/nightshift/app/startup.d/40-compat.sh /srv/nightshift/app/startup.d/40-compat.disabled
fi
