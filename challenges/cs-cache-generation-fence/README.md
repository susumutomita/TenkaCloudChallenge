# Deleted. The old value still came back

This is the 45–75 minute local problem for chapter 4 of `cs-foundations`.

Prerequisite: reading Python functions and dictionaries.
Not assumed: prior knowledge of caches, revisions or concurrency.

## Why this matters

A product price was updated and the old cached price deleted. The next purchase screen still showed the old price.
A successful delete cannot stop work that was already reading origin. After this problem you can explain, in running
code, why freshness has to be checked **at cache admission time**.

## Vocabulary first

- **origin**: the source of truth.
- **cache**: a dictionary holding a temporary copy read from origin.
- **revision**: an integer version increased by each origin commit.
- **cache miss**: the cache has no entry, so an origin read starts.
- **fill**: an origin read finishes and tries to put its value in cache.
- **invalidation**: notice that a key changed and its old entry must not be used.
- **generation floor**: the per-key lower bound below which a fill is too old to admit.

## The smallest real example

```text
time 1  cache miss for sku-314 rev 7; origin read starts
time 2  sku-314 rev 8 commits to origin
time 3  sku-314 is invalidated; its cache entry is deleted
time 4  the read from time 1 finishes late and fills rev 7
time 5  cache hit returns rev 7             ← origin is already rev 8
```

The public tests run `update → invalidate → read` sequentially, so the reversal at time 4 never occurs. The broken
starter therefore stays green. That is the entry point of the exercise, not an accidental test gap.

## Solve in Participant Portal

1. Start the problem from Participant Portal.
2. Select **Inspect evidence** and read this deployment's race timeline and decision log.
3. For `audit`, track the latest `origin_commit` per key and submit, as a JSON array, the explicit `index` values of
   `cache_hit` rows with a lower revision. Use the log's `index` field rather than counting displayed lines.
4. Edit these two functions in `cache_policy.py`:

```python
invalidate(cache, key, committed_revision) -> None
admit_fill(cache, key, value, revision) -> bool
```

The state shape is documented at the top of the starter. `admit_fill` returns `True` only when it stores the fill.

5. Run the public tests to preserve ordinary hit/miss and sequential update behaviour.
6. Submit each checkpoint. Code checkpoints use the current editor through the prepare API.

For the same local terminal entry points, run these commands in the problem directory:

```bash
make inspect
make test
make test-one ID=sequential
make reset
```

`make reference-test` is an author check, not a participant solve path.

## Required properties

- Remove the old entry for an invalidated key.
- Retain the invalidation revision per key and reject older fills.
- Admit a fill at exactly the floor revision.
- Never move a floor backwards on an older invalidation.
- An out-of-order invalidation must not delete an entry at the same or a newer revision.
- Do not overwrite an already cached newer entry with a late older fill.
- Do not block healthy fills for another key.

Disabling cache, setting TTL to zero or using one global floor for all keys does not pass.

## Checkpoints

| ID | Points | Property |
| --- | ---: | --- |
| `environment` | 10 | the running container pass phrase |
| `audit` | 30 | stale cache responses in the log |
| `basic-invalidate` | 25 | deletion plus remembered generation |
| `fence` | 50 | refusal of a late old fill |
| `per-key` | 35 | isolation between keys |
| `generalize` | 50 | unseen revisions and orderings |

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, Docker daemon and image, so nothing in
the image is confidential from you. Omitting `reference/` and the mutation suite from the participant image prevents
accidental delivery; it is not confidentiality, and anyone who builds the `author` stage can inspect them.

The verifier is published only at host `127.0.0.1:18340`. It runs non-root with a read-only filesystem,
no-new-privileges, no capabilities and no outbound network. Submissions run in a temporary workspace with time and
resource limits; a checkpoint can only credit the id it echoes and its response does not reveal expected values.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification.

## Next

The ordering and repeated logical-operation vocabulary returns in chapter 5, HTTP retry and idempotency.
