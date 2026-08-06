# 署名済みなら、安全？

> TenkaCloud Challenge · 難易度 3 · 45–60 分 · ローカル Docker · multi-verify（6 checkpoint・200 点）

2026-08-04、npm の Keyv / cacheable 周辺 namespace が乗っ取られ、正規の publish pipeline から
改ざん版が公開されました。valid な provenance attestation と、悪性の `preinstall` lifecycle
script を伴ってです。この lab はその failure mode を合成 fixture で再構成します。provenance
attestation が検証するのは「どこで・誰が・どの source から build して publish したか」であり、
source そのものが無害であることは検証しません。実 package にも network にも触れずに、CI の
triage policy を修正します。

## やること

1. fixture を観察する。app の manifest、lockfile、npm 形式の valid な provenance
   attestation、配布 tarball の file inventory、host ごとの install evidence。
2. 期待 file 一覧と配布 tarball の差分を検出する。追加された `preinstall` lifecycle script を
   含む。
3. valid な attestation は source repository と build workflow を束縛するが、source を無害には
   しないと判定する。invalid な attestation は fail closed のまま扱う。
4. resolved dependency を lockfile の exact version・integrity・dependency path で追跡する。
   manifest の semver range では決めない。
5. install lifecycle script を default-deny にし、script が必要な 1 package だけを exact な
   resolved version で許可する。全許可の回答は拒否される。
6. evidence から not-installed / installed-scripts-disabled / scripts-executed を区別し、
   isolation・hunting・credential rotation を過剰でも過小でもなく選ぶ。実行 evidence の無い
   rotation は拒否される。

hidden matrix は依存 graph を並べ替え、無関係な script を足し、clean で valid な package を
混ぜて policy を再評価します。名前 denylist（keyword）型の policy はそこで落ちます。

一次資料は
[npm provenance limitations](https://docs.npmjs.com/generating-provenance-statements/#provenance-limitations)、
[npm lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/)、
[npm-approve-scripts](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/) です。
incident の調査記事は
[Snyk による Keyv compromise の分析](https://snyk.io/blog/inside-keyv-npm-compromise-preinstall-malware-trusted-provenance-ide-hooks/) と
[Socket による compromised namespace の報告](https://socket.dev/blog/popular-npm-packages-in-the-keyv-and-cacheable-namespaces-compromised-in-active-supply-chain) を参照してください。

## model の境界

これは決定論的な教材であり、npm client・registry・Sigstore verifier の emulator ではありません。
fixture はすべて合成データで、package 名・version・digest・attestation は宣言的な data として
与えられ、lifecycle script が実行されることはありません。実在の悪性 package、credential、実行
可能な malware、network access は含まれません。この lab は defense-only で、検出・policy・対応
範囲の判断だけを教え、credential harvesting・伝播・永続化の実装手順は含みません。

## architecture と cleanup

```text
Browser Workbench (participant image, 127.0.0.1:18124)
  -> fixture、starter の盲点、triage policy editor
  -> loopback で公開 case と提出値生成

Verifier image (127.0.0.1:18125)
  -> reference triage、hidden matrix、mutation、6 checkpoint grader
```

image は分離され、non-root、read-only、capability 全削除です。seccomp で外向き network
syscall も拒否します。participant image には reference triage、hidden matrix、mutation
suite、grader を含めません。

    docker compose -f challenges/signed-does-not-mean-safe/local/docker-compose.yml up --build

`http://127.0.0.1:18124/` を開きます。終了時:

    docker compose -f challenges/signed-does-not-mean-safe/local/docker-compose.yml down --volumes --remove-orphans

推定費用は 0 USD です。cloud resource の CREATE / UPDATE / REPLACE / DELETE はありません。

## 保証範囲

local play は honor-system verification です。参加者は host、Docker daemon、image、filesystem
を制御できます。committed reference と hidden verifier の participant image からの分離は通常の
学習経路を保つためで、host owner から到達不能にするものではありません。local 結果を
competition、examination、certification の根拠にはできません。trusted remote verification は
Issue #271 で追跡しています。

自動 CI と agent 操作の local flow は source/runtime evidence です。人間の学習者が最後まで
実施して記録しない限り、human playtest passed とは扱いません。
