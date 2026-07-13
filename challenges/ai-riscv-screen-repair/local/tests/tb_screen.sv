module tb_screen;
  localparam integer EXPECTED_H_TOTAL = 22;
  localparam integer EXPECTED_V_TOTAL = 16;
  localparam integer EXPECTED_FRAME_CLOCKS = EXPECTED_H_TOTAL * EXPECTED_V_TOTAL;
  localparam integer EXPECTED_PIXELS = 16 * 12;

  logic cpu_clk = 1'b0;
  logic pixel_clk = 1'b0;
  logic reset_n = 1'b0;
  logic [31:0] tohost;
  logic control_req_toggle;
  logic control_ack_toggle;
  logic video_enabled;
  logic hsync_n;
  logic vsync_n;
  logic video_active;
  logic [7:0] pixel_index;
  logic line_start;
  logic frame_start;
  logic firmware_done = 1'b0;
  logic reset_done = 1'b0;
  logic cdc_done = 1'b0;
  logic frame_done = 1'b0;
  logic observed_next_frame = 1'b0;
  logic firmware_failure = 1'b0;
  logic reset_failure = 1'b0;
  logic cdc_failure = 1'b0;
  logic timing_failure = 1'b0;
  logic write_strobe_failure = 1'b0;
  integer firmware_cycles;
  integer cdc_edges;
  integer frame_clocks;
  integer pixel_count;
  integer timing_mismatches;
  integer pixel_mismatches;
  integer expected_h;
  integer expected_v;
  integer frame_file;
  integer red_value;
  integer green_value;
  integer blue_value;
  integer failures;

  riscv_screen_soc dut (
    .cpu_clk,
    .pixel_clk,
    .reset_n,
    .tohost,
    .control_req_toggle,
    .control_ack_toggle,
    .video_enabled,
    .hsync_n,
    .vsync_n,
    .video_active,
    .pixel_index,
    .line_start,
    .frame_start
  );

  always #5 cpu_clk = ~cpu_clk;
  always #7 pixel_clk = ~pixel_clk;

  function automatic [7:0] expected_pixel(input integer framebuffer_index);
    begin
      case (framebuffer_index)
        1: expected_pixel = 8'he1;
        66: expected_pixel = 8'h42;
        127: expected_pixel = 8'h7f;
        188: expected_pixel = 8'hbc;
        default: expected_pixel = 8'(17 + framebuffer_index * 13);
      endcase
    end
  endfunction

  initial begin
    if ($test$plusargs("trace")) begin
      $dumpfile("build/wave.vcd");
      $dumpvars(
        0,
        cpu_clk,
        pixel_clk,
        reset_n,
        dut.cpu_reset_n,
        dut.pixel_reset_n,
        dut.cpu.core.pc,
        dut.data_valid,
        dut.data_write,
        dut.data_wstrb,
        dut.data_addr,
        dut.data_wdata,
        control_req_toggle,
        control_ack_toggle,
        video_enabled,
        hsync_n,
        vsync_n,
        video_active,
        pixel_index,
        line_start,
        frame_start
      );
    end
  end

  initial begin
    repeat (4) @(negedge cpu_clk);
    reset_n = 1'b1;
  end

  initial begin : firmware_monitor
    firmware_failure = 1'b0;
    wait (reset_n);
    for (firmware_cycles = 0; firmware_cycles < 5000; firmware_cycles = firmware_cycles + 1) begin
      @(negedge cpu_clk);
      if (tohost == 32'd1) begin
        firmware_done = 1'b1;
        firmware_cycles = 5000;
      end else if (tohost != 32'd0) begin
        firmware_failure = 1'b1;
        firmware_done = 1'b1;
        firmware_cycles = 5000;
      end
    end
    if (!firmware_done) begin
      firmware_failure = 1'b1;
      firmware_done = 1'b1;
    end
  end

  initial begin : reset_monitor
    reset_failure = 1'b0;
    wait (reset_n);
    @(posedge pixel_clk);
    #1;
    if (dut.pixel_reset_n || video_active || !hsync_n || !vsync_n) begin
      reset_failure = 1'b1;
    end
    @(posedge pixel_clk);
    #1;
    if (!dut.pixel_reset_n) begin
      reset_failure = 1'b1;
    end
    reset_done = 1'b1;
  end

  initial begin : cdc_monitor
    cdc_failure = 1'b0;
    cdc_edges = 0;
    wait (control_req_toggle == 1'b1);
    while (control_ack_toggle != control_req_toggle && cdc_edges < 8) begin
      @(posedge pixel_clk);
      cdc_edges = cdc_edges + 1;
      #1;
    end
    if (control_ack_toggle != control_req_toggle || cdc_edges < 3) begin
      cdc_failure = 1'b1;
    end
    cdc_done = 1'b1;
  end

  initial begin : frame_monitor
    timing_failure = 1'b0;
    write_strobe_failure = 1'b0;
    timing_mismatches = 0;
    pixel_mismatches = 0;
    pixel_count = 0;
    frame_clocks = 0;
    wait (video_enabled == 1'b1);
    wait (frame_start == 1'b1);
    frame_file = $fopen("build/frame.ppm", "w");
    if (frame_file == 0) begin
      $fatal(1, "unable to open deterministic frame artifact");
    end
    $fwrite(frame_file, "P3\n16 12\n255\n");

    observed_next_frame = 1'b0;
    while (!observed_next_frame && frame_clocks < 500) begin
      @(negedge pixel_clk);
      if (frame_start && frame_clocks > 0) begin
        observed_next_frame = 1'b1;
      end else begin
        expected_h = frame_clocks % EXPECTED_H_TOTAL;
        expected_v = frame_clocks / EXPECTED_H_TOTAL;

        if (hsync_n != !(expected_h >= 18 && expected_h < 20)) begin
          timing_mismatches = timing_mismatches + 1;
        end
        if (vsync_n != !(expected_v >= 13 && expected_v < 15)) begin
          timing_mismatches = timing_mismatches + 1;
        end
        if (video_active != (expected_h < 16 && expected_v < 12)) begin
          timing_mismatches = timing_mismatches + 1;
        end
        if (line_start != (expected_h == 0)) begin
          timing_mismatches = timing_mismatches + 1;
        end

        if (video_active) begin
          if (pixel_index != expected_pixel(pixel_count)) begin
            pixel_mismatches = pixel_mismatches + 1;
          end
          red_value = {24'b0, pixel_index};
          green_value = {24'b0, pixel_index ^ 8'h55};
          blue_value = {24'b0, 8'hff - pixel_index};
          $fwrite(frame_file, "%0d %0d %0d\n", red_value, green_value, blue_value);
          pixel_count = pixel_count + 1;
        end
        frame_clocks = frame_clocks + 1;
      end
    end
    $fclose(frame_file);

    if (
      !observed_next_frame ||
      frame_clocks != EXPECTED_FRAME_CLOCKS ||
      timing_mismatches != 0 ||
      pixel_count != EXPECTED_PIXELS
    ) begin
      timing_failure = 1'b1;
    end
    if (pixel_mismatches != 0 || pixel_count != EXPECTED_PIXELS) begin
      write_strobe_failure = 1'b1;
    end
    frame_done = 1'b1;
  end

  initial begin : result
    wait (firmware_done && reset_done && cdc_done && frame_done);
    failures = 0;
    if (firmware_failure) begin
      failures = failures + 1;
      $display("FIRMWARE_ASSERT_FAIL tohost=%0d", tohost);
    end
    if (reset_failure) begin
      failures = failures + 1;
      $display("RESET_ASSERT_FAIL expected two-edge synchronous pixel reset release");
    end
    if (cdc_failure) begin
      failures = failures + 1;
      $display("CDC_ASSERT_FAIL request_to_ack_pixel_edges=%0d expected_min=3", cdc_edges);
    end
    if (timing_failure) begin
      failures = failures + 1;
      $display(
        "TIMING_ASSERT_FAIL mismatches=%0d active_pixels=%0d expected_frame_clocks=%0d",
        timing_mismatches,
        pixel_count,
        EXPECTED_FRAME_CLOCKS
      );
    end
    if (write_strobe_failure) begin
      failures = failures + 1;
      $display(
        "WRITE_STROBE_ASSERT_FAIL mismatched_pixels=%0d captured_pixels=%0d",
        pixel_mismatches,
        pixel_count
      );
    end
    if (failures == 0) begin
      $display(
        "SIM_PASS cdc_edges=%0d frame_clocks=%0d active_pixels=%0d",
        cdc_edges,
        frame_clocks,
        pixel_count
      );
      $finish;
    end else begin
      $fatal(1, "%0d screen-controller assertion classes failed", failures);
    end
  end

  initial begin : watchdog
    repeat (20000) @(posedge cpu_clk);
    $fatal(1, "timeout waiting for screen-controller verification");
  end
endmodule
