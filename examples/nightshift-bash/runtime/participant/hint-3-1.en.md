# 3 / Hint 1 — Current state versus reconstructed state

A startup script may recreate settings whenever a service starts. Repairing today's files then lasts only until the next startup.

The goal is safety now and after the next start. Match the scripts in `app/startup.d` to startup messages in the logs. In this exercise, files ending in `.sh` in that directory execute in order when the batch service starts.
