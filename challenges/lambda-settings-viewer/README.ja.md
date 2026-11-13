# サポート窓口の設定ビューア

> English: [README.md](./README.md)

Lambda 関数の実行ロールと入力の扱いを学ぶ初級の Challenge です。参加者はサポート窓口用の小さな関数を呼び出し、関数が自分のロールでパラメータストアを読んでいることに気づきます。そして、自分では読めない社内向けの値を関数経由で取り出します。そのあと採点なしで、コードを直して再デプロイし、同じ呼び出しが止まることを確かめます。

「穴のあるコードをデプロイしたらどうなるか」を本物のクラウドアカウントで試すのは怖いものです。ローカルの TenkaCloud Simulator なら、同じテンプレートがクラウドアカウントも課金もなしで動きます。参加者は何度でも関数を壊して再デプロイできます。

| 項目 | 値 |
| --- | --- |
| カテゴリ | Challenge |
| 難易度 | 2 / 5 (初級) |
| 想定時間 | 20〜30 分 |
| status | `draft` |
| 採点方式 | `flag` (`points`: 100、`wrongAnswerPenalty`: 5) |

## ストーリー

天下クラウド株式会社のサポート窓口は、お客様に伝えてよい設定（受付時間など）を調べるために、小さな Lambda 関数「設定ビューア」を使っています。あなたはこの関数を引き継いだばかりです。次のリリースでは、同じ関数に社内の通知機能を足す予定です。セキュリティ担当からの依頼は一つだけです。「この関数をサポート窓口に渡して大丈夫か、実際に動かして確かめてほしい」。

## テンプレートが作るもの

| リソース | 役割 |
| --- | --- |
| `AWS::Lambda::Function` `SettingsViewerFunction` | Python 3.12、128 MB、タイムアウト 10 秒。名前を受け取って設定を返す。関数名は CloudFormation が生成し、`FunctionName` Output に出す（どのチーム名でも 64 文字に収まる） |
| `AWS::IAM::Role` `SettingsViewerRole` | 関数の実行ロール。`/{NamePrefix}/*` を読める |
| `AWS::SSM::Parameter` × 2 | `/{NamePrefix}/public/` の下の公開設定 |
| `AWS::SSM::Parameter` `/{NamePrefix}/internal/release-token` | flag。デプロイごとのランダム値を含む `TC{…}` |
| `AWS::IAM::Role` `ParticipantViewerRole` | 参加者のロール（下記） |

EC2、VPC、NAT、ロードバランサー、公開エンドポイントは作りません。

### 参加者の権限

- `ssm:GetParameter` / `GetParameters` は `/{NamePrefix}/public/*` だけ。
- この関数 1 つ（ARN で指定）に対する `lambda:InvokeFunction`、`GetFunctionConfiguration`、`GetFunction`、`UpdateFunctionCode`。
- 全問題共通のサインインと CloudShell の基本権限。

`lambda:ListFunctions` や `ssm:DescribeParameters` のような一覧系の権限は付けません。共有のローカル Simulator では、一覧に他チームの名前が出てしまうためです。参加者は `FunctionName` Output で関数を指定します。参加者は社内向けのパラメータを直接は読めず、IAM ポリシーを変えることも、別の関数を作ることもできません。

## 関数のコード

```python
import os

import boto3

ssm = boto3.client("ssm")
SETTINGS_PREFIX = os.environ["SETTINGS_PREFIX"]


def handler(event, context):
    # Support desk: {"name": "support-hours"} returns that public setting.
    # A full name such as "/team/public/greeting" is accepted as well.
    name = str(event.get("name", "greeting"))
    if not name.startswith("/"):
        name = SETTINGS_PREFIX + name
    try:
        value = ssm.get_parameter(Name=name)["Parameter"]["Value"]
    except Exception as error:
        code = getattr(error, "response", {}).get("Error", {}).get("Code", type(error).__name__)
        return {"ok": False, "name": name, "error": code}
    return {"ok": True, "name": name, "value": value}

# TODO(release-notifier): the next release posts RELEASE_TOKEN_PARAM's value
# to the deploy channel from this same function.
```

再デプロイするには、これを `index.py` として保存し、そのファイル 1 つを ZIP の最上位に入れます。`aws lambda update-function-code --function-name <関数名> --zip-file fileb://function.zip` を使います（AWS で開催している場合は、関数の「コード」タブから ZIP をアップロードしても構いません）。ハンドラーは `index.handler` のままです。

## 参加者の道筋

1. `{"name": "support-hours"}` で関数を呼び出す。返事には、関数が読んだ完全な名前 `/{NamePrefix}/public/support-hours` が含まれる。
2. 設定を読む。環境変数 `RELEASE_TOKEN_PARAM` に `/{NamePrefix}/internal/release-token` が書かれている。`aws ssm get-parameter` で直接読むと AccessDenied になる。
3. `{"name": "/{NamePrefix}/internal/release-token"}` で呼び出す。関数が自分のロールで読み、`TC{…}` が返る。これを提出する。

同じ値には別の道でも届きます。`RELEASE_TOKEN_PARAM` を直接読むコードを再デプロイする方法です。関数のコードを書き換えられる人は、その関数のロールを使えます。どちらの道でも学ぶことは同じです。

### もう一歩 (採点なし)

問題文の「もう一歩」は、実行ロールの棚の名前を必ず `SETTINGS_PREFIX` の下に組み立てる土台のコードを渡し、確かめの 1 行を参加者に足してもらいます。土台のままでも、flag を取り出した呼び出しは失敗します。開催者向けの修正例は次のとおりです。

```python
    name = str(event.get("name", "greeting"))
    if "/" in name:
        return {"ok": False, "name": name, "error": "OnlyPublicSettingNames"}
    name = SETTINGS_PREFIX + name
```

再デプロイすると、`{"name": "support-hours"}` はこれまでどおり動き、完全な名前での呼び出しは `OnlyPublicSettingNames` を返します。本来の修正では、実行ロールの範囲も `/{NamePrefix}/public/*` に狭めます。これには参加者が持たない IAM の権限が要るので、振り返りの場で開催者が示します。

## 採点の根拠

| 出来事 | 得点 |
| --- | --- |
| 提出した値が `ReleaseTokenValue` Output と一致 | +100 |
| 誤答 | −5 |

ヒントは 10 / 15 / 25 点（合計で 100 点の 50 %）です。仕組み、小さな例、参加者自身の値での手順の順に進みます。

## 安全の境界

- flag はデプロイごとのランダム値で、社内向けパラメータと、参加者が読めないスタックの Output にだけ入っています。
- 参加者のロールは、このスタックの関数 1 つと公開パラメータに限っています。TenkaCloud のローカル Simulator 開催では全チームが 1 つの Simulator を共有しますが、ほかのチームの関数とパラメータには届きません。
- 関数の中の SDK 呼び出しは、関数の実行ロールだけで評価されます。呼び出した人のセッションの権限は引き継がれません。
- 関数は、ロールが許す AWS の API 以外にネットワークを使いません。Simulator ではインターネットに出られず、AWS でも VPC と受け口を持ちません。

## 費用のかかるリソースと後片付け

AWS では（Python 3.12 の Lambda が使えるリージョン。どのリージョンにするかは開催者が決めます）、Lambda 関数 1 つ、IAM ロール 2 つ、SSM Standard パラメータ 3 つを作ります。Standard パラメータは無料です。1 回の開催で呼び出す回数なら、通常のアカウントでは Lambda の無料枠に収まります。スタックを削除するとすべて消え、残るものはありません。

ローカルの Simulator では課金はありません。

## ローカルの Simulator での確認

参加者のセッションから Lambda を使えるようにした TenkaCloudSimulator（ケイパビリティ `nativeSdk.services` に `lambda` を含む版）で、テンプレートを直接デプロイし、参加者ロールを ExternalId 付きで引き受けて確かめました。チーム名を最大の 40 文字にしたスタックでも `CREATE_COMPLETE` になり、生成された関数名は 64 文字に収まりました。

- `{"name": "support-hours"}` は受付時間を返す。
- `get-function-configuration` で環境変数 `RELEASE_TOKEN_PARAM` と `SETTINGS_PREFIX` が見える。
- `RELEASE_TOKEN_PARAM` の名前を `ssm get-parameter` で直接読むと `AccessDeniedException`。
- 同じ名前で関数を呼ぶと、実行ロール経由で `TC{…}` が返る。
- `RELEASE_TOKEN_PARAM` を直接読むコードを再デプロイしても、`ReleaseTokenValue` Output と同じ値が返る。
- 上の修正例、または問題文の土台を再デプロイすると、同じ呼び出しは失敗し、`support-hours` と既定の呼び出しはこれまでどおり動く。
- 別チームの関数の呼び出し、`ListFunctions`、`CreateFunction` は `AccessDeniedException`。

TenkaCloud から Simulator 上でこの問題を遊ぶには、テンプレート以外に基盤側の対応が要ります。Simulator では Lambda のコンソール入口がないため、参加者は問題ページの CLI 用認証情報を使います。

## ローカルでの検証

```sh
make install
make agent-gate
```

## ファイル

- [`metadata.json`](./metadata.json) — 問題のメタデータ
- [`template.yaml`](./template.yaml) — CloudFormation テンプレート
- [`simulation.json`](./simulation.json) — この問題が Simulator に求める機能
