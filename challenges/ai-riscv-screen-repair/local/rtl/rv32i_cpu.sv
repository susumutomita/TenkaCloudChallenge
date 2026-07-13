// Repaired Level 1 integration wrapper. It is fixed infrastructure in Level 2.
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
    .RESET_VECTOR(32'h0000_0000),
    .JAL_LINK_OFFSET(32'd4),
    .LB_SIGN_EXTEND(1'b1)
  ) core (.*);
endmodule
