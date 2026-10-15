# Optional help and play-first layout — 2026-09-06

Related: TenkaCloud #3193. Parent and catalog changes must ship together.

The four optional entries open a native modal dialog with its own scroll surface.
The live game stays mounted. The dialog closes with its visible button or Escape;
the ongoing match clock continues. Problem metadata no longer registers a second
HelpDrawer slot below the game. The CIPHER calculation is offered beside LEAK,
with a button that brings its existing input into view. The redundant outer game
frame and duplicate title are removed.

## Local browser evidence

A loopback harness on port 5662 renders the actual parent `ProblemDetailPage`,
`ShellLayout`, Cloudscape components and `PortalPluginSlots`, with this catalog's
`StatusPanel`. The loader uses the real metadata slot declarations. Authentication
and team identity are synthetic. A local fixture drives the actual Battle reducer;
no production credentials, score, AWS endpoint or port 5657 is used.

- Parent baseline: `a8e76247`, with the #3193 layout changes.
- The ready, endpoint-free Battle appears before the collapsed problem/deployment
  reference. Other problems keep their setup-first route; locked problems cannot
  mount the game plugin. Parent regression tests also verify draft retention when
  the reference expands and a fresh team projection arrives.
- At 1280px, opened PROVE, selected table `1243`, and entered `2` into one empty
  cell. Opened the diagram/formula entry, pressed Tab and Escape. The table and
  input remained `1243` and `2`; focus returned to the invoking entry. Page scroll
  remained at its captured pre-open position, 0. This does not claim that clicking
  an offscreen header control returns to an earlier, unobserved input position.
- At 375 × 812, opened the optional practice: document width 375px, dialog client
  width and scroll width both 339px, focus inside the dialog. No horizontal overflow.
- At 640 × 360 (the reflow space of 1280 × 720 at 200%), opened the rules reference
  and verified a reachable close control and internal scrolling. This is headless
  reflow evidence, not an OS/browser zoom-button or physical-device test.
- A modal also locks background document scrolling while open.

The Mac was locked during this pass. The earlier deployed-Portal defect report is
separate evidence; this change has not been deployed or tested on that AWS event.
The combined Order queue (#745) and HUNT (#746) were included in the final local integration pass below.

## Combined queue and answer controls

The fixture uses the deployed frame's `cloudMode: real`, with **all identity and
API calls still local and synthetic**. A visible purple fixture label remains.
It uses the existing dev scenario timings (four-minute ordinary Orders); it does
not represent a production timing study.

- At 1280 × 720, the opening Order's two answer choices fit within the viewport.
  After advancing the fixture clock by one minute, all seven pending cards fit
  inside the queue (343px client height = 343px scroll height). Selecting CIPHER
  retains the queue above the working surface.
- The CIPHER choice focuses and scrolls the actual answer input. At 1280 × 720,
  the queue ends at 354px, the input spans 497–529px, and submit spans 539–577px.
  At 375 × 812, both controls remain visible, with no document horizontal overflow.
- At 640 × 360, the shorter queue uses an internal scroll area and leaves the
  answer controls visible: queue 40–141px, input 230–262px, submit 272–311px.
  The mobile Portal navigation bar does not cover the queue header. Remaining cards are available through that area’s internal scroll. This is a reflow viewport, not native zoom.
- Entered a partial CIPHER answer `2 3`, opened the diagram dialog, then used Tab
  and Escape. The draft remained intact and focus returned to the diagram entry.
- The repository's own dev harness also now mounts only StatusPanel, matching
  metadata, so it no longer adds the removed HelpDrawer below the game.

Screenshots recorded outside the repository: `help3193-seven-compact.png`,
`help3193-cipher-focused.png`, `help3193-cipher-narrow.png`,
`help3193-cipher-reflow-final.png`, and `help3193-practice-final-narrow.png`.
These prove local component/layout behaviour, not AWS persistence or deployment.

## Source material checked

The seminar and the author's notes are separate inputs. For this layout/copy pass:

- Seminar repository `advanced-cryptography-2026` at
  `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`: `week2/problems/toy-mpc/README.md`
  (shares, local addition, mask cancellation and Beaver triples), `week3/README.md`
  (Schnorr's commit/challenge/response and nonce reuse).
- Author's `advanced-cryptography-note` at
  `58344a29ea39c25839475ba9a594c115ed89989b`: `week5/00-fhe-introduction.md`
  (encryption, evaluation, decryption, noise and the TFHE pipeline), and the
  secret-sharing/additive-versus-Shamir sections of `week2/index.html`.

The public copy distinguishes secret sharing from MPC, the sudoku teaching model
from ZK, and the small-number addition model from practical FHE. This pass does
not claim the entire curriculum rewrite in #716 is finished.

## Checks

Parent `make before-commit` passed all workspaces. Child game: 609 tests, zero
failures; dev harness: 49 tests. TypeScript and the 116-entry catalog gate passed. Browser checks above
exercise the real Portal components in addition to those automated checks.
