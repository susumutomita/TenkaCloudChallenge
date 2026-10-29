# ストップ高の LP を疑え

**Draft — Docker での起動は未確認。** 問題のユニット/HTTP テストとカタログゲートは通っているが、Compose スタックを Docker ホストでビルド・起動していない。`status` を `ready` にする前に、下の Docker スモークテストを実行すること。

「AI セキュリティ」銘柄の過熱を題材にした、防御側の分析演習。架空のベンダー「カゲロウシールド」が話題だけでストップ高になる中、その名をかたる無料「セキュリティ診断」の案内が、架空の「ひなた食品」の経理部に届く。参加者は社内のセキュリティ担当として、ベンダーの LP (ランディングページ) と同僚が転送した資料を読み、信頼の演出とソーシャルエンジニアリングの各段階を、突き合わせなければ見つからない値で証明する。

会社・人物・製品・認証機関・ドメインはすべて架空で、ドメインはすべて予約済み TLD の `.example` を使う。実在の会社・銘柄・ブランドは登場しない。

## 参加者の道筋と採点の証拠

`scoring.kind` は `multi-verify`。チェックポイント 6 つ、合計 100 点 (Easy ティア)、誤答 1 回につき 1 点減点、ヒントは各 2 つ (全ヒントで 48 点、50% 上限以内)。

| チェックポイント | 手口 | 証拠の場所 | 提出する値 |
| --- | --- | --- | --- |
| `campaign-timer` (15) | カウントダウンで急がせる | LP のタイマーは開くたびに同じ値から始まる | 開始時の分数 |
| `customer-count` (15) | 水増しした導入社数・ロゴ、隠れた注記、誤解を招く統計 | 背景色に近い注記が `/ir` を指している | IR の有償契約社数 |
| `cert-badges` (15) | 偽の認証バッジ | `/evidence/registry.html` で 1 つの番号が別事業者・別の認証 | そのバッジの登録番号 |
| `customer-voices` (15) | 偽のお客様の声 | 2 人の「お客様」が同じ素材写真 `/assets/stock/<id>.svg` | 4 桁の素材番号 |
| `support-line` (20) | 偽サポートのチャットと電話 | LP のチャットと `/evidence/chat-log.txt` 対 `/company`・`/ir` | 公表されていない電話番号 |
| `mail-sender` (20) | 口実メール、似せたドメイン、資格情報を集めるフォーム | `/evidence/mail.eml` の From/Reply-To、フォームの隠しフィールド `relay`、`/evidence/whois.txt`、`/ir` | 似せたドメイン |

タイマーは最初の画面だけで取れる (低い入口)。メールのチェックポイントは、ヘッダー・whois・公式ドメインの記載を合わせて読む必要がある。あいまいな「AI」や「99.9%」の表現は注記と writeup で扱い、単独の採点対象にはしていない。

## 構成

- `local/app/scenario.mjs` (verifier イメージのみ): 実行ごとの値 (分数、有償社数、バッジ番号とどれが偽か、素材番号、電話番号、似せたドメイン) を `FLAG_SEED` から HMAC-SHA256 で導出する。答えも既定の seed もコミットしていない。seed が無い・形式が違う場合は起動しない。
- `local/app/site.mjs`: `:8080` の参加者向け中継。許可した公開 HTML・テキスト・顔写真だけを verifier から受け取り、参加者のヘッダー・本文は転送せず、リダイレクトや任意の取得先 URL も受け付けない。seed・シナリオ生成・回答表を持たず、取得できなければ 503 を返す。
- `local/app/presentation.mjs` と `answers.mjs` (verifier イメージのみ): 公開資料の描画と非公開の採点対応表を担う。verifier の `/surface` は読み取り専用の描画資料を返し、参加者側の中継は `/verify` を転送しない。
- `local/app/verifier.mjs`: `:8081` の別コンテナ。`POST /verify` で `{ checkpointId, submission, context }` を受け、`{ checkpointId, correct, message }` を返す。未知のチェックポイントや壊れた本文は 4xx。message に期待値は含めない。全角数字、`23分`、`00:23:00`、ドメインを含む URL やメールアドレスといった書き方の違いは正規化する。
- `local/Dockerfile`: 2 つの target。`challenge` イメージには `site.mjs` だけを入れ、scenario・presentation・answers・verifier・テスト・metadata・writeup は入れない。`FLAG_SEED` は verifier だけに渡す。
- `local/tests/site.test.mjs`: 複数の seed で 6 つすべてを HTTP の画面だけから解き、受け付ける書き方、おとりの拒否、フォームが何も保存しないこと、`.example` 以外のドメインが出ないことを確かめる。

## 安全の境界

- 「無料診断」フォームは学ぶ対象としての資格情報収集の罠で、動くフィッシングキットではない。送信先は同じコンテナの `/diagnosis` だけで、本文 (最大 16 KiB) は読み捨て、ログ・保存・表示・転送のいずれもせず、訓練用の案内を返す。隠しフィールド `relay` は架空の `.example` ホストを指す、使われない文字列。
- すべてのページに「実在の資格情報や個人情報を入力しない」という訓練用の帯を出し、入力欄にも同じ注意を入れている。
- Compose は両ポートを `127.0.0.1` に bind し、非 root の `node` ユーザー、読み取り専用ルート、capability 削除、`no-new-privileges`、リソース上限、ヘルスチェック付きで動かす。volume、ホストのマウント、Docker ソケットは無い。

## TenkaCloud で動かす

TenkaCloud のカタログソース設定 (`CATALOG_SOURCES=my-catalogs.json make local`) でこのカタログの版を選び、この問題を含むイベントを作って Participant Portal から起動する。**Web** のアクセス先 URL を開く。Docker Engine と Compose が必要。ポートの割り当てと `FLAG_SEED` の注入はプラットフォームが行うので、固定の開発用ポートを配らないこと。

## ローカルでの確認

リポジトリのルートで (Node 22 以上):

```bash
make install
make agent-gate
node --test challenges/security-hype-lp/local/tests/site.test.mjs
```

テストは合成した seed と一時的なループバックのリスナーだけを使う。ブラウザ、Docker、クラウド、本物の秘密は不要。

Docker スモークテスト (この PR ではまだ実行していない):

```bash
cd challenges/security-hype-lp/local
export FLAG_SEED="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
docker compose up --build -d --wait
curl -fsS http://127.0.0.1:18080/ | grep -q 'カゲロウシールド'
curl -fsS -X POST http://127.0.0.1:18081/verify -H 'content-type: application/json' \
  -d '{"checkpointId":"campaign-timer","submission":"0"}'   # "correct":false を期待
docker compose down
unset FLAG_SEED
```

## リソース・コスト・後片付け

AWS などのクラウドリソースは使わず、Region も無い。ローカルコンテナ 2 つ (それぞれ 128 MiB、0.5 CPU、32 プロセスまで) とループバックのポート 2 つ。ビルド時に固定した Node イメージを取得する。1 回あたり 40 分を見込む。永続 volume は無く、`docker compose down` (または TenkaCloud の問題の後片付け) ですべて消える。同じ seed で再起動すれば答えは変わらない。
