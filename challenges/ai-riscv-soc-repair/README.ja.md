# AI製RISC-V SoCを起動せよ

生成AIが小型ゲーム機向けSoCを実装し、「RTLはcompileできた」と報告して離脱した。
しかしCPUは最初のUART messageへ到達しない。手元に残ったsource、firmware、memory map、
短い設計log、失敗する回帰テストを引き継ぐ。

CPUを全面的に書き直す課題ではない。`local/solution/rv32i_cpu.sv` にある3つの誤った
integration判断を見つけ、それぞれをRV32I contractから説明し、firmwareにdeployごとの
flagを出力させる。

## 動くもの

Level 1 MVPは実FPGAなしで完結するように範囲を絞っている。

- single-cycle RV32I CPU
- 4 KiB instruction ROMと4 KiB data RAM
- memory-mapped UART、GPIO、simulation専用TOHOST register
- GNU RISC-V toolchainでbuildするbare-metal assembly firmware
- Docker内のVerilator simulation
- loopbackのlab pageとTenkaCloud `/verify` endpoint

実行対象subsetは `LUI`、`AUIPC`、`JAL`、`JALR`、conditional branch、
`LB/LH/LW/LBU/LHU`、`SB/SH/SW`、RV32I integer ALU命令。Level 1にはcompressed
instruction、CSR、interrupt、atomic、multiply/divide、cache、MMU、privilege modeを含めない。

## 失敗する初期状態を実行する

このdirectoryで次を実行する。

```bash
make test
```

DockerがVerilatorとRISC-V GCC toolchain入りのlab環境をbuildし、mountされたparticipant RTLを
compileし、firmwareをbuildしてSoCを実行する。引き継いだ初期状態は失敗するのが正しい。

編集前に次を読む。

- [`artifacts/architecture.md`](./artifacts/architecture.md)
- [`artifacts/memory-map.md`](./artifacts/memory-map.md)
- [`artifacts/ai-design-log.md`](./artifacts/ai-design-log.md)
- [`artifacts/toolchain.md`](./artifacts/toolchain.md)

その後 `local/solution/rv32i_cpu.sv` だけを編集して `make test` を再実行する。成功時は次が出る。

```text
Hello from RISC-V
TENKACLOUD{rv32i_soc_booted_<実行ごとのdigest>}
SIM_PASS ...
```

browser labの **Capture waveform** はmount中のRTLを再実行し、PC、instruction/data bus、
UART、GPIO、TOHOSTを含むbounded VCDをdownloadする。bootが停止した状態でも原因調査に使える。

TenkaCloud platform rootから `make local PROBLEM=ai-riscv-soc-repair` を
実行するとbrowser labが開き、このflagを提出できる。Codespacesも
同梱Docker-in-Docker環境で同じflowを実行でき、local toolchainやFPGAは不要。

## 採点と学習

難易度4、想定90〜120分、300点のChallenge。誤答は15点減点。段階hintは30、45、75点。
正解後、portalは各症状をRV32I仕様へ結び付ける解説と、より一般的な教訓を表示する:
AI生成RTLがcompileできてもhardware contractが正しい証明にはならない。

## Costと安全性

local DockerのCPUとmemoryだけを使う。port 18080/18081は`127.0.0.1`だけにbindし、host device、
privileged mode、host network、AWS resource、credential、物理hardwareは使わない。停止は`make down`。

Level 2（screen timingとCDC）は意図的に分離し、
[TenkaCloudChallenge #184](https://github.com/susumutomita/TenkaCloudChallenge/issues/184)で追跡する。
scopeを固定した案は
[`artifacts/level-2-issue.md`](./artifacts/level-2-issue.md)を参照。
