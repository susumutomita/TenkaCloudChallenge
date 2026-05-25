# Bundles

Curated problem sets for common TenkaCloud use cases. A bundle is a *reference* (list of problem IDs + ordering + duration) — it does not own template / scoring code, those live in the problem directories under `battles/` and `challenges/`.

Bundles are versioned alongside the catalog so an organizer can pin "use the starter-event bundle as of TenkaCloudChallenge `v2026.05.X`" and reproduce the exact lineup.

## Files

- `starter-event.json` — "drop-in preset for a first-time TenkaCloud organizer" (1 Challenge + 2 Battles, 60-90 min). Added in TenkaCloud Issue #1346 to give CCoE / JAWS-UG audiences a credible 'what do I actually run?' answer.

## Schema

Bundle JSON is intentionally lightweight (no JSON Schema yet — see TenkaCloud Issue #1346 follow-ups). Required keys:

| key                    | type     | notes                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------- |
| `id`                   | string   | kebab-case, unique within `bundles/`                                  |
| `name`                 | string   | UI display name (Japanese top-level, English under `i18n.en.name`)    |
| `category`             | string   | currently always `"Bundle"`                                           |
| `status`               | string   | `"ready"` / `"draft"`                                                 |
| `difficulty`           | string   | `"beginner"` / `"intermediate"` / `"advanced"`                        |
| `estimatedDuration`    | string   | free-form (e.g. `"60〜90 分"`)                                        |
| `shortDescription`     | string   | catalog-card body                                                     |
| `description`          | string   | long-form body, including flow recommendation                         |
| `problems`             | string[] | list of `<category>/<id>` paths (relative to repo root)               |
| `learningObjectives`   | string[] | bundle-level learning goals (= aggregated across constituent problems)|

Optional keys: `alternateBattles`, `draftPreviews`, `audience`, `trackingIssue`, `i18n`.

A future PR will lift this into `SCHEMA.json` once a second bundle exists and the shape stabilises.
