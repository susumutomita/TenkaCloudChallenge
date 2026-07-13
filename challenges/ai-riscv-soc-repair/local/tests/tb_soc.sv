module tb_soc;
  logic clk = 1'b0;
  logic reset_n = 1'b0;
  logic uart_valid;
  logic [7:0] uart_byte;
  logic [31:0] tohost;
  logic [31:0] gpio_out;
  integer cycles;

  rv32i_soc dut (
    .clk,
    .reset_n,
    .uart_valid,
    .uart_byte,
    .tohost,
    .gpio_out
  );

  always #5 clk = ~clk;

  initial begin
    if ($test$plusargs("trace")) begin
      $dumpfile("build/wave.vcd");
      $dumpvars(
        0,
        clk,
        reset_n,
        dut.cpu.core.pc,
        dut.instr_addr,
        dut.instr_rdata,
        dut.data_valid,
        dut.data_write,
        dut.data_addr,
        dut.data_wdata,
        uart_valid,
        uart_byte,
        gpio_out,
        tohost
      );
    end
  end

  always @(posedge clk) begin
    if (reset_n && uart_valid) begin
      $write("%c", uart_byte);
    end
  end

  initial begin
    repeat (4) @(negedge clk);
    reset_n = 1'b1;

    for (cycles = 0; cycles < 4000; cycles = cycles + 1) begin
      @(negedge clk);
      if (tohost == 32'd1) begin
        if (gpio_out != 32'h0000_00a5) begin
          $fatal(1, "GPIO smoke marker mismatch: %08x", gpio_out);
        end
        $display("SIM_PASS cycles=%0d", cycles);
        $finish;
      end else if (tohost != 32'd0) begin
        $fatal(1, "firmware self-test failed with tohost=%0d", tohost);
      end
    end
    $fatal(1, "timeout waiting for UART boot completion");
  end
endmodule
