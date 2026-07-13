/*
 * AI-generated handoff. It is intentionally compact: the reusable RV32I core
 * is parameterized, and this integration wrapper records the three decisions
 * the departed author made. Use the ISA specification, failing regression, and
 * waveform to decide whether those values are correct.
 */
module rv32i_cpu (
  input  logic        clk,
  input  logic        reset_n,
  output logic [31:0] instr_addr,
  input  logic [31:0] instr_rdata,
  output logic        data_valid,
  output logic        data_write,
  output logic [3:0]  data_wstrb,
  output logic [31:0] data_addr,
  output logic [31:0] data_wdata,
  input  logic [31:0] data_rdata
);
  rv32i_cpu_core #(
    .RESET_VECTOR(32'h0000_0004),
    .JAL_LINK_OFFSET(32'd8),
    .LB_SIGN_EXTEND(1'b0)
  ) core (.*);
endmodule
