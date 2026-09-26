# 3 / Hint 3 — Stop the cause, then verify again

As auditor, inspect the script and record its path:

```bash
cat /srv/nightshift/app/startup.d/40-compat.sh
printf '/srv/nightshift/app/startup.d/40-compat.sh\n' > /srv/nightshift/submissions/startup.txt
```

After the organizer runs `submit` and starts repair, operator can disable the obsolete hook. `.disabled` does not match the startup runner's `.sh` suffix:

```bash
mv /srv/nightshift/app/startup.d/40-compat.sh /srv/nightshift/app/startup.d/40-compat.disabled
chmod 0640 /srv/nightshift/backup/settlement.key
printf 'export PATH=/srv/nightshift/app/bin:/usr/bin:/bin\n' > /srv/nightshift/app/config/runtime.env
```

Clean up the demonstration executable and writable locations from mission 2 too. Ask for grading. Confirm both post-restart protection and correct processing of real exercise orders.
