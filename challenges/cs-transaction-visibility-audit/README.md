# Both reads were committed. The total never existed

**Track:** `cs-foundations` · **Order:** 20 · **Chapter:** 2. Transactions and visibility ·
**Time:** 45–75 minutes · **Points:** 200 · **Prerequisite:** reading Python functions,
dictionaries, and `for` loops

No database, SQL, or concurrent-programming experience is required. The ledger is a small
Python object that reveals immutable seed-derived revisions in a fixed order. It uses no real
threads, waits, or network calls.

## Start with one incident

There are two accounts in a points ledger.

```text
committed revision 10
  A = 100
  B = 100
  total = 200

the report reads A       -> 100 @ revision 10

a transaction moves 10 from A to B and commits

committed revision 11
  A = 90
  B = 110
  total = 200

the same report reads B  -> 110 @ revision 11
the report returns       -> A=100, B=110, total=210
```

Both 100 and 110 were committed when read. Yet 210 existed in neither revision. The incident
came from **treating individually valid reads as one moment**.

This problem teaches exactly one leap:

> each read is committed → all reads form one committed state

It does not branch into locks, deadlocks, retries, idempotency, tenants, or SQL dialects.

## Vocabulary

- A **transaction** makes several changes as one unit. Here it subtracts points from one account
  and adds the same amount to another.
- A **commit** makes that unit final and visible as a new revision.
- A **revision** is one immutable ledger state after a commit, with a number and every balance.
- **Read committed** means one read returns a value that was final at that instant.
- A **snapshot** is a view fixed to one captured revision. Later commits do not change what it reads.
- **Visibility** asks which committed revision a reader can see.

## The situation

An old report service reads accounts one at a time with `read_committed`, then displays the last
revision it saw as the revision of the whole report. Every individual read is valid, transfers
preserve the total, and the public tests are green.

The audit evidence contains seed-specific report traces and the states that actually committed.
First identify the report that never existed. Then place one supplied transfer into a fixed read
order to reproduce the failure deterministically. Finally repair `report.py`.

## The file contract

Edit one function in `local/starter/report.py`:

```python
def build_report(ledger, account_ids):
    ...
```

It returns exactly these keys:

```text
{
  "revision": int,
  "balances": {account_id: int, ...},
  "total": int
}
```

`balances` keeps the IDs and order of `account_ids`. `total` is the sum of the returned balances.
`revision` names the committed revision to which all those balances belong.

Only two ledger calls matter:

- `ledger.read_committed(account_id)` returns one live read with `balance` and `revision`.
- `ledger.snapshot()` returns an immutable view with `revision` and `read(account_id)`.

A normal snapshot does not stop writers. Passing `exclusive=True` to stop them changes the report
contract and is not needed for the repair.

## The public tests pass the starter

The public examples cover only:

- no commit during the report;
- a commit completed before the report;
- a commit scheduled after the report;
- one account; and
- the output shape and an ordinary total.

None places a commit between two row reads. The starter being green is intentional evidence that
the tests have not asked about the property yet.

## Participant Portal workflow

1. Start the problem and use the editor on the same page.
2. Select **Inspect evidence**. Its output is split into `audit` and `counterexample` sections.
3. For `audit`, submit the impossible `reportId` and the two revisions its rows observed as JSON.
4. For `counterexample`, submit the two IDs read before the commit, the chosen transfer ID, and the
   two IDs read after it as JSON.
5. Edit `report.py` and select **Run public tests** to check its shape.
6. Submit `snapshot` and `transfer`. Both use the same current file but grade different hidden
   properties.

The Portal prepare API binds direct answers and code to this deployment's seed. A prepared value
from another run does not carry.

## Checkpoints

| id | points | what it asks |
| --- | ---: | --- |
| `audit` | 35 | the old report that never formed a committed state, and its observed revisions |
| `counterexample` | 35 | a deterministic read / commit / read counterexample |
| `snapshot` | 80 | a `report.py` binding all rows, total, and revision to one non-exclusive view |
| `transfer` | 50 | the same property under unseen IDs, orders, revision gaps, and multiple commits |

Each checkpoint has one hint, and only the checkpoint whose hint you reveal loses points. The four
penalties total 50, below half of the 200-point problem. Draw the trace in two columns before
opening a hint.

## Local author workflow

```bash
make build
make inspect
make test
make test-one ID=single
make reset
```

Authors and CI only:

```bash
make reference-test
```

`reference-test` first passes the reference, then requires hidden properties to kill mutations
including latest-per-row, one snapshot per row, snapshot after the first live read, live reads
after a snapshot, a false live revision, public total or account constants, refusing a report when
a commit is pending, and a reader-wide writer freeze.

## Assurance scope

Local mode is self-paced, honor-system verification. Someone who owns the Docker daemon and image
cannot be prevented from inspecting hidden properties. The boundary here is misdelivery: the
participant Workbench contains public evidence, tests, and starter material only. Hidden checks,
expected-answer derivation, and the verifier are in a separate internal image; the participant
image also omits `reference/` and `mutation.py`. The author stage adds author-only material for CI.

Local mode does **not** support competition ranking, examination, or completion certification.

Both services run as non-root with a read-only root filesystem, all capabilities dropped,
`no-new-privileges`, bounded memory and PIDs. Only the Workbench has a loopback-published port; the
verifier is reachable solely over an internal network. A publish-only bridge with masquerading
disabled provides no required outbound path.
Fixtures, public and hidden tests, and grading are all derived deterministically from the seed.
