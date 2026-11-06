// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct _mslBufferSizes {
    uint size1;
};

struct Frame {
    metal::float2 css;
    metal::float2 turn;
    float opacity;
    uint mode;
    metal::float2 pad;
};
struct Tile {
    metal::float4 rect;
    metal::float4 uv;
    uint layer;
    char _pad3[12];
    metal::uint3 pad;
};
typedef Tile type_5[1];
struct Varying {
    metal::float4 position;
    metal::float2 uv;
    uint layer;
    char _pad3[4];
};

struct vertex_Input {
};
struct vertex_Output {
    metal::float4 position [[position]];
    metal::float2 uv [[user(loc0), center_perspective]];
    uint layer [[user(loc1), flat]];
};
vertex vertex_Output vertex_(
  uint v [[vertex_id]]
, uint i [[instance_id]]
, constant Frame& frame [[buffer(0)]]
, device type_5 const& tiles [[buffer(1)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    Varying out = {};
    Tile tile = tiles[i];
    metal::float2 corner = metal::float2(static_cast<float>((26u >> v) & 1u), static_cast<float>((52u >> v) & 1u));
    metal::float2 p = tile.rect.xy + (corner * tile.rect.zw);
    float c = frame.turn.x;
    float s = frame.turn.y;
    metal::float2 _e43 = frame.css;
    metal::float2 screen = metal::float2((p.x * c) - (p.y * s), (p.x * s) + (p.y * c)) + (_e43 * 0.5);
    float _e53 = frame.css.x;
    float _e63 = frame.css.y;
    out.position = metal::float4(((screen.x / _e53) * 2.0) - 1.0, 1.0 - ((screen.y / _e63) * 2.0), 0.0, 1.0);
    out.uv = metal::mix(tile.uv.xy, tile.uv.zw, corner);
    out.layer = tile.layer;
    Varying _e80 = out;
    const auto _tmp = _e80;
    return vertex_Output { _tmp.position, _tmp.uv, _tmp.layer };
}


struct fragment_Input {
    metal::float2 uv [[user(loc0), center_perspective]];
    uint layer [[user(loc1), flat]];
};
struct fragment_Output {
    metal::float4 member_1 [[color(0)]];
};
fragment fragment_Output fragment_(
  fragment_Input varyings_1 [[stage_in]]
, metal::float4 position [[position]]
, constant Frame& frame [[buffer(0)]]
, metal::texture2d_array<float, metal::access::sample> pool [[texture(2)]]
, metal::sampler bilinear [[sampler(3)]]
) {
    const Varying in = { position, varyings_1.uv, varyings_1.layer };
    metal::float4 colour = {};
    metal::float4 _e5 = pool.sample(bilinear, in.uv, in.layer);
    colour = _e5;
    uint _e9 = frame.mode;
    if (_e9 == 1u) {
        metal::float4 _e12 = colour;
        float grey = metal::dot(_e12.xyz, metal::float3(0.2126, 0.7152, 0.0722));
        float _e23 = colour.w;
        float _e27 = colour.w;
        colour = metal::float4(metal::min(metal::float3(grey * 1.35), metal::float3(_e23)), _e27);
    }
    metal::float4 _e29 = colour;
    float _e32 = frame.opacity;
    return fragment_Output { _e29 * _e32 };
}
