# NIGHTSHIFT — Protect the Night Batch

You are the night operations team at an online shop. Its batch job (a program that processes orders together) shows suspicious behavior and may be exposing information. Investigate in the terminal, fix the problems, and keep valid orders working.

Start with `id`, `ls -la /srv/nightshift`, and `cat /srv/nightshift/logs/batch.log`. They show your current user, the files you inherited, and recent processing results.

## Your tools

Use Bash and standard Linux commands. Python, Node.js, attack frameworks, and external networking are unavailable. Edit with `nano`; use `exit` to return to the organizer's terminal.

Permissions control who can read or change a file. Inspect them with `ls -l`. PATH is the ordered list of directories searched when a program is called by a short name rather than its full path.

## First half: investigate and demonstrate / auditor / 300 points

1. **Unexpected reader (100 points):** someone reports that an ordinary investigation user can read the exercise settlement key in a backup. Save only that key's value to `/srv/nightshift/submissions/leak.txt`. It is exercise data, not a real credential.
2. **Unexpected program (100 points):** the batch may be running a file you can place. Inspect `/srv/nightshift/app`. Demonstrate this by making batch copy its private `/srv/nightshift/service/proof-token` to `/srv/nightshift/evidence/path.txt`. Only copy the exercise token, then continue normal order processing.
3. **Returning configuration (100 points):** a teammate says a repair disappears after the batch service restarts. Find the startup script responsible and save its absolute path, on one line, to `/srv/nightshift/submissions/startup.txt`. The application's startup files and logs contain clues.

The batch normally runs about every five seconds. Ask the organizer to run `tick` for an immediate run.

After preparing the evidence, exit and ask the organizer to run `./gameday.sh submit team1`, using your actual team name. Submitting again has no penalty. Discovery points freeze when the organizer starts the repair phase; later evidence cannot add points.

## Second half: repair / operator / 700 points

After the organizer runs `repair`, a new shell uses the operator account. This account is not root but can edit the application's settings and scripts. An existing auditor shell retains its original privileges.

Make these conditions hold without stopping order processing:

- auditor cannot read the settlement key: 150 points.
- auditor cannot replace the program used by batch: 150 points.
- both repairs survive service restarts: 100 points.

Three processing checks award another 100 points each:

- Valid orders produce correct quantities, prices, totals, and a checksum based on the settlement key.
- Sending the same order ID again does not process it twice.
- Zero or negative quantities, non-numeric values, and extra columns are rejected and recorded.

A checksum is a calculated value used to check data consistency. The existing legitimate script contains the calculation. This exercise is not a real payment-signature design.

Input is `order-id,quantity,unit-price`. Quantity is an integer from 1 to 999; unit price is from 0 to 999999. Leading zeroes still mean decimal numbers. For example, `ORDER-1,003,000050` means quantity 3, price 50, total 150. Output is `order-id,quantity,unit-price,total,checksum`.

Ask the organizer to run `./gameday.sh score team1`. Grading really restarts the batch service to test whether repairs persist; it does not reboot the OS. Stop editing during grading. Repair and processing points reflect the current state, so they can fall if the system breaks again. Deleting the key, disabling the worker, or blocking legitimate users does not count as a repair.

## Exercise boundary and help

Work only inside `/srv/nightshift` and your own home in this disposable container. The organizer host, grader, other teams, and everything outside the container are out of scope. Do not attack networks, extract real data, flood processes, or disrupt grading.

Each mission has three free hints. Ask the organizer to run `./gameday.sh hint MISSION STEP en`, for example `./gameday.sh hint 1 1 en`. English hints are also readable at `/opt/nightshift/participant/hint-1-1.en.md` (replace the two numbers).
