# つながるオフィス — AWS復旧Battle

[English](README.md) · [開催ランブック](OPERATOR.ja.md) · [企画 #884](https://github.com/susumutomita/TenkaCloudChallenge/issues/884)

4人で相談し、実際のAWS設定を直して拠点のページを届け続ける入門Battleです。先に [準備Challenge](../../challenges/office-link-gate/README.ja.md) でEC2起動・IGW・経路・Session Manager・HTTPを1つずつ体験します。本戦は準備とは別のEC2とVPCを用意します。

![チームの構成](diagram.svg)

## 遊び方と採点

ポータルのデプロイ出力にある **HealthUrlHint** を「Endpoint登録」の「拠点の状態 / Site health」にそのまま登録し、**GameUrl** を開きます。AWS操作はポータルの「AWS Consoleを開く」からチームの権限へ。対象IDはGameUrlの構成欄と照合します。

運営者が1つだけ障害を開始 → 症状・図・無料ヒントを見て復旧 → 実AWSの検査 → 短い説明問題 → 次の担当へ。4人の役割は操作・図の確認・説明・結果確認です。画面の正解だけでは復旧しません。

既存の `uptime-flat` で、正常な採点1回につき+100点、失敗時−100点。通常の1分周期なら1分ごとの得点です。登録前の既定値は空で、デプロイ成功だけでは得点しません。合言葉や説明の追加得点はありません。正式なスコア・順位・終了時刻はポータルで確認します。4回の復旧と振り返りに約30〜45分を見込み、準備約40分を別に確保します。実測前の目安です。

## 実装と権限

チームごとに別の競技用AWSアカウントを使用。VPC・サブネット・IGW・経路・固定ENI・公開IPv4・EC2 t3.micro / 8 GiB gp3・Session Manager用ロールを作成。ページと観測用プログラムは配布済みです。80番はページ、8080番は秘密を含まない通信・接続確認結果だけを返します。

参加者用Lambdaは構成の読み取り、固定IPの関連付け、ラウンド確認を行います。運営用LambdaだけがIGW/経路/ロール/HTTP許可を変更します。運営関数に公開URLはなく、参加者にInvoke権限を渡しません。状態はこのデプロイ専用のDynamoDBオンデマンド表へ保存し、条件付き書込みで重複開始や同時復旧を拒否します。ExternalIdを維持し、変更先・PassRoleはこの問題の資源へ限定します。

本体の自動障害注入はLiteでSSMを使うため、SSMへの通信自体を失うこの教材では復旧に使いません。**既存のCFNデプロイ・Endpoint登録・稼働時間採点を使い、運営の障害操作と復旧タイマーだけを問題内に置きます。** 詳細は [redteam/README.md](redteam/README.md)。本体に問題別の処理は追加しません。

健康判定は実際のEC2のHTTP応答・外向きHTTPS・必要な通信設定・管理ロールを確認します。管理ラウンドは開始後の新しいSession Manager接続記録と確認コマンドの更新も必要です。10分未復旧なら1分周期のタイマーで復旧を開始。失敗時は重複防止の待ち時間を挟み最短3分後に再試行し、成功したときだけ説明へ進みます。失った点は戻りません。

## 費用と削除

既定地域は東京 `ap-northeast-1`。EC2、EBS、使用中・未使用の公開IPv4、Lambda、保存期間1日のログ、DynamoDB、EventBridgeタイマー、転送に料金が発生し得ます。NAT Gateway・RDS・Secrets Manager・顧客管理KMSキーは追加しません。プラットフォームのDB選択とは別に、この問題のラウンド状態はDynamoDBを使います。費用ゼロの保証はしません。

終了したら管理画面から問題デプロイを削除。タイマー・公開URLを先に閉じ、CFNの削除フックが固定IP解除・対象EC2終了待ち・この問題のIGW削除を行います。CFN削除成功と、EC2/EBS/公開IPv4/IGW/関数/ログ/状態表/タイマーの残存を確認します。失敗を隠さず、原因を直して削除を再試行してください。教材を更新してもラウンドはリセットされません。新しい開催は新規デプロイです。

## ローカルの確認

```bash
python3 -m venv /tmp/office-check
/tmp/office-check/bin/pip install -r ../../runtimes/aws-intro/requirements-test.txt
PATH=/tmp/office-check/bin:$PATH make test
make preview  # 画面確認用。AWS操作・公式得点は発生しません
```

共有のAWSチェッカーは [runtimes/aws-intro](../../runtimes/aws-intro) を変更せず利用します。`build.py` がソースと画面を `template.yaml` にまとめます。カタログルートで `make install && make agent-gate` も実行します。実施した確認と、未実施の実AWSリハーサルは [VALIDATION.md](VALIDATION.md) に分けて記録します。

CFN lintのW2010は既存の秘密URL出力契約に対する警告です。NoEchoでOutputsまで隠れるとは扱いません。参加者にCloudFormation出力取得を許可せず、GameUrlは自チームだけで共有します。
