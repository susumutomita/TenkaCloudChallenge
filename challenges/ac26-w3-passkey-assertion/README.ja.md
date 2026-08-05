# 署名は正しい。それでも拒否する

パスキーのログインは、署名付きの **assertion** としてサーバへ届きます。この問題では
サーバ側に立ち、署名された bytes を組み立て、保存済みの公開鍵で検証します。その直後、
署名は完全に正しいのに本人確認済み bit が 0 の assertion に出会います。

結論は「パスキーが破れた」ではありません。もっと狭く、実装に使える結論です。
**暗号として正しいか**と**サーバの認証方針を満たすか**は別の検査で、relying party は
両方を自分で確かめなければなりません。

## 前提知識

前提にするもの: Python の bytes、辞書、真偽値。

前提にしないもの: 公開鍵と秘密鍵、署名、challenge、assertion、WebAuthn、bit flag。
初出で順に定義します。P-256 ECDSA の楕円曲線計算は完成済みで、参加者は実装しません。

## ログイン 1 回の全体像

```text
端末の authenticator                       ログイン先の server
credential の秘密鍵を持つ                   credential の公開鍵を保存
            |                                           ^
            | challenge + authenticatorData に署名      | 検証
            +---------------- assertion ----------------+
```

- **秘密鍵**は署名を作れる側。relying party へ送らない。
- **公開鍵**は署名を確認できるが作れない側。server はこちらを保存する。
- **challenge** は、このログインのために server が先に出す使い捨ての値。
- **assertion** は authenticator が返す署名付きのログイン応答。
- **authenticatorData** は、この問題では RP ID の SHA-256 hash、flags 1 byte、署名 counter
  の順に並ぶ。
- **UV** (user verified) は、署名対象 flags の `0x04` bit。authenticator が PIN や生体認証などの
  ローカル本人確認を実施したと報告する。

WebAuthn の assertion 検証では、RP ID、origin、challenge、user presence が期待どおりかを
relying party が確かめます。user verification を必須にしたなら UV bit も確認し、
`authenticatorData || SHA-256(clientDataJSON)` の署名を公開鍵で検証します。
一次資料は [WebAuthn Level 3 §7.2](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion) です。

## 答えが必ずある fixture

各 deployment は `FLAG_SEED` から、次の 4 本を**ちょうど 1 本ずつ**作ります。

| 種類 | 署名 | context | UV | UV 必須時の結果 |
| --- | --- | --- | --- | --- |
| 正常 | 正当 | 正当 | 1 | 通す |
| UV なし | 正当 | 正当 | 0 | `user-verification-required` だけで拒否 |
| 署名不正 | 不正 | 正当 | 1 | `signature-invalid` だけで拒否 |
| RP 不一致 | 正当 | RP ID hash だけ不一致 | 1 | `rp-id-mismatch` だけで拒否 |

偶然に期待していません。UV だけ欠けた assertion は全 seed で必ず存在し、UV 必須ポリシーでの
拒否理由は UV の 1 個だけです。WebAuthn credential の `id` は登録 record と一致します。
lab 専用の `caseId` と順序だけが seed ごとに変わるので、位置や名前の丸暗記は hidden seed に
通りません。

この lab は実際の P-256 ECDSA と WebAuthn の署名対象 layout を使います。ただし L1 の範囲は
上の 1 本の assertion 検証だけです。登録、attestation、extensions、backup flags、counter 方針は
この問題の範囲外です。

## 実行する

Participant Portal で問題を起動し、問題文と同じ画面のエディタを使います。作問者は同じ検査を
ローカルでも実行できます。

```bash
make inspect
make test
make test-one ID=signature
make reset
```

`local/starter/assertion.py` の次の関数を完成させます。

1. `signed_message` — 2 つの byte 列を decode し、`clientDataJSON` は SHA-256 にする。
2. `verify_signature` — 保存された公開鍵と完成済み P-256 verifier で検証する。
3. `user_verified` — 32 byte の RP ID hash の次にある byte の `0x04` bit を読む。
4. `find_signed_without_user_verification` — `caseId` や順番ではなく性質で 1 本を選ぶ。
5. `verify_assertion` — context、UV 方針、署名を見て、理由 1 個の verdict を返す。

Portal は現在の source を `signature`、`find-uv-gap`、`enforce-uv` の 3 checkpoint へそれぞれ
提出します。採点は独立です。

## 現実の incident とどこが同じか

Unit 42 の 2026 年 8 月の調査は、TPM を備えた Windows 上の Chrome と Google Password Manager
同期パスキーを対象にしています。原典が明記する初期条件は、被害者端末ですでに malware が
動いていることです。署名アルゴリズムを遠隔から破った話ではありません。

Pass-ta-key の検証では暗号として正当な assertion が作られましたが、UV bit は 0 のままで、
UV を必須にして正しく検査する flow では通常失敗しました。Unit 42 は GitHub が拒否した例を
報告しています。一方、eBay は `userVerification: "required"` を要求しながら UV flag を正しく
検査せず受理した例があり、原典は disclosure 後に eBay が修正済みと明記しています。

この差が L1 の検証 seam です。この lab は endpoint malware、Google Cloud Authenticator、後続の
onboarding や key extraction 攻撃を再現しません。また修正前の eBay の観測を、現在の eBay への
主張へ一般化しません。

一次資料:

- [Unit 42 — Passkeys Under Attack: Three New Ways to Bypass Passwordless Authentication](https://unit42.paloaltonetworks.com/passwordless-authentication-security-risks/)
- [Unit 42 — Google Cloud Authenticator: The Hidden Mechanisms of Passwordless Authentication](https://unit42.paloaltonetworks.com/passwordless-authentication/)
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。

verifier の保証はもっと狭いものです。提出 source は時間・memory・process・output の上限付きで
実行され、checkpoint は echo した id しか加点できず、verdict は期待値を漏らしません。hidden check
はこの deployment の seed から fixture を作り直します。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## author 用の検証

```bash
make reference-test
make solvability
```

hidden suite は checkpoint ごとに未知の 8 seed を再生成します。mutation suite は、署名対象の順序
誤り、署名を常に true にする実装、UP/UV の混同、位置決め打ち、UV 検査の欠落、最終署名検査の
欠落をすべて KILL しなければなりません。
