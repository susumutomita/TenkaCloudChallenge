// Maintainer-only golden wrapper. It is outside the problem's Docker build
// context and is mounted only by the catalog red/green proof.
module video_controller (
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
  video_controller_core #(
    .CDC_SYNC_STAGES(2),
    .H_TOTAL_ADJUST(0),
    .V_TOTAL_ADJUST(0),
    .RESPECT_WRITE_STROBES(1'b1)
  ) core (.*);
endmodule
