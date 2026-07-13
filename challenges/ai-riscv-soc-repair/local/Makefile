CPU_SOURCE ?= solution/rv32i_cpu.sv
BUILD_DIR := build
SIMULATOR := $(BUILD_DIR)/obj_dir/sim
FIRMWARE_ELF := $(BUILD_DIR)/firmware.elf
FIRMWARE_BIN := $(BUILD_DIR)/firmware.bin
FIRMWARE_HEX := $(BUILD_DIR)/firmware.hex
GENERATED_FLAG := $(BUILD_DIR)/generated_flag.S

RISCV_GCC := riscv64-unknown-elf-gcc
RISCV_OBJCOPY := riscv64-unknown-elf-objcopy

.PHONY: test wave clean

test: $(SIMULATOR)
	python3 -m unittest discover -s tests -p 'test_*.py'
	@set +e; output="$$(timeout 20s $(SIMULATOR) 2>&1)"; status=$$?; set -e; \
		printf '%s\n' "$$output"; \
		test $$status -eq 0; \
		printf '%s\n' "$$output" | grep -F "SIM_PASS" >/dev/null; \
		printf '%s\n' "$$output" | grep -F "$$(cat $(BUILD_DIR)/expected_flag.txt)" >/dev/null

wave: $(SIMULATOR)
	@set +e; timeout 20s $(SIMULATOR) +trace >/dev/null 2>&1; set -e; \
		test -s $(BUILD_DIR)/wave.vcd; \
		echo "WAVE_READY $(BUILD_DIR)/wave.vcd"

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(GENERATED_FLAG): tools/generate_flag.py | $(BUILD_DIR)
	python3 tools/generate_flag.py $(BUILD_DIR)

$(FIRMWARE_ELF): firmware/boot.S firmware/link.ld $(GENERATED_FLAG)
	$(RISCV_GCC) -march=rv32i -mabi=ilp32 -nostdlib -nostartfiles \
		-Wl,--build-id=none -Wl,-T,firmware/link.ld \
		-o $@ firmware/boot.S $(GENERATED_FLAG)

$(FIRMWARE_BIN): $(FIRMWARE_ELF)
	$(RISCV_OBJCOPY) -O binary $< $@

$(FIRMWARE_HEX): $(FIRMWARE_BIN)
	od -An -v -t x1 $< | tr -s ' ' '\n' | sed '/^$$/d' > $@

$(SIMULATOR): $(CPU_SOURCE) rtl/rv32i_cpu_core.sv rtl/rv32i_soc.sv tests/tb_soc.sv $(FIRMWARE_HEX)
	verilator --binary --timing --trace --top-module tb_soc \
		-Wall -Wno-fatal -Wno-DECLFILENAME -Wno-UNUSEDSIGNAL \
		-Wno-UNOPTFLAT -Wno-BLKSEQ \
		-Mdir $(BUILD_DIR)/obj_dir -o sim \
		$(CPU_SOURCE) rtl/rv32i_cpu_core.sv rtl/rv32i_soc.sv tests/tb_soc.sv

clean:
	@if [ -d $(BUILD_DIR) ]; then find $(BUILD_DIR) -mindepth 1 -depth -delete; fi
