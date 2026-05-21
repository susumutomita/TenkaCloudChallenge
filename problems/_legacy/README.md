# `_legacy/` — 旧 GameDay / JAM 構造

このディレクトリには、 ADR-012 (problem-plugin-architecture) 採択以前の旧構造 (`gameday/` + `jam/`) で書かれた問題群を退避してあります。 Phase 1 (= TenkaCloud 本体 repo の 5 問題を migrate するスライス) でこのディレクトリは丸ごと削除予定です。

## なぜ即削除しないか

- 削除しても git history には残るが、 PR レビュー時に「何が消えたか」を 1 画面で見せるため、 Phase 0 では rename だけに留める。
- 旧 `jam/templates/` 配下に CFn の generic templates が混ざっており、 Phase 1 migrate 時に本体 5 問題の `template.yaml` と比較しながら拾い上げるか判断する必要がある。

## 構成 (移動前の元 path → 退避後の path)

| 元 path                                | 退避後の path                                    |
| -------------------------------------- | ------------------------------------------------ |
| `problems/gameday/`                    | `problems/_legacy/gameday/`                      |
| `problems/jam/`                        | `problems/_legacy/jam/`                          |

## 新構造への移行先

| 旧                                                     | 新 (Phase 1 で配置)                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `_legacy/gameday/security-battle-royale/`              | `problems/battles/security-battle-royale/` (= ADR-012 thick metadata 準拠の本体 repo 版で置換) |
| `_legacy/jam/core/<id>/`                               | `problems/challenges/<id>/` (= Phase 1 以降、 必要なものだけ migrate) |
| `_legacy/jam/generated/<id>/`                          | (= バリアントは scaffolding CLI で再生成する方が現実的、 ケースバイケースで判断) |
| `_legacy/jam/templates/`                               | (= 本体 repo `scripts/tenkacloud-problem.ts` の scaffold が代替している、 確認後削除) |

## 削除予定

Phase 1 PR (本体 5 問題の migrate) でこのディレクトリは `git rm -rf` で削除します。
