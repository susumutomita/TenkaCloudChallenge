# 3 / Hint 2 — Find what overwrites the repair

If you change A to B by hand but a startup script writes A every time, a restart restores A. Change that script to the safe setting B, or disable the obsolete operation.

Search for permission changes and PATH configuration:

```bash
grep -R -n -E 'chmod|PATH|runtime.env' /srv/nightshift/app/startup.d
cat /srv/nightshift/logs/batch.log
```

Submit the responsible script's absolute path as evidence before the repair phase begins.
