# Schnorr 8欄の参加者役読解 — #716

2026-09-06。対象はこの問題のみ。別agent（root）が、問題文・3段ヒント・配布starter・show.pyが表示する公開値だけのパケットを読みました。生成器・参考解答・validator・seedを参照せず、計算コードも実行していません。コンテナの実経路とは別の読解検査です。最初のパケットと修正版をそれぞれ `/private/tmp/schnorr-716-participant-first.md`、`/private/tmp/schnorr-716-participant-second.md` に保存しました。

## 初回で見つかった欠陥

- 先頭の「式は下にも無料で」は不要な価格説明だったため、「同じ式は問題文にも載っています」へ変更。
- show.py先頭が「そのままPythonに貼る / paste this block into python3 first」のままで、本文の紙で開始する道筋と衝突。「この問題の公開値」へ変更し、コピーはPythonを使う場合だけの任意操作とした。
- 作者側の追加確認では、最後のP2がnonce再利用で秘密を回収したP1と同じになる例を発見。最後の鍵は自分のPとP1の両方から区別し、8欄目だけ再読・再計算した。

読者は「始めはp,tのみでよい」「8欄の目的と式は追える」「正規のR→e→sと、e先出しの記録構成の区別は明確」と報告した。実UIの長文表示や初回レイアウトはパケットだけでは未確認。

## 修正版の公開値と手計算

以下は独立読者が返信した回答・倍数表を記録したもの。短い算式はその公開値から作者が補記した。回答を計算するコードの実行記録ではない。

```
p=7, a=1, b=1, G=(0,1), t=3, Q=(2,5)
x=2, r=2, e=1
P1=(2,2), e1=4, s1=4, e2=1, s2=0
P2=(0,1), ef=2
```

| 欄 | なぜ行うか | 手計算と提出値 |
|---|---|---|
| field-inv | 後の余りの割り算を可能にする | 3×5=15=2×7+1 → **5** |
| add-points | 公開の点を作る足し算を知る | 2の逆元は4、λ=(5−1)×4=16→2、X=4−0−2=2、Y=2×(0−2)−1=−5→2 → **[2,2]** |
| double | 同じ点の加算を続けられるようにする | λ=(0+1)×4=4、X=16→2、Y=4×(0−2)−1=−9→5 → **[2,5]** |
| order | 回数に使う余りの基準を決める | 下の5行目が初めてO → **5** |
| response | 使い捨ての数で覆った返事を作る | r+ex=2+1×2=4、5での余り4 → **4** |
| verify | 秘密を送らず公開の点を照合する | P=R=2G、sG=4G、R+eP=2G+2G=4G → **[0,6]** |
| nonce-reuse | 同じrを使った2応答から秘密を回収する | d=4−1=3、z=4−0=4、mod5の3の逆元は2、4×2=8→3 → **3** |
| transfer | 質問が先なら1記録を合わせられることを確かめる | P2=G、B=2G、−B=3G。s=0を選ぶとR=3G、R+2G=O=0G → **[2,2,0]** |

独立読者の倍数表:

```
0G=O
1G=(0,1)
2G=(2,5)
3G=(2,2)
4G=(0,6)
5G=O
```

4Gの計算も短い。G+(2,2)ではλ=(2−1)×4=4、X=16−0−2=14→0、Y=4×(0−0)−1=−1→6。5GではGと4Gの横が同じで縦の和1+6=7なのでO。

8欄目の独立した別解はs=3、R=(3−2)G=G、**[0,1,3]**。検算はG+2G=3G。一つの固定解の転記ではない。

## 数学の範囲

これは極小の群での計算と、質問を先に知った場合の一つの受理記録の構成。正規の対話での知識証明、署名のハッシュ処理、全記録の確率分布の一致、実用の安全性を検証したとは扱わない。小さいため秘密を総当たりで回収できることも本文に明示した。

講義は `advanced-cryptography-2026/week3/week3_zksnark_slides.pdf` の印刷番号54〜62と `week3/problems/schnorr-from-scratch/README.md`、作者ノートは `advanced-cryptography-note/week3/index.html` の点加算、応答、検証、simulator節を確認した。講義の乗法記法では a=g^c*y^(−b)、この問題の点加算記法ではR=sG−ePになる。

## 作者の実行証拠と未確認

- host上のlearning回帰8件、19 mutants、信頼したreferenceを公開専用の一時ディレクトリへ置いた公開テストが成功。
- 日英metadataと実Workbench configのラベル、全24 hints / penalty48、未編集starterでのprepare、欄すり替え・改竄・未prepareの拒否を関数境界で確認。
- catalog `make agent-gate` は116件有効。
- 初回のSchnorr用Docker起動は「元のHUNT UX依頼から範囲外」と自動承認レビューに拒否された。その後、ユーザーがChallenge Issuesの修正を明示し、その新しい依頼を根拠とする専用検証が承認された。拒否された操作を同じ前提で迂回してはいない。

### 2026-09-06 実コンテナ・HTTP追検証

専用Compose project `schnorr-716-20260906` を使用し、公開先は `127.0.0.1:18142` のみ。verifierにはhost portを設けていない。main `24ac02fc7e7f2e2683dc7ec6d6d5d893fb6a9329` をfast-forwardで取り込み、準備済みのSchnorr差分が保存前後で同一であることを確認した。

- pinned Dockerfileのparticipant/verifierがbuild・healthcheckに成功。別のauthor targetで `python -m unittest discover -s tests/hidden -p test_isolation.py -v` を実行し、Linux隔離3件すべて成功。secret環境変数の不渡し、親processの `/proc` 読取拒否、IPv4/IPv6/Unix/native socketと子processでのネットワーク拒否、filterの設定失敗時にlearnerを実行しないことを確認した。
- 実 `GET /api/inspect` の値が上記の独立手計算表と一致した。実 `GET /api/starter` の未編集ファイルと手計算の8回答を `/api/prepare` に渡し、生成された各submissionを `/verify` に提出した。**8欄すべてcorrect**。最後の独立した別解 `[0,1,3]` もcorrectになった。
- 実HTTPで、部分prepare、誤答、未prepareの正しい数値、同じ答えになる別欄へのsealすり替え、payload改竄、不正な座標型の拒否を確認。日英のWorkbench名とmetadata、全8欄のanswer種別も一致した。
- 未編集scratchpadの `/api/test` は実行でき、未実装による公開テストのFAILを返す。実learner processにseed/URL環境変数とanswer sourceがなく、socket生成がEPERMになることもHTTPから確認した。
- これとは別の作者検証としてreferenceを `/api/test` に渡し、実隔離runnerで公開テストがPASSすることを確認した。referenceを使った検査を参加者役の読解証拠には含めない。

実行記録は `/private/tmp/schnorr-716-compose.log`、`/private/tmp/schnorr-716-isolation.log`、`/private/tmp/schnorr-716-http-acceptance.log`（26 assertion）、公開API応答は `/private/tmp/schnorr-716-live-{config,inspect,starter}.json`。再現スクリプトは `/private/tmp/schnorr-716-http-acceptance.py`。env秘密の内容は出力していない。

### PR #750 review: init process の seed 露出を閉じた追加確認

同じ専用 project `schnorr-716-20260906`、`127.0.0.1:18142` を合成 seed で起動し、実 `/api/test` の提出コードから `/proc` を検査した。修正前は Python の親プロセスを読めなくても、Tini の `/proc/1/environ` で `FLAG_SEED` の存在を確認できた。値は出力せず、readable / secret_present の boolean だけ記録した。

修正後は seed を verifier コンテナだけへ注入する。Workbench は保護後に内部 API から派生封印鍵を取得するため、Tini と healthcheck の起動環境に seed も鍵も入らない。5秒間の実 learner 実行で全5プロセスを確認し、Tini・healthcheck・learner は secret_present=false、supervisor は読み取り拒否だった。公開口の内部鍵候補3経路は GET/POST すべて404。公開値だけから計算した合成問題の8欄と、誤答・未封印・改ざん・欄の移し替え・別の構成解・実隔離を含む26 assertionsも成功した。この追加回は起動と隔離の回帰であり、上の独立読解の代わりにはしていない。

Linux author image は新しい鍵取得9件、既存隔離3件、学習回帰8件を成功。実Compose専用2件はホストから実HTTPで成功した。カタログ116件も成功。英語shortDescriptionとWorkbench description/labelは `one-time random number` に統一し、実 `/api/config` とmetadataの一致を確認した。metadataの検証はrootの `make agent-gate` によるもので、`reference-test` の学習テストがmetadataまで検証するという旧説明は修正した。

追加ログ: `/private/tmp/schnorr-716-proc-before.log`、`/private/tmp/schnorr-716-proc-after.log`、`/private/tmp/schnorr-716-proc-author-tests.log`、`/private/tmp/schnorr-716-proc-http-acceptance.log`、`/private/tmp/schnorr-716-proc-final-copy.log`、`/private/tmp/schnorr-716-proc-catalog.log`。専用projectは検証後に停止し、container残数0を確認済み（`/private/tmp/schnorr-716-proc-cleanup.log`）。共有project・localhost5657・AWSへは接続していない。

検証後は専用projectの `down` によりコンテナ2つとネットワーク2つを削除し、同projectの `ps -a` が空であることを確認した（`/private/tmp/schnorr-716-cleanup.log`）。最新main上の `make install agent-gate` も116件すべて成功した（`/private/tmp/schnorr-716-final-catalog-gate.log`）。

**実Portalのクリック経路は未確認。** HTTP上の参加者契約の実証と、アプリの画面配置・長文表示の実証は区別する。
# Review follow-up: reproduce the documented live check

On 2026-09-06, the root reviewer used the README's explicit Compose startup for
the isolated `ac26-schnorr-live-check` project, then ran the documented
`SCHNORR_WORKBENCH_URL=http://127.0.0.1:18132 python3 -m unittest discover -s local/tests/hidden -p test_isolation.py -v`.
Both live checks passed; the three Linux-only unit checks were correctly skipped
on macOS (their prior real-Linux results remain recorded below). Tini and the
healthcheck processes were readable but contained no seed, and the supervisor
environment was unreadable. No environment values were printed. The dedicated
Compose project was stopped afterward. The catalog's 116 metadata files passed.

The final Japanese and English explanation now defines a probability distribution
as the probabilities with which the different possible records appear. It does
not claim that constructing one accepted record proves those probabilities equal
to the normal protocol.

## PR #750 follow-up: copyable public output and first-use English

Reviews 3944167835 and 3944167837 identified two remaining defects. Public `part2()`
printed a valid tuple as `(Rx, Ry, s)` while telling the reader to paste it, but the
final answer field requires JSON. Points and records now use `json.dumps`, producing
`[Rx, Ry, s]` for either tuple or list results. The verifier grammar and mathematical
conditions are unchanged. English first-screen descriptions and checkpoint labels
now say “question number”; section 5 first defines its technical name, “challenge.”
Metadata and Workbench labels/descriptions were checked for exact agreement.

The new author-only `test_public_output.py` runs the actual public `part2()`, copies
the text after each arrow without decoding or repairing it, prepares those strings,
and invokes the real verifier handler. Eight synthetic instances cover both curves;
tuple and list return types both pass all eight fields. Python tuple strings remain
rejected. The live test follows `/api/test → /api/prepare → /verify` against the
dedicated `ac26-schnorr-live-check` project on `127.0.0.1:18132`: both return types
passed all eight fields (16 accepted submissions), and both tuple-string negative
submissions failed. It also checked the real first-screen English config. Reference
functions in this transport regression are author evidence, not another independent
participant read-through or a browser-click claim.

`make reference-test IMAGE=ac26-schnorr-output-check` accepted the reference, rejected
all 19 mutations, and passed eight learning, nine bootstrap, three Linux isolation
and one public-output regression. Its three live-only tests were skipped in the
author container, then all three passed over actual HTTP from the host. The final
public formatter was rebuilt and checked over HTTP after its serialization was kept
inside the existing error-display handler. The live process inspection found no
seed in Tini/healthchecks/learner and could not read the supervisor environment.
`make install agent-gate` passed all 116 metadata files; `git diff --check` passed.
The dedicated project's two containers and two networks were removed afterward;
its project-label container listing was empty. No shared environment was changed.

Logs: `/private/tmp/schnorr-750-output-unit.log`, `schnorr-750-output-reference.log`,
`schnorr-750-output-http-final.log`, `schnorr-750-output-live-isolation.log`,
`schnorr-750-output-catalog.log`, `schnorr-750-output-cleanup.log`, and
`schnorr-750-output-remaining.log`. The earlier `schnorr-750-output-http.log` records
the host sandbox's localhost `EPERM`; the explicitly authorized rerun above passed.
