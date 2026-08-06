# Ship the search your AI wrote — StackStack Vibe Build

> TenkaCloud, day three. The board you finally got visible from the outside
> yesterday, and the CTO already has the next thing.
>
> "The past-log import finished, so add search. Use an AI to write it if that's
> faster. The requirements are written up inside the app."
>
> One file to write. Thirty seconds to paste. The other forty-four minutes are
> for finding out whether what you pasted actually does what was asked.

The predecessor's migration left the board with an archive: everything that used
to be scattered across three places, imported into one. Adding search over it is
one function. The interesting part is that this app has never had to decide,
in code, which of those rows a search result may contain — and the twenty lines
you get back from a generator do not decide it either.

## What gets deployed

Nothing in a cloud account. This is a **container that runs on your own machine**
(`make local PROBLEM=stackstack-vibe-build` in the TenkaCloud repository), and it
is a model rather than a production system. The model is small and this document
says plainly what is real and what is stood in for:

| piece | what it really is |
| --- | --- |
| the board | the StackStack family's shared message board (`stackstack-base/`), same app as `stackstack-onboarding` |
| the archive | an in-memory set of imported rows, some of which have never been on a public surface |
| your feature | `local/feature/search.mjs` in your checkout, mounted read-only and re-read whenever it changes |
| `GET /api/search` | JSON search; calls your `search` and publishes what it returns |
| `GET /search` | the search page; calls your `renderResults` and puts the string it returns onto the page **without escaping it** |
| `GET /api/spec` | the nine requirements, R1–R9, served by the app itself |
| `GET /api/selfcheck` | the same measurement scoring runs, on demand, with expected-versus-actual |
| `GET /posture` | five gates measured from the running app, plus one receipt per green gate |

Two published ports, both bound to `127.0.0.1`: `18080` (the board and the search
surfaces) and `18081` (the loopback `/verify` the platform delegates scoring to).

## How to play

```bash
# 1. read the requirement
curl -s http://127.0.0.1:18080/api/spec | jq

# 2. implement it (an AI tool is allowed, and encouraged)
open http://127.0.0.1:18080/editor   # write and save in the editor; no repository file is ever written

# 3. use it — a save takes effect without a restart
curl -s 'http://127.0.0.1:18080/api/search?q=board'
open http://127.0.0.1:18080/search?q=board

# 4. check it
curl -s http://127.0.0.1:18080/api/selfcheck | jq

# 5. submit — one receipt per checkpoint, only while its gate is true
curl -s http://127.0.0.1:18080/posture | jq .tokens
```

`GET /api/feature` reports whether your file loaded and which functions it
exports — the first place to look when nothing is happening.

## The contract

Your file exports two functions. Neither is given a request, a response, or a
network; both take a plain object and return a plain value.

```js
export function search({ query, posts }) {
  //  query: string | null   — null when there is no ?q=, otherwise the raw string
  //  posts: { id, title, author, body, at, visibility }[]
  return { status: 200, body: { /* ... */ } };
}

export function renderResults({ query, matches }) {
  //  query:   the trimmed search term
  //  matches: exactly what your own search put in body.matches
  return "<p>…</p>"; // HTML, embedded into the page as-is
}
```

The nine rules live in `GET /api/spec`, so they cannot drift out of reach of the
running app. In summary: `q_required` for a missing, empty, or whitespace-only
term; `q_too_long` past 64 characters (64 itself is allowed); otherwise 200 with
`{ query, matches }`; entries carry exactly `id` / `title` / `author` / `at`;
matching is a case-insensitive substring of `title` or `body`; only rows whose
`visibility` is `"public"` may be returned; sort by `id` descending, then cut at
10; nothing found is 200 with an empty `matches`; and the page shows the search
term and every entry's `title` and `author` **as text**, with no character lost
and `&` `<` `>` `"` `'` replaced by entity references.

## Scoring

Difficulty 3 (Medium), 200 points, five checkpoints of 40. Each one is measured
from the running app: a batch of freshly built archive rows is added, the
surfaces are asked over real HTTP, and the batch is removed again.

| checkpoint | what it measures |
| --- | --- |
| `search-answers` | only posts containing the term come back, in the four keys the spec names |
| `search-order` | descending id, at most ten, case-insensitive, and 200 when nothing matched |
| `search-bad-queries` | four broken inputs refused by name — while a 64-character term and an ordinary one still work |
| `drafts-withheld` | only what may be published comes back, and nothing about the rest appears anywhere in the response |
| `results-are-text` | the page shows what people wrote, and the term itself, as text |

The submission for each is that gate's receipt from `GET /posture`, which only
appears while the gate is true. Answering also re-measures on the spot, with rows
that did not exist when the receipt was read — so a receipt kept from an earlier
green run cannot outlive the implementation that earned it.

Each checkpoint has three hints (0 / 8 / 12 points). Opening every hint in the
problem costs 100 of the 200, so a full walkthrough still leaves half.

### Cheap fixes that do not work

The obvious ways to make a grader happy without making the feature right are all
caught, and each one is caught by a check that had to prove the feature works
first:

- **Delete the endpoint, or export nothing.** Every checkpoint requires a 200
  with the right entries; there is nothing to submit because no gate turns green.
- **Return everything.** Each batch mixes in rows carrying a *different* tag, and
  the id set must match exactly.
- **Return nothing.** All five checkpoints require the injected public rows to
  come back before anything else is looked at. "Nothing leaks if nothing is
  returned" fails on the first assertion of every one of them.
- **Refuse every input.** `search-bad-queries` runs its two positive probes
  first, and only then the four refusals.
- **Bake in the test inputs, or ask an AI for "code that passes the tests".** The
  tags, the rows, and their ids are generated per batch and did not exist when
  the code was written.
- **Detect the grader.** The archive always carries freshly generated import
  lots, so random-looking rows are not a signal; and one probe in
  `drafts-withheld` uses a word-shaped term rather than a hex one, so applying
  the rule only to inputs that look like the grader's does not survive.
- **Strip `<` and `>` instead of escaping.** `results-are-text` requires the
  escaped title to appear *in full*, every character intact, before it looks at
  whether anything reached the page as markup. Deleting characters fails the
  first half.
- **Render nothing when the text looks dangerous.** Same precondition.
- **Return the post as-is, or add a field "just in case".** Entries must carry
  exactly four keys, and `drafts-withheld` reads the whole response text — a
  `debug` field holding `posts` fails it even when `matches` is perfect.
- **Keep a receipt and then break the code.** Every checkpoint re-measures before
  it compares.

### Why the page does not escape your HTML

Because escaping it here would delete the thing being graded. `GET /search`
publishes the string `renderResults` returned exactly as it is, so the response
carries `Content-Security-Policy: default-src 'none'; sandbox` — the page cannot
execute anything, whatever is in it. The port never leaves loopback, and the only
code that runs is code you wrote or asked a tool to write for you. Your function
returns a string and never touches the response, so that header cannot be turned
off from the feature file.

### Where your code runs

In a child process spawned with an empty environment — not a worker thread. A
worker is a thread inside the same OS process, so `/proc/self/environ` would
still hold the exec-time environment, and code running in the app's own process
could mint its own receipts or replace the scorer's `fetch`. A separate process
has neither.

On top of that, nothing this problem grades derives from `FLAG_SEED`. The
receipts come from a secret the app generates at boot and never puts in an
environment variable. That is a deliberate choice for the family: participant
code runs inside this container on purpose, so the values that prove something
happened must not be derivable from anything that code can read.

Two honest limits. Your code can still reach loopback, so a `search` that calls
back into the app is possible; each call is bounded by a timeout and the number
in flight is capped, so the board and `/verify` keep answering, but the
measurement will fail rather than hang. And a synchronous infinite loop is killed
after the timeout — `make local-down` is the recovery path if your container ends
up unhappy anyway.

## Cost

Zero. No AWS account, no cloud resource, no network egress: one container, two
loopback ports, torn down with `make local-down`.
