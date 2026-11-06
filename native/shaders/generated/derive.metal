// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct _mslBufferSizes {
    uint size3;
};

struct Params {
    metal::int2 dir;
    uint factor;
    uint radius;
    uint minimum;
    uint land;
    uint src_height;
    uint out_width;
    metal::float2 merc_origin;
    float merc_step;
    float sigma;
};
typedef metal::float2 type_7[1];
constant float INVALID = -300000000000000000000000000000000000000.0;
constant float PI = 3.1415927;

bool valid(
    float v
) {
    bool local_3 = {};
    if ((as_type<uint>(v) & 2147483647u) < 2139095040u) {
        local_3 = v > -100000000000000000000.0;
    } else {
        local_3 = false;
    }
    bool _e11 = local_3;
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

float store_value(
    metal::int2 p,
    constant Params& params,
    metal::texture2d<float, metal::access::sample> src,
    metal::texture2d<uint, metal::access::sample> mask
) {
    metal::float4 _e3 = src.read(metal::uint2(p), 0);
    float v_2 = _e3.x;
    bool _e5 = valid(v_2);
    if (!(_e5)) {
        return INVALID;
    }
    uint _e10 = params.land;
    if (_e10 != 0u) {
        metal::float2 _e15 = params.merc_origin;
        float _e22 = params.merc_step;
        metal::float2 merc_1 = _e15 + ((static_cast<metal::float2>(p) + metal::float2(0.5)) * _e22);
        uint _e25 = water_class(merc_1, mask);
        if (_e25 != 0u) {
            return INVALID;
        }
    }
    return v_2;
}

metal::float2 combine(
    metal::float2 acc_3,
    float v_1,
    float weight_1,
    constant Params& params
) {
    uint _e5 = params.minimum;
    if (_e5 != 0u) {
        return metal::float2(metal::min(acc_3.x, v_1), acc_3.y + weight_1);
    }
    return metal::float2(acc_3.x + (v_1 * weight_1), acc_3.y + weight_1);
}

metal::float2 start(
    constant Params& params
) {
    uint _e2 = params.minimum;
    return metal::float2((_e2 != 0u) ? 300000000000000000000000000000000000000.0 : 0.0, 0.0);
}

struct rowsInput {
};
[[max_total_threads_per_threadgroup(256)]] kernel void rows(
  metal::uint3 id [[thread_position_in_grid]]
, constant Params& params [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> src [[texture(1)]]
, device type_7& scratch [[buffer(3)]]
, metal::texture2d<uint, metal::access::sample> mask [[texture(4)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    bool local = {};
    metal::float2 acc = {};
    int k = 0;
    metal::int2 size_1 = static_cast<metal::int2>(metal::uint2(src.get_width(), src.get_height()));
    uint _e7 = params.out_width;
    if (!((id.x >= _e7))) {
        local = static_cast<int>(id.y) >= size_1.y;
    } else {
        local = true;
    }
    bool _e17 = local;
    if (_e17) {
        return;
    }
    metal::float2 _e18 = start(params);
    acc = _e18;
    uint _e23 = params.factor;
    int x0_ = static_cast<int>(id.x * _e23);
    uint2 loop_bound = uint2(4294967295u);
    bool loop_init = true;
    while(true) {
        if (metal::all(loop_bound == uint2(0u))) { break; }
        loop_bound -= uint2(loop_bound.y == 0u, 1u);
        if (!loop_init) {
            int _e48 = k;
            k = as_type<int>(as_type<uint>(_e48) + as_type<uint>(1));
        }
        loop_init = false;
        int _e28 = k;
        uint _e31 = params.factor;
        if (_e28 < static_cast<int>(_e31)) {
        } else {
            break;
        }
        {
            int _e34 = k;
            int x = as_type<int>(as_type<uint>(x0_) + as_type<uint>(_e34));
            if (x >= size_1.x) {
                break;
            }
            float _e41 = store_value(metal::int2(x, static_cast<int>(id.y)), params, src, mask);
            if (_e41 > -100000000000000000000.0) {
                metal::float2 _e44 = acc;
                metal::float2 _e46 = combine(_e44, _e41, 1.0, params);
                acc = _e46;
            }
        }
    }
    uint _e54 = params.out_width;
    metal::float2 _e59 = acc;
    scratch[(id.y * _e54) + id.x] = _e59;
    return;
}


struct colsInput {
};
[[max_total_threads_per_threadgroup(256)]] kernel void cols(
  metal::uint3 id_1 [[thread_position_in_grid]]
, constant Params& params [[buffer(0)]]
, metal::texture2d<float, metal::access::write> dst [[texture(2)]]
, device type_7 const& scratch [[buffer(3)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    metal::float2 acc_1 = {};
    uint k_1 = 0u;
    float value = INVALID;
    metal::uint2 out = metal::uint2(dst.get_width(), dst.get_height());
    if (metal::any(id_1.xy >= out)) {
        return;
    }
    metal::float2 _e6 = start(params);
    acc_1 = _e6;
    uint _e11 = params.factor;
    uint y0_ = id_1.y * _e11;
    uint2 loop_bound_1 = uint2(4294967295u);
    bool loop_init_1 = true;
    while(true) {
        if (metal::all(loop_bound_1 == uint2(0u))) { break; }
        loop_bound_1 -= uint2(loop_bound_1.y == 0u, 1u);
        if (!loop_init_1) {
            uint _e55 = k_1;
            k_1 = _e55 + 1u;
        }
        loop_init_1 = false;
        uint _e15 = k_1;
        uint _e18 = params.factor;
        if (_e15 < _e18) {
        } else {
            break;
        }
        {
            uint _e20 = k_1;
            uint y = y0_ + _e20;
            uint _e24 = params.src_height;
            if (y >= _e24) {
                break;
            }
            uint _e29 = params.out_width;
            metal::float2 row = scratch[(y * _e29) + id_1.x];
            if (row.y > 0.0) {
                uint _e40 = params.minimum;
                if (_e40 != 0u) {
                    float _e44 = acc_1.x;
                    float _e48 = acc_1.y;
                    acc_1 = metal::float2(metal::min(_e44, row.x), _e48 + row.y);
                } else {
                    metal::float2 _e52 = acc_1;
                    acc_1 = _e52 + row;
                }
            }
        }
    }
    float _e60 = acc_1.y;
    if (_e60 > 0.0) {
        float _e64 = acc_1.x;
        float _e66 = acc_1.y;
        float _e69 = acc_1.x;
        uint _e72 = params.minimum;
        value = (_e72 != 0u) ? _e69 : (_e64 / _e66);
    }
    float _e79 = value;
    dst.write(metal::float4(_e79, 0.0, 0.0, 0.0), metal::uint2(static_cast<metal::int2>(id_1.xy)));
    return;
}

int naga_neg(int val) {
    return as_type<int>(-as_type<uint>(val));
}


struct erodeInput {
};
[[max_total_threads_per_threadgroup(256)]] kernel void erode(
  metal::uint3 id_2 [[thread_position_in_grid]]
, constant Params& params [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> src [[texture(1)]]
, metal::texture2d<float, metal::access::write> dst [[texture(2)]]
) {
    float acc_2 = 300000000000000000000000000000000000000.0;
    bool any_valid = false;
    int k_2 = {};
    bool local_1 = {};
    metal::int2 size_2 = static_cast<metal::int2>(metal::uint2(src.get_width(), src.get_height()));
    metal::int2 o = static_cast<metal::int2>(id_2.xy);
    if (metal::any(o >= size_2)) {
        return;
    }
    uint _e14 = params.radius;
    int r = static_cast<int>(_e14);
    k_2 = naga_neg(r);
    uint2 loop_bound_2 = uint2(4294967295u);
    bool loop_init_2 = true;
    while(true) {
        if (metal::all(loop_bound_2 == uint2(0u))) { break; }
        loop_bound_2 -= uint2(loop_bound_2.y == 0u, 1u);
        if (!loop_init_2) {
            int _e46 = k_2;
            k_2 = as_type<int>(as_type<uint>(_e46) + as_type<uint>(1));
        }
        loop_init_2 = false;
        int _e18 = k_2;
        if (_e18 <= r) {
        } else {
            break;
        }
        {
            metal::int2 _e22 = params.dir;
            int _e23 = k_2;
            metal::int2 q_1 = as_type<metal::int2>(as_type<metal::uint2>(o) + as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e22) * as_type<uint>(_e23))));
            if (!(metal::any(q_1 < metal::int2(0)))) {
                local_1 = metal::any(q_1 >= size_2);
            } else {
                local_1 = true;
            }
            bool _e36 = local_1;
            if (_e36) {
                continue;
            }
            metal::float4 _e39 = src.read(metal::uint2(q_1), 0);
            float v_3 = _e39.x;
            bool _e41 = valid(v_3);
            if (_e41) {
                float _e42 = acc_2;
                acc_2 = metal::min(_e42, v_3);
                any_valid = true;
            }
        }
    }
    float _e50 = acc_2;
    bool _e51 = any_valid;
    dst.write(metal::float4(_e51 ? _e50 : INVALID, 0.0, 0.0, 0.0), metal::uint2(o));
    return;
}


struct gaussInput {
};
[[max_total_threads_per_threadgroup(256)]] kernel void gauss(
  metal::uint3 id_3 [[thread_position_in_grid]]
, constant Params& params [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> src [[texture(1)]]
, metal::texture2d<float, metal::access::write> dst [[texture(2)]]
) {
    float sum = 0.0;
    float weight = 0.0;
    int k_3 = {};
    bool local_2 = {};
    metal::int2 size_3 = static_cast<metal::int2>(metal::uint2(src.get_width(), src.get_height()));
    metal::int2 o_1 = static_cast<metal::int2>(id_3.xy);
    if (metal::any(o_1 >= size_3)) {
        return;
    }
    uint _e14 = params.radius;
    int r_1 = static_cast<int>(_e14);
    float _e18 = params.sigma;
    float _e23 = params.sigma;
    float s = (2.0 * _e18) * _e23;
    k_3 = naga_neg(r_1);
    uint2 loop_bound_3 = uint2(4294967295u);
    bool loop_init_3 = true;
    while(true) {
        if (metal::all(loop_bound_3 == uint2(0u))) { break; }
        loop_bound_3 -= uint2(loop_bound_3.y == 0u, 1u);
        if (!loop_init_3) {
            int _e64 = k_3;
            k_3 = as_type<int>(as_type<uint>(_e64) + as_type<uint>(1));
        }
        loop_init_3 = false;
        int _e27 = k_3;
        if (_e27 <= r_1) {
        } else {
            break;
        }
        {
            metal::int2 _e31 = params.dir;
            int _e32 = k_3;
            metal::int2 q_2 = as_type<metal::int2>(as_type<metal::uint2>(o_1) + as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e31) * as_type<uint>(_e32))));
            if (!(metal::any(q_2 < metal::int2(0)))) {
                local_2 = metal::any(q_2 >= size_3);
            } else {
                local_2 = true;
            }
            bool _e45 = local_2;
            if (_e45) {
                continue;
            }
            metal::float4 _e48 = src.read(metal::uint2(q_2), 0);
            float v_4 = _e48.x;
            bool _e50 = valid(v_4);
            if (_e50) {
                int _e51 = k_3;
                int _e52 = k_3;
                float g = metal::exp(-(static_cast<float>(as_type<int>(as_type<uint>(_e51) * as_type<uint>(_e52)))) / s);
                float _e58 = sum;
                sum = _e58 + (v_4 * g);
                float _e61 = weight;
                weight = _e61 + g;
            }
        }
    }
    float _e68 = sum;
    float _e69 = weight;
    float _e71 = weight;
    dst.write(metal::float4((_e71 > 0.0) ? (_e68 / _e69) : INVALID, 0.0, 0.0, 0.0), metal::uint2(o_1));
    return;
}
