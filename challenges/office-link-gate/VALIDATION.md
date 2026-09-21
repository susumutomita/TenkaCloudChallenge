# Preparation Gate validation

## Automated evidence — 2026-09-21

`make test`: four Python tests passed against the real handler and the generated CloudFormation code. They cover all four sequential steps, no scoring flag before completion, retry/resume, tampered and foreign-team tokens, scoring-secret separation, malformed requests, private assets, bilingual output and least-privilege deployment declarations. `node --check web.js` passed. Catalog validation accepted all 119 metadata files.

The existing platform Progression Gate's two focused suites passed (50 tests). The provided `event-gate.json` was also parsed using the actual platform schema and exercised with the existing completion/lock functions: score 0 and incomplete keeps Battle locked; the completion score unlocks it; an unfinished second team remains locked. This is code-level integration evidence, not a deployed portal test.

## Participant evidence

Chromium exercised `preview.py` with the actual handler and no mocked responses. An incorrect first answer stayed on question 1 without a penalty; a correct answer advanced to question 2 without exposing a scoring passphrase. A fresh browser imported the displayed handoff code, resumed at question 2, and completed questions 2–4. Only completion displayed the scoring passphrase. Its copy button showed the copied confirmation. Switching to English retained completion. The 390 × 844 completion screenshot was inspected and browser error collection was empty.

The local preview does not implement official event scores or event-level Gate enforcement. Preview credentials and screenshots containing disposable passphrases are not public artifacts.

## Before hosting

Use the [host rehearsal checklist](../office-link-battle/OPERATOR.md) for real AWS deployment, feature-flag/required-policy configuration, two-team portal lock/unlock and score isolation, beginner play timing, four-person conversation, and teardown/billing checks. These external checks have not been performed and are not claimed as implementation evidence.
