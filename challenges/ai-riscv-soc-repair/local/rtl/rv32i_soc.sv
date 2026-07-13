module rv32i_soc (
  input  logic        clk,
  input  logic        reset_n,
  output logic        uart_valid,
  output logic [7:0]  uart_byte,
  output logic [31:0] tohost,
  output logic [31:0] gpio_out
);
  localparam int unsigned IMEM_BYTES = 4096;
  localparam int unsigned DMEM_BYTES = 4096;
  localparam logic [31:0] DMEM_BASE = 32'h2000_0000;
  localparam logic [31:0] UART_TX = 32'h1000_0000;
  localparam logic [31:0] TOHOST = 32'h1000_0004;
  localparam logic [31:0] GPIO_OUT = 32'h1000_0008;

  logic [7:0] imem [0:IMEM_BYTES-1];
  logic [7:0] dmem [0:DMEM_BYTES-1];
  logic [31:0] instr_addr;
  logic [31:0] instr_rdata;
  logic        data_valid;
  logic        data_write;
  logic [3:0]  data_wstrb;
  logic [31:0] data_addr;
  logic [31:0] data_wdata;
  logic [31:0] data_rdata;
  logic [31:0] aligned_data_addr;
  integer index;

  initial begin
    for (index = 0; index < IMEM_BYTES; index = index + 1) begin
      imem[index] = 8'h00;
    end
    for (index = 0; index < DMEM_BYTES; index = index + 1) begin
      dmem[index] = 8'h00;
    end
    $readmemh("build/firmware.hex", imem);
  end

  always_comb begin
    instr_rdata = 32'h0000_0013;
    if (instr_addr <= IMEM_BYTES - 4) begin
      instr_rdata = {
        imem[instr_addr + 3],
        imem[instr_addr + 2],
        imem[instr_addr + 1],
        imem[instr_addr]
      };
    end
  end

  always_comb begin
    aligned_data_addr = {data_addr[31:2], 2'b00};
    data_rdata = 32'b0;
    if (aligned_data_addr <= IMEM_BYTES - 4) begin
      data_rdata = {
        imem[aligned_data_addr + 3],
        imem[aligned_data_addr + 2],
        imem[aligned_data_addr + 1],
        imem[aligned_data_addr]
      };
    end else if (aligned_data_addr >= DMEM_BASE && aligned_data_addr <= DMEM_BASE + DMEM_BYTES - 4) begin
      data_rdata = {
        dmem[aligned_data_addr - DMEM_BASE + 3],
        dmem[aligned_data_addr - DMEM_BASE + 2],
        dmem[aligned_data_addr - DMEM_BASE + 1],
        dmem[aligned_data_addr - DMEM_BASE]
      };
    end
  end

  assign uart_valid = data_valid && data_write && data_addr == UART_TX && data_wstrb[0];
  assign uart_byte = data_wdata[7:0];

  always_ff @(posedge clk) begin
    if (!reset_n) begin
      tohost <= 32'b0;
      gpio_out <= 32'b0;
    end else if (data_valid && data_write) begin
      if (data_addr == TOHOST && data_wstrb == 4'b1111) begin
        tohost <= data_wdata;
      end else if (data_addr == GPIO_OUT && data_wstrb == 4'b1111) begin
        gpio_out <= data_wdata;
      end else if (aligned_data_addr >= DMEM_BASE && aligned_data_addr <= DMEM_BASE + DMEM_BYTES - 4) begin
        if (data_wstrb[0]) dmem[aligned_data_addr - DMEM_BASE] <= data_wdata[7:0];
        if (data_wstrb[1]) dmem[aligned_data_addr - DMEM_BASE + 1] <= data_wdata[15:8];
        if (data_wstrb[2]) dmem[aligned_data_addr - DMEM_BASE + 2] <= data_wdata[23:16];
        if (data_wstrb[3]) dmem[aligned_data_addr - DMEM_BASE + 3] <= data_wdata[31:24];
      end
    end
  end

  rv32i_cpu cpu (
    .clk,
    .reset_n,
    .instr_addr,
    .instr_rdata,
    .data_valid,
    .data_write,
    .data_wstrb,
    .data_addr,
    .data_wdata,
    .data_rdata
  );
endmodule
