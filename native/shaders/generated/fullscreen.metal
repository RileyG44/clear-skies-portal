// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct type_8 {
    float inner[1];
};
struct gl_PerVertex {
    metal::float4 gl_Position;
    float gl_PointSize;
    type_8 gl_ClipDistance;
    type_8 gl_CullDistance;
    char _pad4[4];
};
struct VertexOutput {
    metal::float2 member;
    char _pad1[8];
    metal::float4 gl_Position;
};

void main_1(
    thread int& gl_VertexIndex_1,
    thread metal::float2& v_screenUv,
    thread gl_PerVertex& unnamed
) {
    metal::float2 p = {};
    int _e11 = gl_VertexIndex_1;
    int _e16 = gl_VertexIndex_1;
    p = metal::float2(static_cast<float>((_e11 << as_type<uint>(1)) & 2), static_cast<float>(_e16 & 2));
    metal::float2 _e20 = p;
    v_screenUv = _e20;
    metal::float2 _e21 = p;
    metal::float2 _e24 = (_e21 * 2.0) - metal::float2(1.0);
    unnamed.gl_Position = metal::float4(_e24.x, _e24.y, 0.0, 1.0);
    return;
}

struct main_Input {
};
struct main_Output {
    metal::float2 member [[user(loc0), center_perspective]];
    metal::float4 gl_Position [[position]];
};
vertex main_Output main_(
  uint gl_VertexIndex [[vertex_id]]
) {
    int gl_VertexIndex_1 = {};
    metal::float2 v_screenUv = {};
    gl_PerVertex unnamed = gl_PerVertex {metal::float4(0.0, 0.0, 0.0, 1.0), 1.0, type_8 {}, type_8 {}};
    gl_VertexIndex_1 = static_cast<int>(gl_VertexIndex);
    main_1(gl_VertexIndex_1, v_screenUv, unnamed);
    float _e7 = unnamed.gl_Position.y;
    unnamed.gl_Position.y = -(_e7);
    metal::float2 _e9 = v_screenUv;
    metal::float4 _e10 = unnamed.gl_Position;
    const auto _tmp = VertexOutput {_e9, {}, _e10};
    return main_Output { _tmp.member, _tmp.gl_Position };
}
