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
    float base_scale;
    float land_scale;
    float merc_step;
    float pad2_;
    metal::float2 merc_origin;
    metal::float2 pad3_;
    metal::float4 t0_;
    metal::float4 t1_;
    metal::float4 t2_;
};
typedef metal::float4 type_6[1];
constant float INVALID = -300000000000000000000000000000000000000.0;
constant float PI = 3.1415927;

bool valid(
    float v
) {
    bool local = {};
    if ((as_type<uint>(v) & 2147483647u) < 2139095040u) {
        local = v > -100000000000000000000.0;
    } else {
        local = false;
    }
    bool _e11 = local;
    return _e11;
}

int naga_f2i32(float value) {
    return static_cast<int>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

int naga_div(int lhs, int rhs) {
    return lhs / metal::select(rhs, 1, (lhs == (-2147483647 - 1) & rhs == -1) | (rhs == 0));
}

int naga_mod(int lhs, int rhs) {
    int divisor = metal::select(rhs, 1, (lhs == (-2147483647 - 1) & rhs == -1) | (rhs == 0));
    return lhs - (lhs / divisor) * divisor;
}

uint water_class(
    metal::float2 merc,
    metal::texture2d<uint, metal::access::sample> mask
) {
    float latitude = ((metal::atan(metal::sinh(PI * (1.0 - (2.0 * merc.y))))) * 57.295779513082322865);
    metal::int2 q = metal::int2(naga_f2i32(metal::min(16383.0, metal::floor(metal::fract(merc.x) * 16384.0))), naga_f2i32(metal::clamp(metal::floor(((90.0 - latitude) / 180.0) * 8192.0), 0.0, 8191.0)));
    metal::int2 size = static_cast<metal::int2>(metal::uint2(mask.get_width(), mask.get_height()));
    metal::uint4 packed = mask.read(metal::uint2(metal::min(metal::int2(naga_div(q.x, 8), naga_div(q.y, 4)), as_type<metal::int2>(as_type<metal::uint2>(size) - as_type<metal::uint2>(metal::int2(1))))), 0);
    return (packed[naga_mod(q.y, 4)] >> static_cast<uint>(as_type<int>(as_type<uint>(14) - as_type<uint>(as_type<int>(as_type<uint>(2) * as_type<uint>(naga_mod(q.x, 8))))))) & 3u;
}

metal::int2 naga_f2i32(metal::float2 value) {
    return static_cast<metal::int2>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

float aux(
    metal::texture2d<float, metal::access::sample> t,
    float scale,
    metal::float2 at
) {
    float sum = 0.0;
    float w = 0.0;
    int y = 0;
    int x = {};
    bool local_1 = {};
    if (scale <= 0.0) {
        return INVALID;
    }
    metal::float2 q_1 = (at / metal::float2(scale)) - metal::float2(0.5);
    metal::int2 b = naga_f2i32(metal::floor(q_1));
    metal::float2 fr = q_1 - static_cast<metal::float2>(b);
    metal::int2 ts = static_cast<metal::int2>(metal::uint2(t.get_width(), t.get_height()));
    uint2 loop_bound = uint2(4294967295u);
    bool loop_init = true;
    while(true) {
        if (metal::all(loop_bound == uint2(0u))) { break; }
        loop_bound -= uint2(loop_bound.y == 0u, 1u);
        if (!loop_init) {
            int _e77 = y;
            y = as_type<int>(as_type<uint>(_e77) + as_type<uint>(1));
        }
        loop_init = false;
        int _e23 = y;
        if (_e23 < 2) {
        } else {
            break;
        }
        {
            x = 0;
            uint2 loop_bound_1 = uint2(4294967295u);
            bool loop_init_1 = true;
            while(true) {
                if (metal::all(loop_bound_1 == uint2(0u))) { break; }
                loop_bound_1 -= uint2(loop_bound_1.y == 0u, 1u);
                if (!loop_init_1) {
                    int _e74 = x;
                    x = as_type<int>(as_type<uint>(_e74) + as_type<uint>(1));
                }
                loop_init_1 = false;
                int _e28 = x;
                if (_e28 < 2) {
                } else {
                    break;
                }
                {
                    int _e31 = x;
                    int _e32 = y;
                    metal::float4 _e42 = t.read(metal::uint2(metal::clamp(as_type<metal::int2>(as_type<metal::uint2>(b) + as_type<metal::uint2>(metal::int2(_e31, _e32))), metal::int2(0), as_type<metal::int2>(as_type<metal::uint2>(ts) - as_type<metal::uint2>(metal::int2(1))))), 0);
                    float a = _e42.x;
                    int _e48 = x;
                    int _e56 = y;
                    float k = ((_e48 == 0) ? (1.0 - fr.x) : fr.x) * ((_e56 == 0) ? (1.0 - fr.y) : fr.y);
                    bool _e61 = valid(a);
                    if (_e61) {
                        local_1 = k > 0.0;
                    } else {
                        local_1 = false;
                    }
                    bool _e67 = local_1;
                    if (_e67) {
                        float _e68 = sum;
                        sum = _e68 + (a * k);
                        float _e71 = w;
                        w = _e71 + k;
                    }
                }
            }
        }
    }
    float _e80 = sum;
    float _e81 = w;
    float _e83 = w;
    return (_e83 > 0.0) ? (_e80 / _e81) : INVALID;
}

struct main_Input {
};
[[max_total_threads_per_threadgroup(64)]] kernel void main_(
  metal::uint3 id [[thread_position_in_grid]]
, constant Grid& grid [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> field [[texture(1)]]
, device type_6& samples [[buffer(2)]]
, metal::texture2d<float, metal::access::sample> base [[texture(3)]]
, metal::texture2d<float, metal::access::sample> land_base [[texture(4)]]
, metal::texture2d<uint, metal::access::sample> mask [[texture(5)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    metal::uint2 _e4 = grid.size;
    if (metal::any(id.xy >= _e4)) {
        return;
    }
    metal::float2 dims = static_cast<metal::float2>(metal::uint2(field.get_width(), field.get_height()));
    metal::uint2 _e18 = grid.size;
    metal::int2 p = naga_f2i32(((static_cast<metal::float2>(id.xy) + metal::float2(0.5)) * dims) / static_cast<metal::float2>(_e18));
    metal::float2 centre = static_cast<metal::float2>(p) + metal::float2(0.5);
    metal::float4 _e28 = grid.t0_;
    metal::float4 _e34 = grid.t1_;
    metal::float4 _e41 = grid.t2_;
    metal::float2 at_1 = ((_e28.xy * centre.x) + (_e34.xy * centre.y)) + _e41.xy;
    metal::float4 _e46 = field.read(metal::uint2(p), 0);
    float height = _e46.x;
    metal::float2 _e50 = grid.merc_origin;
    float _e53 = grid.merc_step;
    uint _e56 = water_class(_e50 + (at_1 * _e53), mask);
    uint _e62 = grid.size.x;
    bool _e68 = valid(height);
    float _e73 = grid.base_scale;
    float _e74 = aux(base, _e73, at_1);
    float _e78 = grid.land_scale;
    float _e79 = aux(land_base, _e78, at_1);
    samples[(id.y * _e62) + id.x] = metal::float4(_e68 ? height : INVALID, _e74, _e79, static_cast<float>(_e56));
    return;
}
