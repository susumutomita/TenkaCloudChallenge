#!/usr/bin/env bash
# Anonymous-spam attack -- POST garbage to /submit WITHOUT an auth token.
#
# Defended (auth_enabled = auth_required true + a non-default auth_token):
#   every POST returns 401, nothing lands, posture.board_clean stays true, and the
#   team holds production. Hardening repels the attack -- robustness is rewarded.
# Undefended (auth off):
#   the marker posts (author "redteam-spam") land, the app's board_clean goes false,
#   and the team drops out of production until they enable auth AND delete the spam.
#
# Deliberately tiny (5 posts) -- a teaching probe, not a real flood. Run only
# against stacks you operate.
#
# Inputs:  $1 / $APP_URL   (e.g. http://<app-host-dns>  -- the registered AppUrlHint)
# Output:  PASS (defended, all rejected) / FAIL (some landed)
set -uo pipefail

APP_URL="${1:-${APP_URL:?APP_URL required}}"
APP_URL="${APP_URL%/}"

landed=0
for _ in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d '{"author":"redteam-spam","body":"[SPAM] cheap followers -- click here"}' \
    "$APP_URL/submit" 2>/dev/null || echo "000")
  [ "$code" = "201" ] && landed=$((landed + 1))
done

if [ "$landed" -eq 0 ]; then
  echo "PASS  anonymous-spam blocked (auth enforced; 0/5 landed) -- board_clean holds, production safe"
  exit 0
fi
echo "FAIL  $landed/5 spam posts landed (auth NOT enforced) -- posture.board_clean will go false." >&2
echo "      recover: enable auth, then delete the spam:" >&2
echo "      sqlite3 \"\$SQLITE_DB\" \"DELETE FROM posts WHERE author='redteam-spam'\"; sudo systemctl restart tenkacloud-vibe" >&2
exit 1
