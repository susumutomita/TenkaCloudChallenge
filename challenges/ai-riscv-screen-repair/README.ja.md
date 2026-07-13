# AI製RISC-V画面を復旧せよ

Level 1のRV32I coreは起動するようになった。前任engineerは続けて画面controllerを追加し、
「RTLはcompileできた」と報告してdemo前に離脱した。しかしfirmwareは動いてもvideo timingは短く、
隣のpixelは消え、control bitをpixel clockへどう渡すのか誰も説明できない。

`local/solution/video_controller.sv`のintegration判断を修復する。仕様はRTLより先に書かれている。
protocol、timing、pixelの観測stateを証拠にし、CPUを書き直したりtestbenchを弱めたりしない。

## 動くもの

独立したLevel 2 Challengeとして、Level 1で修復済みのRV32I coreを固定部品として再利用し、
次を追加する。

- bare-metal firmwareが埋める16 × 12 byte-addressed framebuffer
- memory-mapped CONTROL/STATUS register
- domainごとにresetを解除する独立CPU/pixel clock
- active領域とporchを含むactive-low raster sync
- request/acknowledge toggleによるcontrol CDC
- deterministicなPPM frame capture
- loopback labとstate-based TenkaCloud `/verify` endpoint

rasterはsimulationを速くするため意図的に小さいが、exclusive totalにはVGA/HDMI timingと同じ
active/porch/syncの数え方を使う。物理FPGA、display、serializer、video PHYは使わない。

## 失敗する初期状態を実行する

このdirectoryで次を実行する。

```bash
make test
```

DockerはVerilatorとRISC-V GNU toolchainを含むpinned Debian環境をbuildする。引き継いだcontrollerを
compileし、3種類のdefectに対する独立assertionを実行する。

```text
CDC_ASSERT_FAIL ...
TIMING_ASSERT_FAIL ...
WRITE_STROBE_ASSERT_FAIL ...
```

編集前に次のcontractを読む。

- [`artifacts/architecture.md`](./artifacts/architecture.md)
- [`artifacts/memory-map.md`](./artifacts/memory-map.md)
- [`artifacts/ai-design-log.md`](./artifacts/ai-design-log.md)
- [`artifacts/verification-boundary.md`](./artifacts/verification-boundary.md)
- [`artifacts/toolchain.md`](./artifacts/toolchain.md)

その後、`local/solution/video_controller.sv`だけを編集して`make test`を再実行する。回帰テストは
requestからacknowledgeまでのlatency、sync pulse、active-video state、firmwareが書いた全pixel、
frameの正確なdigestを観測する。parameter名やsource textを採点しない。

成功時は次で終わる。

```text
SIM_PASS cdc_edges=3 frame_clocks=352 active_pixels=192
FRAME_SHA256 <deterministic digest>
```

artifactは`local/build/frame.ppm`。browser labから再実行して同じframeをdownloadできる。
mounted participant RTLが通った後にだけ、TenkaCloudへ`VERIFY`を提出する。`/verify`はRTLを
再compileし、live stateからverdictを委譲する。

## DockerとCodespaces

TenkaCloud platform rootから`make local PROBLEM=ai-riscv-screen-repair`を実行するとbrowser labが開く。
GitHub CodespacesはplatformのDocker-in-Docker development containerを使い、同じcompose fileと
commandを実行する。host compiler、USB device、privileged container、FPGA、displayは不要。
port 18200/18201は`127.0.0.1`だけへbindする。

maintainerは`make red-green`で意図したred-to-green pathを証明できる。golden wrapperは問題の
Docker build context外にあり、participant imageへ含まれない。

## 採点と学習

難易度5、想定120〜150分、300点のChallenge。誤答は15点減点。段階hintは30、45、75点。
solve後のwrite-upは、各症状をsynchronizer latencyとhandshake、exclusive counter total、
bus byte enableという一般的な境界へ結び付ける。

Level 1は概念上の前提であり、別の変更されていないChallengeとして残る:
[`ai-riscv-soc-repair`](../ai-riscv-soc-repair/README.ja.md)。

## Verification boundaryとcost

simulationが証明するのはregister behavior、宣言したdigital CDC protocol、raster timing、
generated pixel、deterministic artifact byte。HDMIの電気特性、metastability MTBF、constraint、
synthesis/place-and-route timing、pin behavior、board outputは証明しない。それらには
`artifacts/verification-boundary.md`に示す後続hardware verificationが必要。

boundedなlocal Docker CPU/memoryだけを使い、AWS resourceは作らない。停止は`make down`。
