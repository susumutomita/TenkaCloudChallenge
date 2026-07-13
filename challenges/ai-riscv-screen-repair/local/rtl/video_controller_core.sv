module video_controller_core #(
  parameter integer CDC_SYNC_STAGES = 1,
  parameter integer H_TOTAL_ADJUST = 0,
  parameter integer V_TOTAL_ADJUST = 0,
  parameter logic RESPECT_WRITE_STROBES = 1'b0
) (
  input  logic        cpu_clk,
  input  logic        cpu_reset_n,
  input  logic        pixel_clk,
  input  logic        pixel_reset_n,
  input  logic        control_req_toggle,
  input  logic        control_enable,
  output logic        control_ack_toggle,
  output logic        video_enabled,
  input  logic        fb_write,
  input  logic [7:0]  fb_addr,
  input  logic [3:0]  fb_wstrb,
  input  logic [31:0] fb_wdata,
  output logic        hsync_n,
  output logic        vsync_n,
  output logic        video_active,
  output logic [7:0]  pixel_index,
  output logic        line_start,
  output logic        frame_start
);
  localparam integer H_ACTIVE = 16;
  localparam integer H_FRONT = 2;
  localparam integer H_SYNC = 2;
  localparam integer H_BACK = 2;
  localparam integer V_ACTIVE = 12;
  localparam integer V_FRONT = 1;
  localparam integer V_SYNC = 2;
  localparam integer V_BACK = 1;
  localparam integer H_TOTAL = H_ACTIVE + H_FRONT + H_SYNC + H_BACK + H_TOTAL_ADJUST;
  localparam integer V_TOTAL = V_ACTIVE + V_FRONT + V_SYNC + V_BACK + V_TOTAL_ADJUST;
  localparam integer FRAMEBUFFER_BYTES = H_ACTIVE * V_ACTIVE;

  logic [7:0] framebuffer [0:FRAMEBUFFER_BYTES-1];
  logic [CDC_SYNC_STAGES-1:0] request_sync;
  logic [5:0] h_count;
  logic [4:0] v_count;
  integer framebuffer_base;
  integer init_index;
  integer lane;
  integer sync_stage;

  initial begin
    for (init_index = 0; init_index < FRAMEBUFFER_BYTES; init_index = init_index + 1) begin
      framebuffer[init_index] = 8'h00;
    end
  end

  always_ff @(posedge cpu_clk) begin
    // Firmware completely initializes the buffer before scanout. The RAM
    // contents intentionally survive a control reset, like block RAM.
    if (cpu_reset_n && fb_write) begin
      framebuffer_base = int'({fb_addr[7:2], 2'b00});
      for (lane = 0; lane < 4; lane = lane + 1) begin
        if (framebuffer_base + lane < FRAMEBUFFER_BYTES) begin
          if (RESPECT_WRITE_STROBES) begin
            if (fb_wstrb[lane]) begin
              framebuffer[framebuffer_base + lane] <= fb_wdata[lane * 8 +: 8];
            end
          end else begin
            framebuffer[framebuffer_base + lane] <= fb_wdata[lane * 8 +: 8];
          end
        end
      end
    end
  end

  always_ff @(posedge pixel_clk or negedge pixel_reset_n) begin
    if (!pixel_reset_n) begin
      request_sync <= '0;
      control_ack_toggle <= 1'b0;
      video_enabled <= 1'b0;
      h_count <= 6'd0;
      v_count <= 5'd0;
    end else begin
      request_sync[0] <= control_req_toggle;
      for (sync_stage = 1; sync_stage < CDC_SYNC_STAGES; sync_stage = sync_stage + 1) begin
        request_sync[sync_stage] <= request_sync[sync_stage - 1];
      end

      if (request_sync[CDC_SYNC_STAGES - 1] != control_ack_toggle) begin
        video_enabled <= control_enable;
        control_ack_toggle <= request_sync[CDC_SYNC_STAGES - 1];
      end

      if (!video_enabled) begin
        h_count <= 6'd0;
        v_count <= 5'd0;
      end else if (h_count == 6'(H_TOTAL - 1)) begin
        h_count <= 6'd0;
        if (v_count == 5'(V_TOTAL - 1)) begin
          v_count <= 5'd0;
        end else begin
          v_count <= v_count + 1'b1;
        end
      end else begin
        h_count <= h_count + 1'b1;
      end
    end
  end

  always_comb begin
    hsync_n = 1'b1;
    vsync_n = 1'b1;
    video_active = 1'b0;
    pixel_index = 8'h00;
    line_start = 1'b0;
    frame_start = 1'b0;
    if (video_enabled) begin
      hsync_n = !(
        h_count >= 6'(H_ACTIVE + H_FRONT) &&
        h_count < 6'(H_ACTIVE + H_FRONT + H_SYNC)
      );
      vsync_n = !(
        v_count >= 5'(V_ACTIVE + V_FRONT) &&
        v_count < 5'(V_ACTIVE + V_FRONT + V_SYNC)
      );
      video_active = h_count < 6'(H_ACTIVE) && v_count < 5'(V_ACTIVE);
      line_start = h_count == 0;
      frame_start = h_count == 0 && v_count == 0;
      if (video_active) begin
        pixel_index = framebuffer[int'(v_count) * H_ACTIVE + int'(h_count)];
      end
    end
  end
endmodule
