module rv32i_cpu_core #(
  parameter logic [31:0] RESET_VECTOR = 32'h0000_0004,
  parameter logic [31:0] JAL_LINK_OFFSET = 32'd8,
  parameter logic LB_SIGN_EXTEND = 1'b0
) (
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
  logic [31:0] pc;
  logic [31:0] pc_next;
  logic [31:0] registers [0:31];
  logic [4:0] rs1_index;
  logic [4:0] rs2_index;
  logic [4:0] rd_index;
  logic [31:0] rs1_value;
  logic [31:0] rs2_value;
  logic [31:0] rd_value;
  logic rd_write;
  logic [31:0] imm_i;
  logic [31:0] imm_s;
  logic [31:0] imm_b;
  logic [31:0] imm_u;
  logic [31:0] imm_j;
  logic [31:0] shifted_load;
  integer register_index;

  assign instr_addr = pc;
  assign rs1_index = instr_rdata[19:15];
  assign rs2_index = instr_rdata[24:20];
  assign rd_index = instr_rdata[11:7];
  assign rs1_value = rs1_index == 0 ? 32'b0 : registers[rs1_index];
  assign rs2_value = rs2_index == 0 ? 32'b0 : registers[rs2_index];
  assign imm_i = {{20{instr_rdata[31]}}, instr_rdata[31:20]};
  assign imm_s = {{20{instr_rdata[31]}}, instr_rdata[31:25], instr_rdata[11:7]};
  assign imm_b = {
    {19{instr_rdata[31]}}, instr_rdata[31], instr_rdata[7],
    instr_rdata[30:25], instr_rdata[11:8], 1'b0
  };
  assign imm_u = {instr_rdata[31:12], 12'b0};
  assign imm_j = {
    {11{instr_rdata[31]}}, instr_rdata[31], instr_rdata[19:12],
    instr_rdata[20], instr_rdata[30:21], 1'b0
  };

  always_comb begin
    pc_next = pc + 32'd4;
    rd_write = 1'b0;
    rd_value = 32'b0;
    data_valid = 1'b0;
    data_write = 1'b0;
    data_wstrb = 4'b0000;
    data_addr = 32'b0;
    data_wdata = 32'b0;
    shifted_load = 32'b0;

    case (instr_rdata[6:0])
      7'b0110111: begin // LUI
        rd_write = 1'b1;
        rd_value = imm_u;
      end
      7'b0010111: begin // AUIPC
        rd_write = 1'b1;
        rd_value = pc + imm_u;
      end
      7'b1101111: begin // JAL
        rd_write = 1'b1;
        rd_value = pc + JAL_LINK_OFFSET;
        pc_next = pc + imm_j;
      end
      7'b1100111: begin // JALR
        rd_write = 1'b1;
        rd_value = pc + 32'd4;
        pc_next = (rs1_value + imm_i) & 32'hffff_fffe;
      end
      7'b1100011: begin // conditional branches
        case (instr_rdata[14:12])
          3'b000: if (rs1_value == rs2_value) pc_next = pc + imm_b;
          3'b001: if (rs1_value != rs2_value) pc_next = pc + imm_b;
          3'b100: if ($signed(rs1_value) < $signed(rs2_value)) pc_next = pc + imm_b;
          3'b101: if ($signed(rs1_value) >= $signed(rs2_value)) pc_next = pc + imm_b;
          3'b110: if (rs1_value < rs2_value) pc_next = pc + imm_b;
          3'b111: if (rs1_value >= rs2_value) pc_next = pc + imm_b;
          default: pc_next = pc + 32'd4;
        endcase
      end
      7'b0000011: begin // loads
        data_valid = 1'b1;
        data_addr = rs1_value + imm_i;
        shifted_load = data_rdata >> (8 * data_addr[1:0]);
        rd_write = 1'b1;
        case (instr_rdata[14:12])
          3'b000: begin
            if (LB_SIGN_EXTEND) rd_value = {{24{shifted_load[7]}}, shifted_load[7:0]};
            else rd_value = {24'b0, shifted_load[7:0]};
          end
          3'b001: rd_value = {{16{shifted_load[15]}}, shifted_load[15:0]};
          3'b010: rd_value = data_rdata;
          3'b100: rd_value = {24'b0, shifted_load[7:0]};
          3'b101: rd_value = {16'b0, shifted_load[15:0]};
          default: begin rd_write = 1'b0; rd_value = 32'b0; end
        endcase
      end
      7'b0100011: begin // stores
        data_valid = 1'b1;
        data_write = 1'b1;
        data_addr = rs1_value + imm_s;
        case (instr_rdata[14:12])
          3'b000: begin
            data_wstrb = 4'b0001 << data_addr[1:0];
            data_wdata = rs2_value << (8 * data_addr[1:0]);
          end
          3'b001: begin
            data_wstrb = 4'b0011 << data_addr[1:0];
            data_wdata = rs2_value << (8 * data_addr[1:0]);
          end
          3'b010: begin
            data_wstrb = 4'b1111;
            data_wdata = rs2_value;
          end
          default: begin data_valid = 1'b0; data_write = 1'b0; end
        endcase
      end
      7'b0010011: begin // immediate ALU
        rd_write = 1'b1;
        case (instr_rdata[14:12])
          3'b000: rd_value = rs1_value + imm_i;
          3'b010: rd_value = {31'b0, $signed(rs1_value) < $signed(imm_i)};
          3'b011: rd_value = {31'b0, rs1_value < imm_i};
          3'b100: rd_value = rs1_value ^ imm_i;
          3'b110: rd_value = rs1_value | imm_i;
          3'b111: rd_value = rs1_value & imm_i;
          3'b001: rd_value = rs1_value << instr_rdata[24:20];
          3'b101: begin
            if (instr_rdata[30]) rd_value = $signed(rs1_value) >>> instr_rdata[24:20];
            else rd_value = rs1_value >> instr_rdata[24:20];
          end
          default: begin rd_write = 1'b0; rd_value = 32'b0; end
        endcase
      end
      7'b0110011: begin // register ALU
        rd_write = 1'b1;
        case (instr_rdata[14:12])
          3'b000: rd_value = instr_rdata[30] ? rs1_value - rs2_value : rs1_value + rs2_value;
          3'b001: rd_value = rs1_value << rs2_value[4:0];
          3'b010: rd_value = {31'b0, $signed(rs1_value) < $signed(rs2_value)};
          3'b011: rd_value = {31'b0, rs1_value < rs2_value};
          3'b100: rd_value = rs1_value ^ rs2_value;
          3'b101: rd_value = instr_rdata[30] ? $signed(rs1_value) >>> rs2_value[4:0] : rs1_value >> rs2_value[4:0];
          3'b110: rd_value = rs1_value | rs2_value;
          3'b111: rd_value = rs1_value & rs2_value;
          default: begin rd_write = 1'b0; rd_value = 32'b0; end
        endcase
      end
      default: begin end
    endcase
  end

  always_ff @(posedge clk) begin
    if (!reset_n) begin
      pc <= RESET_VECTOR;
      for (register_index = 0; register_index < 32; register_index = register_index + 1) begin
        registers[register_index] <= 32'b0;
      end
    end else begin
      pc <= pc_next;
      if (rd_write && rd_index != 0) registers[rd_index] <= rd_value;
      registers[0] <= 32'b0;
    end
  end
endmodule
