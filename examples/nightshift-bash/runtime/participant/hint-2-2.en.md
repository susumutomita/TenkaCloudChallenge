# 2 / Hint 2 — The first match wins

If PATH is `A:B` and both contain `tool`, the program in A is found first. Even if B's program is correct, someone who can change A can redirect the call.

Read `cat /srv/nightshift/app/bin/process-orders.sh` and `cat /srv/nightshift/app/config/runtime.env`. Find the short command name and the setting that controls its search path. Use `ls -ld` for directories and `ls -l` for their files.

Preventing directory writes does not remove write access to an existing file. A symbolic link is a reference to another path: check the linked executable and its directory too.
