module riscv_screen_soc (
  input  logic        cpu_clk,
  input  logic        pixel_clk,
  input  logic        reset_n,
  output logic [31:0] tohost,
  output logic        control_req_toggle,
  output logic        control_ack_toggle,
  output logic        video_enabled,
  output logic        hsync_n,
  output logic        vsync_n,
  output logic        video_active,
  output logic [7:0]  pixel_index,
  output logic        line_start,
  output logic        frame_start
);
  localparam integer IMEM_BYTES = 4096;
  localparam integer DMEM_BYTES = 4096;
  localparam logic [31:0] DMEM_BASE = 32'h2000_0000;
  localparam logic [31:0] TOHOST = 32'h1000_0004;
  localparam logic [31:0] VIDEO_CONTROL = 32'h1000_1000;
  localparam logic [31:0] VIDEO_STATUS = 32'h1000_1004;
  localparam logic [31:0] FRAMEBUFFER_BASE = 32'h1000_2000;
  localparam logic [31:0] FRAMEBUFFER_END = 32'h1000_20bf;

  logic [7:0] imem [0:IMEM_BYTES-1];
  logic [7:0] dmem [0:DMEM_BYTES-1];
  logic [1:0] cpu_reset_sync;
  logic [1:0] pixel_reset_sync;
  logic cpu_reset_n;
  logic pixel_reset_n;
  logic [31:0] instr_addr;
  logic [31:0] instr_rdata;
  logic data_valid;
  logic data_write;
  logic [3:0] data_wstrb;
  logic [31:0] data_addr;
  logic [31:0] data_wdata;
  logic [31:0] data_rdata;
  logic [31:0] aligned_data_addr;
  logic control_enable;
  logic [1:0] ack_sync;
  logic [1:0] enabled_sync;
  logic fb_write;
  logic [7:0] fb_addr;
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

  always_ff @(posedge cpu_clk or negedge reset_n) begin
    if (!reset_n) begin
      cpu_reset_sync <= 2'b00;
    end else begin
      cpu_reset_sync <= {cpu_reset_sync[0], 1'b1};
    end
  end

  always_ff @(posedge pixel_clk or negedge reset_n) begin
    if (!reset_n) begin
      pixel_reset_sync <= 2'b00;
    end else begin
      pixel_reset_sync <= {pixel_reset_sync[0], 1'b1};
    end
  end

  assign cpu_reset_n = cpu_reset_sync[1];
  assign pixel_reset_n = pixel_reset_sync[1];

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
    end else if (
      aligned_data_addr >= DMEM_BASE &&
      aligned_data_addr <= DMEM_BASE + DMEM_BYTES - 4
    ) begin
      data_rdata = {
        dmem[aligned_data_addr - DMEM_BASE + 3],
        dmem[aligned_data_addr - DMEM_BASE + 2],
        dmem[aligned_data_addr - DMEM_BASE + 1],
        dmem[aligned_data_addr - DMEM_BASE]
      };
    end else if (aligned_data_addr == VIDEO_CONTROL) begin
      data_rdata = {31'b0, control_enable};
    end else if (aligned_data_addr == VIDEO_STATUS) begin
      data_rdata = {30'b0, control_req_toggle != ack_sync[1], enabled_sync[1]};
    end
  end

  always_ff @(posedge cpu_clk or negedge cpu_reset_n) begin
    if (!cpu_reset_n) begin
      tohost <= 32'b0;
      control_enable <= 1'b0;
      control_req_toggle <= 1'b0;
      ack_sync <= 2'b00;
      enabled_sync <= 2'b00;
    end else begin
      ack_sync <= {ack_sync[0], control_ack_toggle};
      enabled_sync <= {enabled_sync[0], video_enabled};
      if (data_valid && data_write) begin
        if (data_addr == TOHOST && data_wstrb == 4'b1111) begin
          tohost <= data_wdata;
        end else if (data_addr == VIDEO_CONTROL && data_wstrb == 4'b1111) begin
          control_enable <= data_wdata[0];
          control_req_toggle <= !control_req_toggle;
        end else if (
          aligned_data_addr >= DMEM_BASE &&
          aligned_data_addr <= DMEM_BASE + DMEM_BYTES - 4
        ) begin
          if (data_wstrb[0]) dmem[aligned_data_addr - DMEM_BASE] <= data_wdata[7:0];
          if (data_wstrb[1]) dmem[aligned_data_addr - DMEM_BASE + 1] <= data_wdata[15:8];
          if (data_wstrb[2]) dmem[aligned_data_addr - DMEM_BASE + 2] <= data_wdata[23:16];
          if (data_wstrb[3]) dmem[aligned_data_addr - DMEM_BASE + 3] <= data_wdata[31:24];
        end
      end
    end
  end

  assign fb_write = data_valid && data_write &&
    data_addr >= FRAMEBUFFER_BASE && data_addr <= FRAMEBUFFER_END;
  assign fb_addr = data_addr[7:0];

  rv32i_cpu cpu (
    .clk(cpu_clk),
    .reset_n(cpu_reset_n),
    .instr_addr,
    .instr_rdata,
    .data_valid,
    .data_write,
    .data_wstrb,
    .data_addr,
    .data_wdata,
    .data_rdata
  );

  video_controller video (
    .cpu_clk,
    .cpu_reset_n,
    .pixel_clk,
    .pixel_reset_n,
    .control_req_toggle,
    .control_enable,
    .control_ack_toggle,
    .video_enabled,
    .fb_write,
    .fb_addr,
    .fb_wstrb(data_wstrb),
    .fb_wdata(data_wdata),
    .hsync_n,
    .vsync_n,
    .video_active,
    .pixel_index,
    .line_start,
    .frame_start
  );
endmodule
