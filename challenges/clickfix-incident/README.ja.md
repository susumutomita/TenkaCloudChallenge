# ClickFix インシデント — 偽認証からの侵害調査

> TenkaCloud Challenge · `challenges/clickfix-incident` · 難易度 3 · 約45分 · flag 採点

## ストーリー

天下クラウドの春キャンペーンサイトに問い合わせが続く。*「認証画面が怪しい」*、*「"認証" したら PC が重く
なった」*。

サイトを開くと出てきた ── 偽の **Cloudflare Turnstile / reCAPTCHA** 画面が、訪問者に **Win+R** を押して
コマンドを貼れ、と指示している。これが **ErrTraffic 系の ClickFix 攻撃**。脆弱性ではなくユーザー自身の手を
悪用する。少なくとも 1 人が実行し、host に何かが仕込まれた。

あなたの仕事: 侵害された web host を調査し、`偽認証 → PowerShell → 永続化` の流れを再構成して、攻撃者が
持ち出している **キャンペーン ID** を突き止める。

> **構造的に安全**: 実マルウェア・C2・PowerShell 実行は一切なし。ルアーは無害なモック、PowerShell は擬似
> ログ、WordPress 侵害は安全なサンプルファイル。やるのは調査だけ。

## デプロイされるもの

| リソース | 役割 |
| --- | --- |
| **EC2 web host**（SSM 専用・公開ポートなし） | 侵害痕跡をディスクに持つ。SSM Session Manager で入って調査。 |
| **ParticipantViewerRole** | host への SSM Session Manager ＋ 自スタックの SSM パラメータ読取。**`cloudformation:DescribeStacks` なし**・**`ec2:DescribeInstanceAttribute` を Deny** ── フラグを Output や UserData から読めないので、調査するしかない。 |

host 上の証拠:

```
/var/www/campaign/verify.html                          偽 Turnstile ルアー (ClickFix)
/var/log/clickfix/powershell_history.log               訪問者が貼らされたコマンド (EncodedCommand)
/var/log/clickfix/egress.log                           C2 への定期ビーコン
/var/www/campaign/wp-content/mu-plugins/               WordPress must-use plugins（自動ロード・管理画面に出ない）
```

## 解き方

```bash
# 1. 侵害された host に接続（instance id は WebHostInstanceId Output）
aws ssm start-session --target <WebHostInstanceId>

# 2. 訪問者が貼らされたコマンドを見る（EncodedCommand は base64）
cat /var/log/clickfix/powershell_history.log
echo '<EncodedCommand の base64>' | base64 -d        # -> wp mu-plugin を設置している

# 3. 設置された永続化は must-use plugin（自動ロード・wp-admin に出ない）。
#    healthcheck.php / seo-tweaks.php は正規（おとり）、cache-helper.php が不審。
ls -la /var/www/campaign/wp-content/mu-plugins/
cat /var/www/campaign/wp-content/mu-plugins/cache-helper.php

# 4. その base64 C2 設定をデコード -> 持ち出されている campaign_id がフラグ
grep -oP 'base64_decode\("\K[^"]+' /var/www/campaign/wp-content/mu-plugins/cache-helper.php | base64 -d
# -> {"c2":"verify-cdn-cache.example","campaign_id":"TC{…}", ...}
```

出てきた `campaign_id`（`TC{…}`）を Participant Portal に提出。

> campaign_id は deploy ごとのランダム値で、base64 難読化された永続化アーティファクトの中にしか無い ──
> NamePrefix から導出も Output から読むこともできない（discovered flag）。

## 採点

| | |
| --- | --- |
| 種別 | `flag`（`TC{…}` campaign id を 1 回提出） |
| 配点 | 300 |
| 誤答ペナルティ | −15 |
| ヒント | 3 段（−20 / −50 / −100）: ルアー＋PowerShell の追跡 → mu-plugins 永続化 → アーティファクトの復号 |

## コスト

`t3.micro` 1 台（+ SSM 用の最小 VPC）。無料枠内、`delete-stack` で全消去。

## 学べること

- **ClickFix** の流れ ── 偽 reCAPTCHA/Turnstile が正規の検証手順を装ってコマンドを実行させる手口（本物は
  コマンド実行を求めない）を説明できる。
- 侵害された web host を SSM で調査し、**PowerShell 実行ログ**・**外部通信ログ**・**WordPress `mu-plugins`
  永続化**（自動ロード・管理画面に出ない）から異常を検知する。
- 永続化アーティファクトに埋め込まれた **難読化 (base64) C2 設定** を復号し、持ち出されている情報を特定する。

## 関連ファイル

- [`template.yaml`](./template.yaml) — 侵害された host、仕込まれた証拠、participant role。
- [`metadata.json`](./metadata.json) — カタログ項目・採点・ヒント。
