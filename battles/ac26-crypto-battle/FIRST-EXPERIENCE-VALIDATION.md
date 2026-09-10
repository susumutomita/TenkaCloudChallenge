# First-mission validation — #867 / #868 / #869

Only problem-pack UI and docs change. Reducer, API, scoring, platform and AWS resources are unchanged. Practice has no coordination client. The delivery metaphor does not claim an actual cloud intrusion.

## Participant-role read-through

The implementing agent read the rendered UI as a novice. This is not an independent participant study or evidence of measured enjoyment.

Situation: combine encrypted packages without opening them. First action: add the left values and enter their remainder, then repeat for the right. Remainder is explained before `mod`. Completion is explicitly labeled, with explanation and return buttons. Competition completion still requires an accepted operation.

First-pass finding: the completion button promised a diagram but initially landed on a topic menu. It now opens the FHE explanation directly. Another finding: browser dark-mode defaults made the practice inputs dark on a light card. The shared input now declares both foreground and background colors.

## Browser verification — 2026-09-10

Real Portal components and real reducer in the local harness; only visible inputs and controls used.

| Case | Result |
| --- | --- |
| Practice (5,9) then (5,2) | Retry guidance, then delivery complete; no score change |
| Return from practice | Existing competition clock continued, score remained 0 |
| FHE: displayed (48,86) and (63,81), divisor 97; submit (14,71) | Rejected; Order remains available; score 0 |
| Retry (14,70) | Order #2 complete, +45, total 45; no decryption follow-up |
| Fresh FHE scenario; advance 2 minutes | Order #2 expiry in history, no reward, next Order shown |
| Fresh deployment scenario | No worksheet during initial projection loading; practice entry available |
| English practice | Purpose, pair inputs, remainder instructions and practice-only button rendered in English |
| 390 × 844 viewport | Cards and input columns stack, dialog scrolls, close button reachable |

The legacy FHE scenario uses an older queue configuration, not the current production concurrency limit. New diagrams are static. Existing reward confetti respects reduced motion. Actual participant evaluation and deployed AWS checks are not performed here.

## Representative Order inventory

Source/read-through inventory, not full browser coverage. These are concrete future design opportunities; this change implements only the representative FHE scene and novice entry.

| Surface | Prerequisite and first action | Reading load / next improvement |
| --- | --- | --- |
| Caesar / Vigenère | Add key, wrap within alphabet, submit row | Medium; align symbol and numeric position |
| Schnorr | Powers and remainders; send commitment | High; show prover/verifier turns in adjacent panels |
| RSA | Repeated multiplication; use supplied exponent | Medium; show direction between plaintext and ciphertext |
| Enigma / Rotor | Follow wiring and advance position | High; illustrate a single traversal |
| Elliptic curve / ECDSA | Supplied modular inverse procedure | High; show current stage and remaining stages |
| MPC | Add incoming masks, subtract outgoing masks | Medium; visually pair masks that cancel |
| SNARK / STARK / iO / anamorphic | Follow table or compare distributions | High; put the claim and exact submission type above the table |
| RPS | Commit, wait, reveal | High; separate participant action from opponent waiting |

## Validation boundary

Dev tests/typecheck, game tests/typecheck and catalog validation are reported in the PR. Guide links target existing local preview, catalog and host rehearsal. No public demo or event date is invented. Announcement remains an unposted draft; no tracking or personal-data collection.

Root `make before-commit` in the user's checkout finds pre-existing Markdown errors under ignored `tmp/TenkaCloudChallenge-704`. That unrelated directory was not modified.

The same root `make before-commit` passed in the isolated checkout: all 21 workspaces, including 7,440 infrastructure tests passed and 3 skipped. The problem-specific tests also passed independently against this change.

## Codex review follow-up — 2026-09-10

All five review findings addressed: validate the modulus before rendering; translate each encrypted-addition rejection; accept leading-zero practice answers with the same 700-digit bound; show an actual FHE mechanism diagram; wrap legacy 19-digit ciphertexts. The reducer and scoring remain unchanged.

The browser accepted `05` / `02` in practice and the completion link opened the named encrypted-delivery figure. At 390px, the real legacy scenario with modulus 2305843009213693951 had no overflowing descendants in the delivery region (clientWidth and scrollWidth both 326px). Game regression suite: 871 passed; dev scenario suite: 114 passed.

Second review: replaced the guide screenshot with a fresh, unanswered practice screen; both fields are blank and no completion verdict is shown. Defined ciphertext before the cards in Japanese and English. The optional arithmetic example now uses unrelated numbers and a different divisor. Browser confirmed the initial definition and blank screenshot; all 8 delivery tests passed.

## Publication and HUNT scene proposals — not implemented here

These are follow-up presentation designs, not new scoring rules or claims about the platform being compromised.

| Authoritative trigger | Proposed scene and next action | Guardrail |
| --- | --- | --- |
| LEAK accepted and corresponding public record received | An opened-package icon with “情報を公開しました”, the actual public values and awarded points; “公開記録を見る” opens that record | Never announce publication while a request is pending or rejected. Show only values already public to all teams. |
| HUNT accepted and score change received | A solved-lock icon with “相手の秘密を読み解きました”, the target and actual awarded points; return to the opponent list | A submitted guess alone is not success. Do not imply a server intrusion or invented damage. |
| Defender receives an authoritative successful-HUNT record | “あなたの秘密が見破られました”, attacker, affected generation and actual score change; link to the existing ROTATE impact preview | Do not disclose the new secret or automatically rotate. Deduplicate by the existing record identity and retain the event in history. |

Use a short static result card beside the relevant action, not a full-screen cutscene. Keep the Order queue, deadlines and answer fields visible. If optional movement is added, respect reduced motion and make the same meaning available in text. On a delayed or failed response, retain a pending/error state until the server result arrives. Validate both attacker and defender views, repeated refresh and rejected guesses before implementing these proposals.
