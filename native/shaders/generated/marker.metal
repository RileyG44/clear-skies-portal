// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct _mslBufferSizes {
    uint size1;
};

struct Frame {
    metal::float2 css;
    metal::float2 pad;
};
struct Marker {
    metal::float2 at;
    float radius;
    float stroke;
    metal::float4 fill;
    metal::float4 line;
};
typedef Marker type_3[1];
struct Varying {
    metal::float4 position;
    metal::float2 offset;
    uint index;
    char _pad3[4];
};

struct vertex_Input {
};
struct vertex_Output {
    metal::float4 position [[position]];
    metal::float2 offset [[user(loc0), center_perspective]];
    uint index [[user(loc1), flat]];
};
vertex vertex_Output vertex_(
  uint v [[vertex_id]]
, uint i [[instance_id]]
, constant Frame& frame [[buffer(0)]]
, device type_3 const& markers [[buffer(1)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    Varying out = {};
    Marker m = markers[i];
    metal::float2 corner = (metal::float2(static_cast<float>((26u >> v) & 1u), static_cast<float>((52u >> v) & 1u)) * 2.0) - metal::float2(1.0);
    float extent = (m.radius + (m.stroke * 0.5)) + 1.0;
    metal::float2 screen = m.at + (corner * extent);
    float _e37 = frame.css.x;
    float _e47 = frame.css.y;
    out.position = metal::float4(((screen.x / _e37) * 2.0) - 1.0, 1.0 - ((screen.y / _e47) * 2.0), 0.0, 1.0);
    out.offset = corner * extent;
    out.index = i;
    Varying _e59 = out;
    const auto _tmp = _e59;
    return vertex_Output { _tmp.position, _tmp.offset, _tmp.index };
}


struct fragment_Input {
    metal::float2 offset [[user(loc0), center_perspective]];
    uint index [[user(loc1), flat]];
};
struct fragment_Output {
    metal::float4 member_1 [[color(0)]];
};
fragment fragment_Output fragment_(
  fragment_Input varyings_1 [[stage_in]]
, metal::float4 position [[position]]
, device type_3 const& markers [[buffer(1)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    const Varying in = { position, varyings_1.offset, varyings_1.index };
    Marker m_1 = markers[in.index];
    float d = metal::length(in.offset);
    float _e7 = metal::fwidth(d);
    float aa = metal::max(_e7, 0.001);
    float inside = 1.0 - metal::smoothstep(m_1.radius - aa, m_1.radius + aa, d);
    float ring = 1.0 - metal::smoothstep((m_1.stroke * 0.5) - aa, (m_1.stroke * 0.5) + aa, metal::abs(d - m_1.radius));
    metal::float4 fill = metal::float4(m_1.fill.xyz * m_1.fill.w, m_1.fill.w) * inside;
    metal::float4 line = metal::float4(m_1.line.xyz * m_1.line.w, m_1.line.w) * ring;
    return fragment_Output { line + (fill * (1.0 - line.w)) };
}
