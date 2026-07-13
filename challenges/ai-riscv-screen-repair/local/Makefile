VIDEO_SOURCE ?= solution/video_controller.sv
BUILD_DIR := build
SIMULATOR := $(BUILD_DIR)/obj_dir/sim
FIRMWARE_ELF := $(BUILD_DIR)/firmware.elf
FIRMWARE_BIN := $(BUILD_DIR)/firmware.bin
FIRMWARE_HEX := $(BUILD_DIR)/firmware.hex
FRAME := $(BUILD_DIR)/frame.ppm
EXPECTED_FRAME_SHA256 := f1ccd5e83d91df15ef4d969c4be3ba4bdc08e1c2ebd2d2408e1cc509e13688c6

RISCV_GCC := riscv64-unknown-elf-gcc
RISCV_OBJCOPY := riscv64-unknown-elf-objcopy

.PHONY: test wave clean

test: $(SIMULATOR)
	python3 -m unittest discover -s tests -p 'test_*.py'
	@set +e; output="$$(timeout 30s $(SIMULATOR) 2>&1)"; status=$$?; set -e; \
		printf '%s\n' "$$output"; \
		test $$status -eq 0; \
		printf '%s\n' "$$output" | grep -F "SIM_PASS" >/dev/null; \
		test -s $(FRAME); \
		digest="$$(sha256sum $(FRAME) | awk '{print $$1}')"; \
		test "$$digest" = "$(EXPECTED_FRAME_SHA256)"; \
		echo "FRAME_SHA256 $$digest"

wave: $(SIMULATOR)
	@set +e; timeout 30s $(SIMULATOR) +trace >/dev/null 2>&1; set -e; \
		test -s $(BUILD_DIR)/wave.vcd; \
		echo "WAVE_READY $(BUILD_DIR)/wave.vcd"

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(FIRMWARE_ELF): firmware/pattern.S firmware/link.ld | $(BUILD_DIR)
	$(RISCV_GCC) -march=rv32i -mabi=ilp32 -nostdlib -nostartfiles \
		-Wl,--build-id=none -Wl,-T,firmware/link.ld \
		-o $@ firmware/pattern.S

$(FIRMWARE_BIN): $(FIRMWARE_ELF)
	$(RISCV_OBJCOPY) -O binary $< $@

$(FIRMWARE_HEX): $(FIRMWARE_BIN)
	od -An -v -t x1 $< | tr -s ' ' '\n' | sed '/^$$/d' > $@

$(SIMULATOR): $(VIDEO_SOURCE) rtl/video_controller_core.sv rtl/rv32i_cpu_core.sv \
		rtl/rv32i_cpu.sv rtl/riscv_screen_soc.sv tests/tb_screen.sv $(FIRMWARE_HEX)
	verilator --binary --timing --trace --top-module tb_screen \
		-Wall -Wno-fatal -Wno-DECLFILENAME -Wno-UNUSEDSIGNAL \
		-Wno-UNOPTFLAT -Wno-BLKSEQ -Wno-SYNCASYNCNET \
		-Mdir $(BUILD_DIR)/obj_dir -o sim \
		$(VIDEO_SOURCE) rtl/video_controller_core.sv rtl/rv32i_cpu_core.sv \
		rtl/rv32i_cpu.sv rtl/riscv_screen_soc.sv tests/tb_screen.sv

clean:
	@if [ -d $(BUILD_DIR) ]; then find $(BUILD_DIR) -mindepth 1 -depth -delete; fi
