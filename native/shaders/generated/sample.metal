// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct _mslBufferSizes {
    uint size2;
};

struct Grid {
    metal::uint2 size;
    metal::uint2 pad;
};
typedef float type_3[1];
metal::int2 naga_f2i32(metal::float2 value) {
    return static_cast<metal::int2>(metal::clamp(value, -2147483600.0, 2147483500.0));
}


struct main_Input {
};
[[max_total_threads_per_threadgroup(64)]] kernel void main_(
  metal::uint3 id [[thread_position_in_grid]]
, constant Grid& grid [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> field [[texture(1)]]
, device type_3& samples [[buffer(2)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    metal::uint2 _e4 = grid.size;
    if (metal::any(id.xy >= _e4)) {
        return;
    }
    metal::float2 dims = static_cast<metal::float2>(metal::uint2(field.get_width(), field.get_height()));
    metal::uint2 _e18 = grid.size;
    metal::float2 p = ((static_cast<metal::float2>(id.xy) + metal::float2(0.5)) * dims) / static_cast<metal::float2>(_e18);
    uint _e26 = grid.size.x;
    metal::float4 _e34 = field.read(metal::uint2(naga_f2i32(p)), 0);
    samples[(id.y * _e26) + id.x] = _e34.x;
    return;
}
