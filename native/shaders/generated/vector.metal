// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct _mslBufferSizes {
    uint size1;
    uint size2;
};

struct Frame {
    metal::float2 css;
    metal::float2 turn;
    metal::float2 high;
    metal::float2 low;
    float scale;
    float opacity;
    metal::float2 pad;
};
struct Vertex {
    metal::float2 at;
    metal::float2 normal;
    float advance;
    float across;
    uint style;
    uint kind;
};
struct Style {
    metal::float4 fill;
    metal::float4 line;
    float width;
    float dash;
    float gap;
    float pad;
};
typedef Vertex type_4[1];
typedef Style type_5[1];
struct Varying {
    metal::float4 position;
    float along;
    float across;
    uint style;
    uint kind;
};
constant float MITER_LIMIT = 4.0;

float half_width(
    Style s
) {
    return metal::max(s.width, 1.0) * 0.5;
}

struct vertex_Input {
};
struct vertex_Output {
    metal::float4 position [[position]];
    float along [[user(loc0), center_perspective]];
    float across [[user(loc1), center_perspective]];
    uint style [[user(loc2), flat]];
    uint kind [[user(loc3), flat]];
};
vertex vertex_Output vertex_(
  uint index [[vertex_id]]
, constant Frame& frame [[buffer(0)]]
, device type_4 const& vertices [[buffer(1)]]
, device type_5 const& styles [[buffer(2)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    metal::float2 screen = {};
    metal::float2 normal = {};
    Varying out = {};
    Vertex v = vertices[index];
    Style s_1 = styles[v.style];
    float c = frame.turn.x;
    float n = frame.turn.y;
    metal::float2 _e19 = frame.high;
    metal::float2 _e23 = frame.low;
    float _e27 = frame.scale;
    metal::float2 p = ((v.at - _e19) - _e23) * _e27;
    screen = metal::float2((p.x * c) - (p.y * n), (p.x * n) + (p.y * c));
    if (v.kind == 1u) {
        float _e44 = half_width(s_1);
        float extent = _e44 + 1.0;
        normal = v.normal;
        metal::float2 _e49 = normal;
        float length = metal::length(_e49);
        if (length > MITER_LIMIT) {
            metal::float2 _e53 = normal;
            normal = _e53 * (MITER_LIMIT / length);
        }
        metal::float2 _e57 = screen;
        float _e59 = normal.x;
        float _e62 = normal.y;
        float _e66 = normal.x;
        float _e69 = normal.y;
        screen = _e57 + (metal::float2((_e59 * c) - (_e62 * n), (_e66 * n) + (_e69 * c)) * extent);
    }
    metal::float2 _e75 = screen;
    metal::float2 _e78 = frame.css;
    screen = _e75 + (_e78 * 0.5);
    float _e85 = screen.x;
    float _e89 = frame.css.x;
    float _e96 = screen.y;
    float _e100 = frame.css.y;
    out.position = metal::float4(((_e85 / _e89) * 2.0) - 1.0, 1.0 - ((_e96 / _e100) * 2.0), 0.0, 1.0);
    float _e113 = frame.scale;
    out.along = v.advance * _e113;
    out.across = v.across;
    out.style = v.style;
    out.kind = v.kind;
    Varying _e121 = out;
    const auto _tmp = _e121;
    return vertex_Output { _tmp.position, _tmp.along, _tmp.across, _tmp.style, _tmp.kind };
}


struct fragment_Input {
    float along [[user(loc0), center_perspective]];
    float across [[user(loc1), center_perspective]];
    uint style [[user(loc2), flat]];
    uint kind [[user(loc3), flat]];
};
struct fragment_Output {
    metal::float4 member_1 [[color(0)]];
};
fragment fragment_Output fragment_(
  fragment_Input varyings_1 [[stage_in]]
, metal::float4 position [[position]]
, constant Frame& frame [[buffer(0)]]
, device type_5 const& styles [[buffer(2)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    const Varying in = { position, varyings_1.along, varyings_1.across, varyings_1.style, varyings_1.kind };
    float a = {};
    Style s_2 = styles[in.style];
    if (in.kind == 0u) {
        float _e18 = frame.opacity;
        return fragment_Output { metal::float4(s_2.fill.xyz * s_2.fill.w, s_2.fill.w) * _e18 };
    }
    float _e20 = half_width(s_2);
    float d = metal::abs(in.across) * (_e20 + 1.0);
    float _e26 = metal::fwidth(d);
    float aa = metal::max(_e26, 0.001);
    a = 1.0 - metal::smoothstep(_e20 - (aa * 0.5), _e20 + (aa * 0.5), d);
    if (s_2.dash > 0.0) {
        float t = metal::fmod(in.along, s_2.dash + s_2.gap);
        float _e48 = metal::fwidth(in.along);
        float ta = metal::max(_e48, 0.001);
        float _e51 = a;
        a = _e51 * (metal::smoothstep(-(ta) * 0.5, ta * 0.5, t) * (1.0 - metal::smoothstep(s_2.dash - (ta * 0.5), s_2.dash + (ta * 0.5), t)));
    }
    float _e71 = a;
    a = _e71 * metal::min(s_2.width, 1.0);
    float _e84 = a;
    float _e88 = frame.opacity;
    return fragment_Output { (metal::float4(s_2.line.xyz * s_2.line.w, s_2.line.w) * _e84) * _e88 };
}
