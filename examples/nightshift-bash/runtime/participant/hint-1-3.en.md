# 1 / Hint 3 — Separate the demonstration from repair

As auditor during the investigation phase, run:

```bash
ls -l /srv/nightshift/backup/settlement.key
cat /srv/nightshift/backup/settlement.key > /srv/nightshift/submissions/leak.txt
```

The organizer runs `submit`. After switching to the repair phase, use operator to run:

```bash
chmod 0640 /srv/nightshift/backup/settlement.key
```

operator owns the file, with group workload. batch also uses workload, so preserve group read access. Ask the organizer for an auditor shell and confirm that `cat` reports Permission denied. If grading makes it readable again, investigate mission 3's startup settings.
