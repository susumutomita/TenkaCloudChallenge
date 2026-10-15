# One-Order hint reading check (#738)

Scope: one selected **standard Caesar Order**. Read that Order's three rungs,
calculate, submit, and only then open hints for another Order. The five-minute
standard TTL, issue interval, hint prices, score rules and platform write rate
limit are unchanged. Rush Orders retain their shorter deadlines.

The Caesar ladder keeps the plaintext/ciphertext/key definitions, circular shift
mechanism and inverse, the general addition-and-remainder formula, a one-digit
worked example, the reader's values as unfinished additions, and the input format
and submit control. It also distinguishes die faces 1–6 from values 0–5. The
share Order's last rung retains its actual exposure count and permitted LEAK or
four-cell PROVE procedure, without concatenating the entire Sudoku ladder and
ROTATE instructions. Its first two rungs' mathematics remain intact.

For the measured fixture, Japanese Caesar rung lengths changed from
499/366/437 characters (1,302 total) to 181/210/397 (788 total). The share
last rung changed from 760 to 309; its full ladder remains 1,296 characters,
and its reading time was not independently measured.

## Reproducible arithmetic and deadline checks

From `game/`:

```sh
bun test src/hint-reading.test.ts src/hints.test.ts src/hint-projection-regressions.test.ts
bun run typecheck
```

The reading regression buys only one Order's hints through the real dev host,
which ticks the actual reducer before every operation. At simulated 5-second
intervals it opens the three rungs, reads the written own-number additions in
both locales, and submits their results through the real validator/reducer.
Thirty seeds exercise keys 0–5 and wraparound. Other Orders' hints remain
unopened. Submission just before each actual deadline succeeds; a normal
Order submitted at 300,000 ms expires despite bought hints. These deterministic
tests check the worksheet and timing rules, **not human reading speed**.

## Timed participant-role check

On 2026-09-06, an independent participant-role agent received only the chosen
Order's three Japanese hints: 801 characters including rung headings and line
breaks. It read no state, generator, TTL setting, reference answer or repository
source. The host kept the clock and submitted the reader's answer unchanged.

| Event | Wall-clock elapsed since Order issuance |
| --- | ---: |
| First hint purchased | 5.005 s |
| Second hint purchased | 10.008 s |
| Third hint purchased and packet made available | 15.009 s |
| Reader's hand calculation submitted to the real reducer | 72.516 s |
| Time remaining at successful submission | 227.484 s |

The response was `5 4 1 1 2 0 2 3 3 0 1 4` for the displayed 12 values and
key 3. The reader explained the mechanism as adding one key to every value and
keeping the remainder after division by 6; its written work included both
`4+3=7→1` and `3+3=6→0`. The judge accepted the response, marked the same
Order `completed` / `cipher`, and awarded +30. The total includes purchase
waits, message delivery and a local runner invocation repair; no clock was
paused or deadline extended during the measurement. A regression replays this
exact response and elapsed offset against the same public worksheet.

The reader found no missing required definitions: key, plaintext, ciphertext,
mod, zero-based numbering and the bound allowing one subtraction were all
introduced before use. The only small uncertainty was the English control name
`CIPHER`; it could infer the action from the named answer field but had not seen
the actual button. A separate headless browser check on local port 5677 opened
this Order's three hints, entered a hand-computed answer from that screen, and
pressed the actual `CIPHER · +30` button. It showed “正解！+30 点” and the next
Order. That browser check used the harness's paused clock and establishes the
control/feedback route; the 72.516-second measurement above is the separate
wall-clock test.

This is a local participant-role check, not an independent novice human study,
Mac desktop verification, AWS deployment, or live event. It does not establish
that all six kinds can be read together, that a late-selected Order has enough
time, or that the longer FHE/MPC ladders fit every reader's deadline.
