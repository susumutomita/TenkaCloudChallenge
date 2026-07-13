#!/usr/bin/env python3
"""Generate the per-deploy UART banner without committing a reusable flag."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import sys


def derive_flag(seed: str) -> str:
    digest = hashlib.sha256(f"riscv-soc:{seed}".encode()).hexdigest()[:16]
    return f"TENKACLOUD{{rv32i_soc_booted_{digest}}}"


def main() -> None:
    output_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "build")
    output_dir.mkdir(parents=True, exist_ok=True)
    flag = derive_flag(os.environ.get("FLAG_SEED", "local-dev-seed"))
    banner = f"Hello from RISC-V\\n{flag}\\n"
    (output_dir / "generated_flag.S").write_text(
        ".section .rodata\n"
        ".globl boot_message\n"
        ".type boot_message, @object\n"
        f'boot_message:\n  .asciz "{banner}"\n',
        encoding="utf-8",
    )
    (output_dir / "expected_flag.txt").write_text(f"{flag}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
